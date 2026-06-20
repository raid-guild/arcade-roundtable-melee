import type { CharacterId } from "./config";

export type MatchPhase = "idle" | "lobby" | "running" | "ended";
export type Direction = "up" | "down" | "left" | "right";
export type PlayerStatus = "alive" | "frozen" | "disconnected";
export type PickupKind = "ham" | "chest";

export interface SocketIdentity {
  playerId: string;
  portalUserId: string;
  handle: string;
  roles: string[];
}

export interface InputState {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
}

export interface SnapshotPlayer {
  id: string;
  handle: string;
  characterId: CharacterId | null;
  x: number;
  y: number;
  facing: Direction;
  health: number;
  maxHealth: number;
  status: PlayerStatus;
  score: number;
  slays: number;
  deaths: number;
  connected: boolean;
  isAttacking: boolean;
}

export interface SnapshotPickup {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  hitsRemaining?: number;
  maxHits?: number;
}

export interface LeaderboardRow {
  playerId: string;
  handle: string;
  score: number;
  slays: number;
  deaths: number;
}

export interface MatchSnapshot {
  type: "snapshot";
  phase: MatchPhase;
  matchId: string | null;
  serverTime: number;
  lobbyEndsAt: number | null;
  combatEndsAt: number | null;
  startedByPlayerId: string | null;
  localPlayerId?: string;
  players: SnapshotPlayer[];
  pickups: SnapshotPickup[];
  leaderboard: LeaderboardRow[];
  message?: string;
}

export type ClientMessage =
  | { type: "select_character"; characterId: CharacterId }
  | { type: "input"; input: InputState }
  | { type: "start_match" }
  | { type: "end_match" }
  | { type: "ping"; t: number };

export type ServerMessage =
  | MatchSnapshot
  | { type: "hello"; identity: SocketIdentity }
  | { type: "error"; message: string }
  | { type: "pong"; t: number };
