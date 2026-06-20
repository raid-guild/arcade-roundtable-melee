import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { SignJWT } from "jose";
import { WebSocket } from "ws";
import { CHARACTER_IDS } from "../game/shared/config-values.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const target = new URL(process.env.BOT_WS_URL || "ws://localhost:3000/ws");
const botCount = positiveInt(process.env.BOT_COUNT, 6);
const durationMs = positiveInt(process.env.BOT_DURATION_SECONDS, 120) * 1000;
const startMatch = process.env.BOT_START_MATCH !== "false";
const secret = process.env.SOCKET_TOKEN_SECRET ?? process.env.SESSION_SECRET;

if (!secret) {
  console.error("SOCKET_TOKEN_SECRET or SESSION_SECRET is required for socket bots.");
  process.exit(1);
}

const bots = [];
let snapshots = 0;
let errors = 0;
let connected = 0;
let latestPhase = "unknown";

for (let i = 0; i < botCount; i += 1) {
  const bot = await createBot(i);
  bots.push(bot);
  bot.connect();
}

const summaryTimer = setInterval(() => {
  console.log(
    `[bots] connected=${connected}/${botCount} phase=${latestPhase} snapshots=${snapshots} errors=${errors}`
  );
}, 5000);

setTimeout(() => {
  clearInterval(summaryTimer);
  for (const bot of bots) bot.stop();
  console.log(
    `[bots] done connected=${connected}/${botCount} phase=${latestPhase} snapshots=${snapshots} errors=${errors}`
  );
}, durationMs);

async function createBot(index) {
  const playerId = randomUUID();
  const characterId = CHARACTER_IDS[index % CHARACTER_IDS.length];
  const handle = `bot-${String(index + 1).padStart(2, "0")}`;
  const token = await signSocketToken({
    playerId,
    portalUserId: `bot:${playerId}`,
    handle,
    roles: ["member"],
  });

  let ws = null;
  let inputTimer = null;
  let seq = 0;
  let input = randomInput();

  return {
    connect() {
      const url = new URL(target);
      url.searchParams.set("token", token);
      ws = new WebSocket(url);

      ws.on("open", () => {
        connected += 1;
        send({ type: "select_character", characterId });
        if (index === 0 && startMatch) {
          setTimeout(() => send({ type: "start_match" }), 300);
        }
        inputTimer = setInterval(() => {
          if (Math.random() < 0.16) input = randomInput();
          input.seq = ++seq;
          send({ type: "input", input: { ...input } });
        }, 1000 / 15);
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "snapshot") {
          snapshots += 1;
          latestPhase = message.phase;
        }
        if (message.type === "error") {
          errors += 1;
          console.error(`[${handle}] ${message.message}`);
        }
      });

      ws.on("close", () => {
        connected = Math.max(0, connected - 1);
        if (inputTimer) clearInterval(inputTimer);
      });

      ws.on("error", (err) => {
        errors += 1;
        console.error(`[${handle}] socket error: ${err.message}`);
      });
    },
    stop() {
      if (inputTimer) clearInterval(inputTimer);
      ws?.close();
    },
  };

  function send(message) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

async function signSocketToken(identity) {
  return new SignJWT({ ...identity, typ: "roundtable_socket" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

function randomInput() {
  const horizontal = Math.random();
  const vertical = Math.random();
  return {
    seq: 0,
    left: horizontal < 0.33,
    right: horizontal > 0.67,
    up: vertical < 0.33,
    down: vertical > 0.67,
    attack: Math.random() < 0.22,
  };
}

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
