"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHARACTERS,
  GAME_CONFIG,
  LOGICAL_H,
  LOGICAL_W,
  type CharacterId,
} from "@/game/shared/config";
import type {
  ClientMessage,
  InputState,
  MatchSnapshot,
  ServerMessage,
  SnapshotPlayer,
} from "@/game/shared/protocol";

interface SessionResponse {
  authenticated: boolean;
  playerId: string | null;
  handle: string | null;
  canStartGame: boolean;
  portalUrl: string;
}

interface SpriteSheet {
  image: HTMLImageElement;
  cell: { w: number; h: number };
  names: string[];
}

interface VisualEffect {
  id: string;
  kind: "score" | "damage" | "impact" | "thaw" | "chest";
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  durationMs: number;
}

type AudioCue =
  | "ui"
  | "attack"
  | "hit"
  | "score"
  | "damage"
  | "pickup"
  | "chest"
  | "freeze"
  | "thaw"
  | "start"
  | "end";

interface ArcadeAudio {
  resume: () => Promise<void>;
  play: (cue: AudioCue) => void;
}

const TOP_CHROME = 50;
const SHOW_HITBOXES = process.env.NEXT_PUBLIC_SHOW_HITBOXES === "true";

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(null);
  const inputRef = useRef<InputState>(emptyInput());
  const seqRef = useRef(0);
  const imagesRef = useRef<Partial<Record<CharacterId, HTMLImageElement>>>({});
  const arenaRef = useRef<HTMLImageElement | null>(null);
  const itemSpritesRef = useRef<SpriteSheet | null>(null);
  const characterSpritesRef = useRef<Partial<Record<CharacterId, SpriteSheet>>>({});
  const reconnectRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const noticeRef = useRef<number | null>(null);
  const effectsRef = useRef<VisualEffect[]>([]);
  const audioRef = useRef<ArcadeAudio | null>(null);

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">(
    "connecting"
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const localPlayer = useMemo(() => {
    if (!snapshot?.localPlayerId) return null;
    return snapshot.players.find((p) => p.id === snapshot.localPlayerId) ?? null;
  }, [snapshot]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  const connect = useCallback(async () => {
    if (!shouldReconnectRef.current) return;
    setConnectionState(reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting");
    try {
      const tokenRes = await fetch("/api/game/socket-token");
      if (!tokenRes.ok) {
        setConnectionState("connecting");
        setError("Portal session required. Launch from the Portal again.");
        return;
      }
      const { token } = (await tokenRes.json()) as { token: string };
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(
        `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`
      );
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        const rejoined = reconnectAttemptsRef.current > 0;
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setConnectionState("connected");
        setError(null);
        if (rejoined) {
          showNotice("REJOINED CURRENT MATCH");
          audioRef.current?.play("ui");
        }
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "snapshot") {
          collectEffects(snapshotRef.current, message, effectsRef.current, audioRef.current);
          snapshotRef.current = message;
          setSnapshot(message);
        }
        if (message.type === "error") setError(message.message);
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (!shouldReconnectRef.current) return;
        reconnectAttemptsRef.current += 1;
        setConnectionState("reconnecting");
        showNotice("CONNECTION LOST. REJOINING...");
        if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
        const delay = Math.min(5000, 1200 + reconnectAttemptsRef.current * 400);
        reconnectRef.current = window.setTimeout(() => {
          void connect();
        }, delay);
      });
    } catch {
      setConnected(false);
      if (!shouldReconnectRef.current) return;
      reconnectAttemptsRef.current += 1;
      setConnectionState("reconnecting");
      setError("Could not connect to the roundtable. Retrying...");
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      const delay = Math.min(5000, 1200 + reconnectAttemptsRef.current * 400);
      reconnectRef.current = window.setTimeout(() => {
        void connect();
      }, delay);
    }
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    fetch("/api/session")
      .then((res) => res.json())
      .then((data: SessionResponse) => setSession(data))
      .catch(() => setError("Could not load session."));
    void connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (noticeRef.current) window.clearTimeout(noticeRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    for (const character of CHARACTERS) {
      const img = new Image();
      img.src = `/characters/${character}.svg`;
      img.decode().catch(() => {});
      imagesRef.current[character] = img;
    }
    loadImage("/backgrounds/arena-dungeon.png").then((img) => {
      arenaRef.current = img;
    });
    loadSpriteSheet("/sprites/items").then((sheet) => {
      itemSpritesRef.current = sheet;
    });
    for (const character of CHARACTERS) {
      loadSpriteSheet(`/sprites/characters/${character}`).then((sheet) => {
        if (sheet) characterSpritesRef.current[character] = sheet;
      });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!trackedKey(event.code)) return;
      event.preventDefault();
      if (event.code === "ArrowUp") inputRef.current.up = true;
      if (event.code === "ArrowDown") inputRef.current.down = true;
      if (event.code === "ArrowLeft") inputRef.current.left = true;
      if (event.code === "ArrowRight") inputRef.current.right = true;
      if (event.code === "Space" && !event.repeat) {
        inputRef.current.attack = true;
        audioRef.current?.play("attack");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!trackedKey(event.code)) return;
      event.preventDefault();
      if (event.code === "ArrowUp") inputRef.current.up = false;
      if (event.code === "ArrowDown") inputRef.current.down = false;
      if (event.code === "ArrowLeft") inputRef.current.left = false;
      if (event.code === "ArrowRight") inputRef.current.right = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const input = { ...inputRef.current, seq: ++seqRef.current };
      send({ type: "input", input });
      inputRef.current.attack = false;
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [send]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fit = () => {
      const availableW = window.innerWidth;
      const availableH = Math.max(240, window.innerHeight - TOP_CHROME);
      const containScale = Math.min(availableW / LOGICAL_W, availableH / LOGICAL_H);
      const scale = Math.max(1, containScale);
      canvas.width = LOGICAL_W;
      canvas.height = LOGICAL_H;
      canvas.style.width = `${LOGICAL_W * scale}px`;
      canvas.style.height = `${LOGICAL_H * scale}px`;
    };
    fit();
    window.addEventListener("resize", fit);

    let raf = 0;
    const frame = () => {
      const pixelFont = getComputedStyle(document.body).fontFamily;
      render(ctx, snapshotRef.current, {
        characterImages: imagesRef.current,
        arena: arenaRef.current,
        items: itemSpritesRef.current,
        characters: characterSpritesRef.current,
        effects: effectsRef.current,
      }, Date.now(), pixelFont);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  const chooseCharacter = (characterId: CharacterId) => {
    send({ type: "select_character", characterId });
    audioRef.current?.play("ui");
  };

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeRef.current) window.clearTimeout(noticeRef.current);
    noticeRef.current = window.setTimeout(() => setNotice(null), 2200);
  };

  const toggleSound = async () => {
    if (!soundEnabled) {
      if (!audioRef.current) audioRef.current = createArcadeAudio();
      await audioRef.current.resume();
      audioRef.current.play("ui");
      setSoundEnabled(true);
      return;
    }
    setSoundEnabled(false);
    audioRef.current = null;
  };

  const phase = snapshot?.phase ?? "idle";
  const canStart = Boolean(session?.canStartGame && (phase === "idle" || phase === "ended"));
  const canEnd = Boolean(
    snapshot?.localPlayerId &&
      snapshot.startedByPlayerId === snapshot.localPlayerId &&
      (phase === "lobby" || phase === "running")
  );
  const showCharacterSelect = Boolean(
    snapshot &&
      (snapshot.phase === "lobby" || snapshot.phase === "running") &&
      !localPlayer?.characterId
  );
  const connectionLabel =
    connectionState === "connected"
      ? "CONNECTED"
      : connectionState === "reconnecting"
        ? "REJOINING"
        : "CONNECTING";

  return (
    <div className="stage">
      <canvas ref={canvasRef} aria-label="Roundtable Melee game canvas" />

      <div className="hud">
        <div className="hud__status">
          {connectionLabel}
          {session?.handle ? ` | ${session.handle.toUpperCase()}` : ""}
        </div>
        <div className="hud__actions">
          <button type="button" onClick={() => void toggleSound()}>
            {soundEnabled ? "SOUND ON" : "SOUND"}
          </button>
          {canStart && (
            <button type="button" onClick={() => {
              audioRef.current?.play("start");
              send({ type: "start_match" });
            }}>
              START
            </button>
          )}
          {canEnd && (
            <button type="button" onClick={() => {
              audioRef.current?.play("end");
              send({ type: "end_match" });
            }}>
              END
            </button>
          )}
        </div>
      </div>

      {showCharacterSelect && (
        <div className="overlay overlay--select">
          <h2>CHOOSE YOUR RAIDER</h2>
          <div className="character-grid">
            {CHARACTERS.map((character) => (
              <button
                key={character}
                type="button"
                onClick={() => chooseCharacter(character)}
              >
                <img
                  src={
                    `/sprites/characters/${character}-preview.png`
                  }
                  alt=""
                />
                <span>{character.replace("-", " ").toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "idle" && !showCharacterSelect && (
        <div className="overlay overlay--compact">
          <h2>NO ACTIVE MELEE</h2>
          <p>{canStart ? "START A MATCH WHEN READY" : "WAITING FOR A MEMBER TO START"}</p>
        </div>
      )}

      {phase === "ended" && !showCharacterSelect && (
        <div className="overlay overlay--final">
          <h2>FINAL SCORES</h2>
          <div className="final-board">
            {(snapshot?.leaderboard ?? []).slice(0, 8).map((row, index) => (
              <div
                key={row.playerId}
                className={row.playerId === snapshot?.localPlayerId ? "is-local" : ""}
              >
                <span>
                  {index + 1}. {row.handle.toUpperCase()}
                </span>
                <span>
                  {row.score} | {row.slays}K {row.deaths}D
                </span>
              </div>
            ))}
          </div>
          <p>{canStart ? "START THE NEXT ROUND WHEN READY" : "FINAL SCORES ARE ON THE BOARD"}</p>
          <a className="dev-link" href="/results">
            SAVED RESULTS
          </a>
        </div>
      )}

      {error && <div className="toast">{error}</div>}
      {!error && notice && <div className="toast toast--notice">{notice}</div>}
    </div>
  );
}

function emptyInput(): InputState {
  return { seq: 0, up: false, down: false, left: false, right: false, attack: false };
}

function trackedKey(code: string) {
  return (
    code === "ArrowUp" ||
    code === "ArrowDown" ||
    code === "ArrowLeft" ||
    code === "ArrowRight" ||
    code === "Space"
  );
}

function render(
  ctx: CanvasRenderingContext2D,
  snapshot: MatchSnapshot | null,
  assets: {
    characterImages: Partial<Record<CharacterId, HTMLImageElement>>;
    arena: HTMLImageElement | null;
    items: SpriteSheet | null;
    characters: Partial<Record<CharacterId, SpriteSheet>>;
    effects: VisualEffect[];
  },
  now: number,
  pixelFont: string
) {
  ctx.imageSmoothingEnabled = false;
  drawArena(ctx, assets.arena);
  if (!snapshot) {
    drawCenterText(ctx, "CONNECTING TO THE ROUNDTABLE", pixelFont);
    drawPanel(ctx, null, now, pixelFont);
    return;
  }
  ctx.canvas.dataset.localPlayerId = snapshot.localPlayerId ?? "";

  for (const pickup of snapshot.pickups) {
    if (pickup.kind === "ham") drawHam(ctx, pickup.x, pickup.y, assets.items);
    else {
      drawChest(
        ctx,
        pickup.x,
        pickup.y,
        pickup.hitsRemaining ?? 1,
        pickup.maxHits ?? 1,
        assets.items
      );
    }
  }

  const players = [...snapshot.players].sort((a, b) => a.y - b.y);
  for (const player of players) {
    drawPlayer(ctx, player, assets.characterImages, assets.characters, pixelFont);
  }
  drawEffects(ctx, assets.effects, now, pixelFont);
  drawMatchBanner(ctx, snapshot, now, pixelFont);
  drawLobbyCountdown(ctx, snapshot, now, pixelFont);
  drawPanel(ctx, snapshot, now, pixelFont);
}

function collectEffects(
  previous: MatchSnapshot | null,
  next: MatchSnapshot,
  effects: VisualEffect[],
  audio: ArcadeAudio | null
) {
  if (!previous || previous.matchId !== next.matchId) return;
  const oldPlayers = new Map(previous.players.map((player) => [player.id, player]));
  const oldPickups = new Map(previous.pickups.map((pickup) => [pickup.id, pickup]));
  const now = Date.now();

  if (previous.phase === "lobby" && next.phase === "running") audio?.play("start");
  if (previous.phase === "running" && next.phase === "ended") audio?.play("end");

  for (const player of next.players) {
    const old = oldPlayers.get(player.id);
    if (!old) continue;

    const scoreDelta = player.score - old.score;
    if (scoreDelta !== 0) {
      audio?.play(scoreDelta > 0 ? "score" : "damage");
      effects.push({
        id: crypto.randomUUID(),
        kind: "score",
        text: `${scoreDelta > 0 ? "+" : ""}${scoreDelta}`,
        x: player.x,
        y: player.y - 44,
        color: scoreDelta > 0 ? "#f3cf63" : "#ff5b5b",
        createdAt: now,
        durationMs: 900,
      });
    }

    const damageDelta = old.health - player.health;
    if (damageDelta > 0 && player.status === "alive") {
      audio?.play("hit");
      effects.push({
        id: crypto.randomUUID(),
        kind: "damage",
        text: `-${damageDelta}`,
        x: player.x,
        y: player.y - 28,
        color: "#ff5b5b",
        createdAt: now,
        durationMs: 620,
      });
      effects.push({
        id: crypto.randomUUID(),
        kind: "impact",
        text: "",
        x: player.x,
        y: player.y - 10,
        color: "#f3cf63",
        createdAt: now,
        durationMs: 260,
      });
    }

    if (player.health > old.health && player.status === "alive" && old.status === "alive") {
      audio?.play("pickup");
    }

    if (old.status === "alive" && player.status === "frozen") {
      audio?.play("freeze");
    }

    if (old.status === "frozen" && player.status === "alive") {
      audio?.play("thaw");
      effects.push({
        id: crypto.randomUUID(),
        kind: "thaw",
        text: "THAW",
        x: player.x,
        y: player.y - 18,
        color: "#6fd3ff",
        createdAt: now,
        durationMs: 760,
      });
    }
  }

  for (const pickup of oldPickups.values()) {
    if (
      next.phase === "running" &&
      pickup.kind === "chest" &&
      !next.pickups.some((nextPickup) => nextPickup.id === pickup.id)
    ) {
      audio?.play("chest");
      effects.push({
        id: crypto.randomUUID(),
        kind: "chest",
        text: "+",
        x: pickup.x,
        y: pickup.y - 6,
        color: "#f3cf63",
        createdAt: now,
        durationMs: 720,
      });
    }
  }

  const cutoff = now - 1400;
  while (effects.length > 80 || (effects[0] && effects[0].createdAt < cutoff)) {
    effects.shift();
  }
}

function createArcadeAudio(): ArcadeAudio {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextClass = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextClass) {
    return {
      resume: async () => {},
      play: () => {},
    };
  }
  const ctx = new AudioContextClass();
  const master = ctx.createGain();
  master.gain.value = 0.08;
  master.connect(ctx.destination);

  const tone = (
    frequency: number,
    duration: number,
    type: OscillatorType = "square",
    volume = 1,
    when = ctx.currentTime
  ) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(36, frequency * 0.55), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.025);
  };

  const noise = (duration: number, volume = 0.7) => {
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(master);
    source.start();
  };

  const play = (cue: AudioCue) => {
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    if (cue === "ui") tone(740, 0.055, "square", 0.55, now);
    if (cue === "attack") {
      tone(520, 0.055, "sawtooth", 0.65, now);
      noise(0.035, 0.25);
    }
    if (cue === "hit") {
      noise(0.065, 0.75);
      tone(130, 0.07, "square", 0.45, now);
    }
    if (cue === "score") {
      tone(660, 0.07, "square", 0.55, now);
      tone(990, 0.09, "square", 0.45, now + 0.055);
    }
    if (cue === "damage") tone(180, 0.12, "sawtooth", 0.55, now);
    if (cue === "pickup") {
      tone(820, 0.045, "square", 0.5, now);
      tone(1240, 0.065, "square", 0.42, now + 0.04);
    }
    if (cue === "chest") {
      noise(0.11, 0.6);
      tone(330, 0.08, "square", 0.55, now);
      tone(720, 0.08, "square", 0.4, now + 0.06);
    }
    if (cue === "freeze") {
      tone(760, 0.16, "triangle", 0.45, now);
      tone(380, 0.18, "triangle", 0.35, now + 0.04);
    }
    if (cue === "thaw") {
      tone(420, 0.055, "square", 0.42, now);
      tone(640, 0.065, "square", 0.42, now + 0.045);
    }
    if (cue === "start") {
      tone(440, 0.08, "square", 0.5, now);
      tone(660, 0.08, "square", 0.5, now + 0.07);
      tone(880, 0.12, "square", 0.5, now + 0.14);
    }
    if (cue === "end") {
      tone(880, 0.08, "square", 0.45, now);
      tone(550, 0.11, "square", 0.45, now + 0.08);
      tone(330, 0.14, "square", 0.45, now + 0.18);
    }
  };

  return {
    resume: () => ctx.resume(),
    play,
  };
}

function drawArena(ctx: CanvasRenderingContext2D, arena: HTMLImageElement | null) {
  const w = GAME_CONFIG.arenaWidth;
  const h = GAME_CONFIG.arenaHeight;
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  if (arena?.complete) {
    ctx.drawImage(arena, 0, 0, w, h);
    return;
  }

  ctx.fillStyle = "#22314b";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2f3f5f";
  ctx.fillRect(18, 28, w - 36, h - 46);

  for (let y = 34; y < h - 24; y += 24) {
    for (let x = 24; x < w - 24; x += 48) {
      ctx.fillStyle = (x + y) % 96 === 0 ? "#40506d" : "#364762";
      ctx.fillRect(x + ((y / 24) % 2) * 24, y, 44, 20);
    }
  }

  ctx.fillStyle = "#121a2c";
  ctx.fillRect(0, 0, w, 30);
  ctx.fillRect(0, 0, 20, h);
  ctx.fillRect(w - 20, 0, 20, h);
  ctx.fillRect(0, h - 18, w, 18);

  for (const x of [90, 230, 370, 510, 650]) drawTorch(ctx, x, 19);
}

function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#59493b";
  ctx.fillRect(x - 3, y, 6, 12);
  ctx.fillStyle = "#ffcc66";
  ctx.fillRect(x - 4, y - 8, 8, 8);
  ctx.fillStyle = "#f46d43";
  ctx.fillRect(x - 2, y - 5, 4, 6);
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: SnapshotPlayer,
  images: Partial<Record<CharacterId, HTMLImageElement>>,
  characterSprites: Partial<Record<CharacterId, SpriteSheet>>,
  pixelFont: string
) {
  const x = player.x;
  const y = player.y;
  const isLocal = player.id === snapshotLocalId(ctx);

  if (player.isAttacking) drawAttack(ctx, player);

  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(x - 13, y + 12, 26, 6);

  const poseSheet = player.characterId ? characterSprites[player.characterId] : null;
  if (poseSheet?.image.complete) {
    drawSheetSprite(ctx, poseSheet, poseName(player), x - 24, y - 40, 48, 60);
  } else {
    const image = player.characterId ? images[player.characterId] : null;
    if (image?.complete) {
      ctx.drawImage(image, x - 18, y - 32, 36, 42);
    } else {
      ctx.fillStyle = "#e7d9ad";
      ctx.fillRect(x - 10, y - 24, 20, 30);
    }
  }

  if (player.status === "frozen") {
    ctx.fillStyle = "rgba(111, 211, 255, 0.64)";
    ctx.fillRect(x - 17, y - 34, 34, 46);
    ctx.strokeStyle = "#d9f7ff";
    ctx.strokeRect(x - 17, y - 34, 34, 46);
  }

  if (player.status === "disconnected") {
    ctx.fillStyle = "rgba(120, 151, 180, 0.68)";
    ctx.fillRect(x - 17, y - 34, 34, 46);
    ctx.strokeStyle = "#8ea8c4";
    for (let i = 0; i < 4; i += 1) ctx.strokeRect(x - 19 + i * 2, y - 36 + i * 2, 38 - i * 4, 50 - i * 4);
  }

  ctx.fillStyle = "#05070d";
  ctx.fillRect(x - 18, y - 42, 36, 5);
  ctx.fillStyle = player.health > 35 ? "#4ade80" : "#ff5b5b";
  ctx.fillRect(x - 17, y - 41, Math.max(0, 34 * (player.health / player.maxHealth)), 3);

  ctx.fillStyle = isLocal ? "#f3cf63" : "#f5efe2";
  ctx.font = `8px ${pixelFont}`;
  ctx.textAlign = "center";
  ctx.fillText(player.handle.toUpperCase().slice(0, 10), x, y + 25);
}

function snapshotLocalId(ctx: CanvasRenderingContext2D) {
  return (ctx.canvas as HTMLCanvasElement).dataset.localPlayerId;
}

function drawAttack(ctx: CanvasRenderingContext2D, player: SnapshotPlayer) {
  const offset = attackOffset(player.facing);
  const cx = player.x + offset.x;
  const cy = player.y + offset.y;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(attackRotation(player.facing));

  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = "#f3cf63";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 18, -0.7, 0.7);
  ctx.stroke();

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#fff2a6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 21, -0.42, 0.42);
  ctx.stroke();
  ctx.restore();

  if (SHOW_HITBOXES) {
    ctx.fillStyle = "rgba(243, 207, 99, 0.28)";
    ctx.fillRect(cx - 10, cy - 10, 20, 20);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.strokeRect(cx - 10, cy - 10, 20, 20);
  }
}

function poseName(player: SnapshotPlayer) {
  if (player.status === "frozen") return "frozen";
  if (player.status === "disconnected") return "disconnected";
  if (player.isAttacking) return `attack-${player.facing}`;
  return `idle-${player.facing}`;
}

function attackOffset(facing: string) {
  if (facing === "left") return { x: -28, y: 0 };
  if (facing === "right") return { x: 28, y: 0 };
  if (facing === "up") return { x: 0, y: -28 };
  return { x: 0, y: 28 };
}

function attackRotation(facing: string) {
  if (facing === "right") return 0;
  if (facing === "left") return Math.PI;
  if (facing === "up") return -Math.PI / 2;
  return Math.PI / 2;
}

function drawHam(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  items: SpriteSheet | null
) {
  if (items?.image.complete) {
    drawSheetSprite(ctx, items, "ham", x - 14, y - 14, 28, 28);
    return;
  }
  ctx.fillStyle = "#e98669";
  ctx.fillRect(x - 8, y - 6, 14, 12);
  ctx.fillStyle = "#ffd6a8";
  ctx.fillRect(x + 4, y - 3, 8, 6);
  ctx.fillStyle = "#f5efe2";
  ctx.fillRect(x + 10, y - 1, 5, 2);
}

function drawChest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hits: number,
  max: number,
  items: SpriteSheet | null
) {
  if (items?.image.complete) {
    const ratio = hits / max;
    const name = ratio <= 0 ? "chest-open" : ratio < 0.66 ? "chest-damaged" : "chest-closed";
    drawSheetSprite(ctx, items, name, x - 18, y - 18, 36, 36);
    return;
  }
  ctx.fillStyle = "#7a4d2b";
  ctx.fillRect(x - 12, y - 8, 24, 16);
  ctx.fillStyle = "#a66a33";
  ctx.fillRect(x - 10, y - 10, 20, 8);
  ctx.fillStyle = "#f3cf63";
  ctx.fillRect(x - 2, y - 2, 4, 6);
  ctx.fillStyle = "#05070d";
  ctx.fillRect(x - 12, y + 11, 24, 3);
  ctx.fillStyle = "#f3cf63";
  ctx.fillRect(x - 12, y + 11, Math.max(2, 24 * (hits / max)), 3);
}

function drawMatchBanner(
  ctx: CanvasRenderingContext2D,
  snapshot: MatchSnapshot,
  now: number,
  pixelFont: string
) {
  let text = "";
  if (snapshot.phase === "running" && snapshot.combatEndsAt) {
    text = `TIME ${formatSeconds(Math.max(0, Math.ceil((snapshot.combatEndsAt - now) / 1000)))}`;
  }
  if (!text) return;
  ctx.fillStyle = "rgba(5,7,13,0.78)";
  ctx.fillRect(226, 8, 268, 24);
  ctx.fillStyle = "#f3cf63";
  ctx.font = `12px ${pixelFont}`;
  ctx.textAlign = "center";
  ctx.fillText(text, 360, 25);
}

function drawLobbyCountdown(
  ctx: CanvasRenderingContext2D,
  snapshot: MatchSnapshot,
  now: number,
  pixelFont: string
) {
  if (snapshot.phase !== "lobby" || !snapshot.lobbyEndsAt) return;

  const remaining = Math.max(0, Math.ceil((snapshot.lobbyEndsAt - now) / 1000));
  const cx = GAME_CONFIG.arenaWidth / 2;
  const cy = GAME_CONFIG.playfieldMinY + (GAME_CONFIG.playfieldMaxY - GAME_CONFIG.playfieldMinY) / 2;

  ctx.fillStyle = "rgba(5, 7, 13, 0.66)";
  ctx.fillRect(cx - 190, cy - 84, 380, 150);
  ctx.strokeStyle = "rgba(243, 207, 99, 0.7)";
  ctx.strokeRect(cx - 190, cy - 84, 380, 150);

  ctx.fillStyle = "#f3cf63";
  ctx.font = `13px ${pixelFont}`;
  ctx.textAlign = "center";
  ctx.fillText("MELEE BEGINS IN", cx, cy - 42);

  ctx.font = `58px ${pixelFont}`;
  ctx.fillText(String(remaining), cx, cy + 34);
}

function drawEffects(
  ctx: CanvasRenderingContext2D,
  effects: VisualEffect[],
  now: number,
  pixelFont: string
) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    const age = now - effect.createdAt;
    if (age >= effect.durationMs) {
      effects.splice(i, 1);
      continue;
    }

    const t = age / effect.durationMs;
    const y = effect.y - t * 18;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = effect.color;
    ctx.font = effect.kind === "score" ? `11px ${pixelFont}` : `9px ${pixelFont}`;
    ctx.textAlign = "center";

    if (effect.kind === "damage") {
      ctx.fillText(effect.text, effect.x, y);
      ctx.strokeStyle = effect.color;
      ctx.strokeRect(effect.x - 16 - t * 6, effect.y - 20 - t * 6, 32 + t * 12, 34 + t * 12);
    } else if (effect.kind === "impact") {
      drawImpactFlash(ctx, effect.x, effect.y, t, effect.color);
    } else if (effect.kind === "thaw") {
      drawThawBurst(ctx, effect.x, effect.y, t, effect.color);
      ctx.fillText(effect.text, effect.x, y - 6);
    } else if (effect.kind === "chest") {
      drawChestBreak(ctx, effect.x, effect.y, t, effect.color);
    } else {
      ctx.fillText(effect.text, effect.x, y);
    }
    ctx.globalAlpha = 1;
  }
}

function drawThawBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  color: string
) {
  const r = 12 + t * 22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - r / 2, y - r / 2, r, r);
  ctx.strokeRect(x - r * 0.35, y - r * 0.8, r * 0.7, r * 1.6);
}

function drawChestBreak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  color: string
) {
  const spread = 8 + t * 24;
  ctx.fillStyle = color;
  for (const [dx, dy] of [
    [-1, -0.6],
    [1, -0.7],
    [-0.55, 0.75],
    [0.65, 0.6],
    [0, -1],
  ]) {
    ctx.fillRect(x + dx * spread - 2, y + dy * spread - 2, 4, 4);
  }
  ctx.strokeStyle = "#fff2a6";
  ctx.strokeRect(x - spread * 0.55, y - spread * 0.45, spread * 1.1, spread * 0.9);
}

function drawImpactFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  color: string
) {
  const r = 5 + t * 8;
  ctx.globalAlpha = Math.max(0, 0.86 - t * 0.55);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  snapshot: MatchSnapshot | null,
  now: number,
  pixelFont: string
) {
  const x = GAME_CONFIG.arenaWidth;
  ctx.fillStyle = "#080c16";
  ctx.fillRect(x, 0, GAME_CONFIG.leaderboardWidth, LOGICAL_H);
  ctx.fillStyle = "#f3cf63";
  ctx.font = `13px ${pixelFont}`;
  ctx.textAlign = "left";
  ctx.fillText("LEADERBOARD", x + 16, 28);

  if (!snapshot) return;

  ctx.font = `9px ${pixelFont}`;
  let y = 56;
  for (const [index, row] of snapshot.leaderboard.slice(0, 10).entries()) {
    ctx.fillStyle = row.playerId === snapshot.localPlayerId ? "#f3cf63" : "#f5efe2";
    ctx.fillText(`${index + 1}. ${row.handle.toUpperCase().slice(0, 10)}`, x + 16, y);
    ctx.textAlign = "right";
    ctx.fillText(String(row.score), LOGICAL_W - 14, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "#8ea8c4";
    ctx.fillText(`${row.slays}K ${row.deaths}D`, x + 28, y + 14);
    y += 32;
  }

  const local = snapshot.players.find((p) => p.id === snapshot.localPlayerId);
  if (local) {
    ctx.fillStyle = "#22314b";
    ctx.fillRect(x + 12, LOGICAL_H - 92, GAME_CONFIG.leaderboardWidth - 24, 68);
    ctx.fillStyle = "#f3cf63";
    ctx.fillText("YOU", x + 22, LOGICAL_H - 70);
    ctx.fillStyle = "#f5efe2";
    ctx.fillText(`${local.health}/${local.maxHealth} HP`, x + 22, LOGICAL_H - 52);
    ctx.fillText(local.status.toUpperCase(), x + 22, LOGICAL_H - 34);
  }

  if (snapshot.phase === "ended") {
    ctx.fillStyle = "#ff4a3d";
    ctx.fillText("ROUND COMPLETE", x + 22, LOGICAL_H - 112);
  }
}

function drawCenterText(ctx: CanvasRenderingContext2D, text: string, pixelFont: string) {
  ctx.fillStyle = "#f3cf63";
  ctx.font = `14px ${pixelFont}`;
  ctx.textAlign = "center";
  ctx.fillText(text, GAME_CONFIG.arenaWidth / 2, LOGICAL_H / 2);
}

function drawSheetSprite(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const index = sheet.names.indexOf(name);
  if (index < 0) return;
  ctx.drawImage(
    sheet.image,
    index * sheet.cell.w,
    0,
    sheet.cell.w,
    sheet.cell.h,
    x,
    y,
    w,
    h
  );
}

async function loadImage(src: string) {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

async function loadSpriteSheet(basePath: string): Promise<SpriteSheet | null> {
  try {
    const res = await fetch(`${basePath}.json`);
    if (!res.ok) return null;
    const meta = (await res.json()) as { cell: { w: number; h: number }; names: string[] };
    const image = await loadImage(`${basePath}.png`);
    if (!image) return null;
    return { image, cell: meta.cell, names: meta.names };
  } catch {
    return null;
  }
}

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
