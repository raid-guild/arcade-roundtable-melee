import http from "node:http";
import nextEnv from "@next/env";
import next from "next";
import postgres from "postgres";
import { jwtVerify } from "jose";
import { WebSocketServer } from "ws";
import { buildGameConfig, CHARACTER_IDS } from "../game/shared/config-values.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const CONFIG = buildGameConfig();

const CHARACTERS = new Set(CHARACTER_IDS);

async function verifySocketToken(token) {
  const secret = process.env.SOCKET_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) throw new Error("SOCKET_TOKEN_SECRET or SESSION_SECRET is not set");

  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });

  if (payload.typ !== "roundtable_socket") throw new Error("invalid token type");
  const identity = {
    playerId: stringClaim(payload.playerId),
    portalUserId: stringClaim(payload.portalUserId),
    handle: stringClaim(payload.handle),
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter((role) => typeof role === "string")
      : [],
  };

  if (!identity.playerId || !identity.portalUserId || !identity.handle) {
    throw new Error("socket token missing identity");
  }

  return identity;
}

function stringClaim(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

class MatchManager {
  constructor() {
    this.sockets = new Map();
    this.players = new Map();
    this.phase = "idle";
    this.matchId = null;
    this.startedByPlayerId = null;
    this.endedByPlayerId = null;
    this.lobbyEndsAt = null;
    this.combatStartedAt = null;
    this.combatEndsAt = null;
    this.matchStartedAt = null;
    this.pickups = new Map();
    this.nextHamAt = Infinity;
    this.nextChestAt = Infinity;
    this.persistedMatchId = null;
    this.persistingMatchId = null;
    this.endedAt = null;
    this.resetToIdleAt = null;
  }

  connect(ws, identity) {
    this.pruneInactivePlayers();
    const existing = this.players.get(identity.playerId);
    if (!existing && this.players.size >= CONFIG.maxPlayers) {
      send(ws, { type: "error", message: "The roundtable is full." });
      ws.close();
      return;
    }

    this.sockets.set(ws, identity);
    ws.lastInputSeq = 0;
    const player = existing ?? this.createPlayer(identity);
    player.handle = identity.handle;
    player.roles = identity.roles;
    player.connected = true;
    if (player.status === "disconnected") {
      player.status = player.frozenUntil > Date.now() ? "frozen" : "alive";
    }

    send(ws, { type: "hello", identity });
    send(ws, this.snapshot(identity.playerId));

    ws.on("message", (data) => this.handleMessage(ws, data));
    ws.on("close", () => this.disconnect(ws));
    ws.on("error", () => this.disconnect(ws));
  }

  createPlayer(identity) {
    const spawn = this.randomSpawn();
    const player = {
      id: identity.playerId,
      handle: identity.handle,
      roles: identity.roles,
      characterId: null,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      facing: "down",
      health: CONFIG.playerMaxHealth,
      maxHealth: CONFIG.playerMaxHealth,
      status: "alive",
      frozenUntil: 0,
      connected: true,
      input: emptyInput(),
      inputWindowStartedAt: Date.now(),
      inputWindowCount: 0,
      droppedInputs: 0,
      attackCooldownUntil: 0,
      attackActiveUntil: 0,
      score: 0,
      slays: 0,
      deaths: 0,
      damageDealt: 0,
      damageTaken: 0,
      hamsCollected: 0,
      chestsOpened: 0,
      joinedAt: new Date(),
    };
    this.players.set(identity.playerId, player);
    return player;
  }

  disconnect(ws) {
    const identity = this.sockets.get(ws);
    if (!identity) return;
    this.sockets.delete(ws);

    const stillConnected = [...this.sockets.values()].some(
      (other) => other.playerId === identity.playerId
    );
    if (stillConnected) return;

    const player = this.players.get(identity.playerId);
    if (!player) return;
    player.connected = false;
    player.input = emptyInput();
    if (this.phase === "running" && player.status === "alive") {
      player.status = "disconnected";
    }
  }

  handleMessage(ws, data) {
    const identity = this.sockets.get(ws);
    if (!identity) return;

    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send(ws, { type: "error", message: "Invalid message." });
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong", t: msg.t });
      return;
    }

    if (msg.type === "select_character") {
      const player = this.players.get(identity.playerId);
      if (player && CHARACTERS.has(msg.characterId)) {
        player.characterId = msg.characterId;
      }
      return;
    }

    if (msg.type === "input") {
      const player = this.players.get(identity.playerId);
      if (player) this.acceptInput(ws, player, msg.input);
      return;
    }

    if (msg.type === "start_match") {
      this.startMatch(identity, ws);
      return;
    }

    if (msg.type === "end_match") {
      this.endMatch(identity, "ended_early");
    }
  }

  acceptInput(ws, player, rawInput) {
    const input = sanitizeInput(rawInput);
    const now = Date.now();

    if (input.seq <= (ws.lastInputSeq ?? 0)) {
      player.droppedInputs += 1;
      return;
    }

    if (now - player.inputWindowStartedAt >= 1000) {
      player.inputWindowStartedAt = now;
      player.inputWindowCount = 0;
    }

    player.inputWindowCount += 1;
    if (player.inputWindowCount > CONFIG.maxInputMessagesPerSecond) {
      player.droppedInputs += 1;
      return;
    }

    ws.lastInputSeq = input.seq;
    player.input = input;
  }

  startMatch(identity, ws) {
    if (!identity.roles.includes("member")) {
      send(ws, { type: "error", message: "Only Portal members can start a match." });
      return;
    }
    if (this.phase === "lobby" || this.phase === "running") {
      send(ws, { type: "error", message: "A match is already running." });
      return;
    }

    const now = Date.now();
    this.phase = "lobby";
    this.matchId = randomId();
    this.persistedMatchId = null;
    this.startedByPlayerId = identity.playerId;
    this.endedByPlayerId = null;
    this.matchStartedAt = now;
    this.lobbyEndsAt = now + CONFIG.lobbyCountdownSeconds * 1000;
    this.combatStartedAt = null;
    this.combatEndsAt = null;
    this.endedAt = null;
    this.resetToIdleAt = null;
    this.pickups.clear();
    this.nextHamAt = Infinity;
    this.nextChestAt = Infinity;

    for (const player of this.players.values()) {
      const spawn = this.randomSpawn();
      Object.assign(player, {
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        health: CONFIG.playerMaxHealth,
        status: player.connected ? "alive" : "disconnected",
        frozenUntil: 0,
        attackCooldownUntil: 0,
        attackActiveUntil: 0,
        score: 0,
        slays: 0,
        deaths: 0,
        damageDealt: 0,
        damageTaken: 0,
        hamsCollected: 0,
        chestsOpened: 0,
        inputWindowStartedAt: now,
        inputWindowCount: 0,
        droppedInputs: 0,
        joinedAt: new Date(),
      });
    }
  }

  step(dt) {
    const now = Date.now();
    if (this.phase === "ended" && this.resetToIdleAt && now >= this.resetToIdleAt) {
      this.resetToIdle();
    }

    if (this.phase === "lobby" && this.lobbyEndsAt && now >= this.lobbyEndsAt) {
      this.phase = "running";
      this.combatStartedAt = now;
      this.combatEndsAt = now + CONFIG.matchDurationSeconds * 1000;
      this.nextHamAt = now + randomSeconds(CONFIG.hamSpawnMinSeconds, CONFIG.hamSpawnMaxSeconds) * 1000;
      this.nextChestAt = now + randomSeconds(CONFIG.chestSpawnMinSeconds, CONFIG.chestSpawnMaxSeconds) * 1000;
    }

    if (this.phase !== "running") return;

    if (this.combatEndsAt && now >= this.combatEndsAt) {
      this.endMatch(null, "completed");
      return;
    }

    for (const player of this.players.values()) {
      if (player.status === "frozen" && now >= player.frozenUntil) {
        player.status = player.connected ? "alive" : "disconnected";
        player.health = player.maxHealth;
      }
      this.updatePlayer(player, dt, now);
    }

    this.updatePickups(now);
  }

  updatePlayer(player, dt, now) {
    if (!player.connected || player.status !== "alive" || !player.characterId) {
      player.vx = 0;
      player.vy = 0;
      return;
    }

    const input = player.input;
    const dx = Number(input.right) - Number(input.left);
    const dy = Number(input.down) - Number(input.up);
    const len = Math.hypot(dx, dy) || 1;
    player.vx = (dx / len) * CONFIG.playerSpeed;
    player.vy = (dy / len) * CONFIG.playerSpeed;

    if (Math.abs(dx) > Math.abs(dy)) player.facing = dx > 0 ? "right" : "left";
    else if (dy !== 0) player.facing = dy > 0 ? "down" : "up";

    player.x = clamp(player.x + player.vx * dt, CONFIG.playfieldMinX, CONFIG.playfieldMaxX);
    player.y = clamp(player.y + player.vy * dt, CONFIG.playfieldMinY, CONFIG.playfieldMaxY);
    this.resolvePlayerCollisions(player);
    this.collectHams(player);

    if (input.attack && now >= player.attackCooldownUntil) {
      player.attackCooldownUntil = now + CONFIG.attackCooldownMs;
      player.attackActiveUntil = now + CONFIG.attackActiveMs;
      player.input.attack = false;
      this.resolveAttack(player);
    }
  }

  resolvePlayerCollisions(player) {
    for (const other of this.players.values()) {
      if (other.id === player.id) continue;
      if (other.status !== "alive" && other.status !== "frozen" && other.status !== "disconnected") {
        continue;
      }
      const dx = player.x - other.x;
      const dy = player.y - other.y;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = CONFIG.playerRadius * 2;
      if (dist >= minDist) continue;
      const push = (minDist - dist) / 2;
      player.x = clamp(player.x + (dx / dist) * push, CONFIG.playfieldMinX, CONFIG.playfieldMaxX);
      player.y = clamp(player.y + (dy / dist) * push, CONFIG.playfieldMinY, CONFIG.playfieldMaxY);
      if (other.status === "alive" && other.connected) {
        other.x = clamp(other.x - (dx / dist) * push, CONFIG.playfieldMinX, CONFIG.playfieldMaxX);
        other.y = clamp(other.y - (dy / dist) * push, CONFIG.playfieldMinY, CONFIG.playfieldMaxY);
      }
    }
  }

  resolveAttack(attacker) {
    const hit = attackPoint(attacker);

    for (const target of this.players.values()) {
      if (target.id === attacker.id) continue;
      if (target.status !== "alive") continue;
      if (distance(hit, target) > CONFIG.attackWidth) continue;

      target.health = Math.max(0, target.health - CONFIG.attackDamage);
      target.damageTaken += CONFIG.attackDamage;
      attacker.damageDealt += CONFIG.attackDamage;
      this.applyKnockback(target, attacker.facing);

      if (target.health <= 0) {
        target.status = "frozen";
        target.frozenUntil = Date.now() + CONFIG.freezeSeconds * 1000;
        target.deaths += 1;
        target.score += CONFIG.deathScore;
        attacker.slays += 1;
        attacker.score += CONFIG.slayScore;
      }
    }

    for (const pickup of [...this.pickups.values()]) {
      if (pickup.kind !== "chest") continue;
      if (distance(hit, pickup) > CONFIG.attackWidth) continue;
      pickup.hitsRemaining -= 1;
      if (pickup.hitsRemaining <= 0) {
        attacker.score += CONFIG.chestScore;
        attacker.chestsOpened += 1;
        this.pickups.delete(pickup.id);
      }
    }
  }

  applyKnockback(target, facing) {
    const vector = directionVector(facing);
    target.x = clamp(
      target.x + vector.x * CONFIG.knockbackDistance,
      CONFIG.playfieldMinX,
      CONFIG.playfieldMaxX
    );
    target.y = clamp(
      target.y + vector.y * CONFIG.knockbackDistance,
      CONFIG.playfieldMinY,
      CONFIG.playfieldMaxY
    );
  }

  collectHams(player) {
    for (const pickup of [...this.pickups.values()]) {
      if (pickup.kind !== "ham") continue;
      if (distance(player, pickup) > CONFIG.playerRadius + 9) continue;
      player.health = Math.min(player.maxHealth, player.health + CONFIG.hamHealAmount);
      player.hamsCollected += 1;
      this.pickups.delete(pickup.id);
    }
  }

  updatePickups(now) {
    const activeHams = [...this.pickups.values()].filter((p) => p.kind === "ham").length;
    if (now >= this.nextHamAt) {
      if (activeHams < CONFIG.maxActiveHams) this.spawnHam();
      this.nextHamAt = now + randomSeconds(CONFIG.hamSpawnMinSeconds, CONFIG.hamSpawnMaxSeconds) * 1000;
    }

    const activeChests = [...this.pickups.values()].filter((p) => p.kind === "chest").length;
    if (now >= this.nextChestAt) {
      if (activeChests < CONFIG.maxActiveChests) this.spawnChest();
      this.nextChestAt = now + randomSeconds(CONFIG.chestSpawnMinSeconds, CONFIG.chestSpawnMaxSeconds) * 1000;
    }
  }

  spawnHam() {
    const pos = this.randomSpawn();
    const id = randomId();
    this.pickups.set(id, { id, kind: "ham", ...pos });
  }

  spawnChest() {
    const pos = this.randomSpawn();
    const maxHits = randomInt(CONFIG.chestMinHits, CONFIG.chestMaxHits);
    const id = randomId();
    this.pickups.set(id, {
      id,
      kind: "chest",
      ...pos,
      hitsRemaining: maxHits,
      maxHits,
    });
  }

  endMatch(identity, status) {
    if (this.phase !== "lobby" && this.phase !== "running") return;
    if (identity && identity.playerId !== this.startedByPlayerId) {
      this.sendTo(identity.playerId, {
        type: "error",
        message: "Only the member who started this match can end it.",
      });
      return;
    }

    this.phase = "ended";
    this.endedByPlayerId = identity?.playerId ?? null;
    this.endedAt = Date.now();
    this.resetToIdleAt = this.endedAt + CONFIG.finalResultsSeconds * 1000;
    this.lobbyEndsAt = null;
    this.combatEndsAt = null;
    this.pickups.clear();
    void this.persistMatch(status);
  }

  resetToIdle() {
    if (this.phase !== "ended") return;

    this.phase = "idle";
    this.matchId = null;
    this.startedByPlayerId = null;
    this.endedByPlayerId = null;
    this.lobbyEndsAt = null;
    this.combatStartedAt = null;
    this.combatEndsAt = null;
    this.matchStartedAt = null;
    this.endedAt = null;
    this.resetToIdleAt = null;
    this.pickups.clear();
    this.nextHamAt = Infinity;
    this.nextChestAt = Infinity;
    this.pruneInactivePlayers();
  }

  pruneInactivePlayers() {
    if (this.phase !== "idle" && this.phase !== "ended") return;

    for (const [playerId, player] of this.players) {
      if (!player.connected) this.players.delete(playerId);
    }
  }

  async persistMatch(status) {
    if (
      !process.env.DATABASE_URL ||
      !this.matchId ||
      this.persistedMatchId === this.matchId ||
      this.persistingMatchId === this.matchId
    ) {
      return;
    }
    const matchId = this.matchId;
    this.persistingMatchId = matchId;

    try {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      const [match] = await sql`
        insert into melee_matches (
          id,
          status,
          started_by_player_id,
          ended_by_player_id,
          lobby_countdown_seconds,
          duration_seconds,
          started_at,
          combat_started_at,
          ended_at
        ) values (
          ${this.matchId},
          ${status},
          ${this.startedByPlayerId},
          ${this.endedByPlayerId},
          ${CONFIG.lobbyCountdownSeconds},
          ${CONFIG.matchDurationSeconds},
          ${new Date(this.matchStartedAt)},
          ${this.combatStartedAt ? new Date(this.combatStartedAt) : null},
          ${new Date()}
        )
        returning id
      `;

      const ranked = this.leaderboard();
      for (const row of ranked) {
        const player = this.players.get(row.playerId);
        if (!player) continue;
        await sql`
          insert into melee_match_players (
            match_id,
            player_id,
            character_id,
            score,
            slays,
            deaths,
            damage_dealt,
            damage_taken,
            hams_collected,
            chests_opened,
            final_rank,
            joined_at
          ) values (
            ${match.id},
            ${player.id},
            ${player.characterId ?? "unselected"},
            ${player.score},
            ${player.slays},
            ${player.deaths},
            ${player.damageDealt},
            ${player.damageTaken},
            ${player.hamsCollected},
            ${player.chestsOpened},
            ${ranked.findIndex((r) => r.playerId === player.id) + 1},
            ${player.joinedAt}
          )
        `;
      }
      await sql.end();
      this.persistedMatchId = matchId;
    } catch (err) {
      console.error("Failed to persist match", err);
    } finally {
      if (this.persistingMatchId === matchId) this.persistingMatchId = null;
    }
  }

  broadcast() {
    for (const [ws, identity] of this.sockets) {
      if (ws.readyState === 1) send(ws, this.snapshot(identity.playerId));
    }
  }

  sendTo(playerId, message) {
    for (const [ws, identity] of this.sockets) {
      if (identity.playerId === playerId && ws.readyState === 1) {
        send(ws, message);
      }
    }
  }

  snapshot(localPlayerId) {
    return {
      type: "snapshot",
      phase: this.phase,
      matchId: this.matchId,
      serverTime: Date.now(),
      lobbyEndsAt: this.lobbyEndsAt,
      combatEndsAt: this.combatEndsAt,
      startedByPlayerId: this.startedByPlayerId,
      localPlayerId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        handle: p.handle,
        characterId: p.characterId,
        x: Math.round(p.x),
        y: Math.round(p.y),
        facing: p.facing,
        health: p.health,
        maxHealth: p.maxHealth,
        status: p.status,
        score: p.score,
        slays: p.slays,
        deaths: p.deaths,
        connected: p.connected,
        isAttacking: Date.now() < p.attackActiveUntil,
      })),
      pickups: [...this.pickups.values()],
      leaderboard: this.leaderboard(),
    };
  }

  leaderboard() {
    return [...this.players.values()]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.slays !== a.slays) return b.slays - a.slays;
        if (a.deaths !== b.deaths) return a.deaths - b.deaths;
        return a.joinedAt.getTime() - b.joinedAt.getTime();
      })
      .map((p) => ({
        playerId: p.id,
        handle: p.handle,
        score: p.score,
        slays: p.slays,
        deaths: p.deaths,
      }));
  }

  randomSpawn() {
    for (let i = 0; i < 30; i += 1) {
      const pos = {
        x: randomInt(CONFIG.playfieldMinX, CONFIG.playfieldMaxX),
        y: randomInt(CONFIG.playfieldMinY, CONFIG.playfieldMaxY),
      };
      const crowded = [...this.players.values()].some((p) => distance(p, pos) < 48);
      if (!crowded) return pos;
    }
    return {
      x: randomInt(CONFIG.playfieldMinX, CONFIG.playfieldMaxX),
      y: randomInt(CONFIG.playfieldMinY, CONFIG.playfieldMaxY),
    };
  }
}

function emptyInput() {
  return { seq: 0, up: false, down: false, left: false, right: false, attack: false };
}

function sanitizeInput(input) {
  const seq = Number(input?.seq);
  return {
    seq: Number.isSafeInteger(seq) && seq > 0 ? seq : 0,
    up: Boolean(input?.up),
    down: Boolean(input?.down),
    left: Boolean(input?.left),
    right: Boolean(input?.right),
    attack: Boolean(input?.attack),
  };
}

function attackPoint(player) {
  const vector = directionVector(player.facing);
  return {
    x: player.x + vector.x * CONFIG.attackRange,
    y: player.y + vector.y * CONFIG.attackRange,
  };
}

function directionVector(facing) {
  if (facing === "left") return { x: -1, y: 0 };
  if (facing === "right") return { x: 1, y: 0 };
  if (facing === "up") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomSeconds(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomId() {
  return crypto.randomUUID();
}

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

async function start() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  const manager = new MatchManager();

  await app.prepare();

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get("token");
      if (!token) throw new Error("missing token");
      const identity = await verifySocketToken(token);

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, identity);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (ws, _req, identity) => {
    manager.connect(ws, identity);
  });

  setInterval(() => manager.step(1 / 30), 1000 / 30);
  setInterval(() => manager.broadcast(), 100);

  server.listen(port, hostname, () => {
    console.log(`Roundtable Melee listening on http://${hostname}:${port}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
