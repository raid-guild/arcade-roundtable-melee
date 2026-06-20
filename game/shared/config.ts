import { CHARACTER_IDS, DEFAULT_GAME_CONFIG } from "./config-values.mjs";

export type GameConfig = {
  readonly lobbyCountdownSeconds: number;
  readonly matchDurationSeconds: number;
  readonly finalResultsSeconds: number;
  readonly maxPlayers: number;
  readonly freezeSeconds: number;
  readonly playerMaxHealth: number;
  readonly playerSpeed: number;
  readonly playerRadius: number;
  readonly hamHealAmount: number;
  readonly slayScore: number;
  readonly deathScore: number;
  readonly chestScore: number;
  readonly hamSpawnMinSeconds: number;
  readonly hamSpawnMaxSeconds: number;
  readonly maxActiveHams: number;
  readonly chestSpawnMinSeconds: number;
  readonly chestSpawnMaxSeconds: number;
  readonly maxActiveChests: number;
  readonly chestMinHits: number;
  readonly chestMaxHits: number;
  readonly attackDamage: number;
  readonly attackCooldownMs: number;
  readonly attackActiveMs: number;
  readonly attackRange: number;
  readonly attackWidth: number;
  readonly knockbackDistance: number;
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly leaderboardWidth: number;
  readonly playfieldMinX: number;
  readonly playfieldMaxX: number;
  readonly playfieldMinY: number;
  readonly playfieldMaxY: number;
};

export const GAME_CONFIG = DEFAULT_GAME_CONFIG as GameConfig;

export const LOGICAL_W = GAME_CONFIG.arenaWidth + GAME_CONFIG.leaderboardWidth;
export const LOGICAL_H = GAME_CONFIG.arenaHeight;

export const CHARACTERS = CHARACTER_IDS as readonly [
  "alchemist",
  "archer",
  "cleric",
  "druid",
  "dwarf",
  "healer",
  "hunter",
  "monk",
  "necromancer",
  "paladin",
  "ranger",
  "rogue",
  "scribe",
  "tavern-keeper",
  "warrior",
  "wizard"
];

export type CharacterId = (typeof CHARACTERS)[number];

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && CHARACTERS.includes(value as CharacterId);
}
