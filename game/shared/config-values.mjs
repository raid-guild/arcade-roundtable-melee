export const DEFAULT_GAME_CONFIG = Object.freeze({
  lobbyCountdownSeconds: 15,
  matchDurationSeconds: 180,
  finalResultsSeconds: 30,
  maxPlayers: 10,
  freezeSeconds: 15,
  playerMaxHealth: 100,
  playerSpeed: 96,
  playerRadius: 11,
  hamHealAmount: 25,
  slayScore: 200,
  deathScore: -150,
  chestScore: 50,
  hamSpawnMinSeconds: 15,
  hamSpawnMaxSeconds: 60,
  maxActiveHams: 2,
  chestSpawnMinSeconds: 15,
  chestSpawnMaxSeconds: 60,
  maxActiveChests: 2,
  chestMinHits: 3,
  chestMaxHits: 5,
  attackDamage: 25,
  attackCooldownMs: 580,
  attackActiveMs: 150,
  maxInputMessagesPerSecond: 45,
  attackRange: 32,
  attackWidth: 28,
  knockbackDistance: 26,
  arenaWidth: 720,
  arenaHeight: 660,
  leaderboardWidth: 220,
  playfieldMinX: 46,
  playfieldMaxX: 674,
  playfieldMinY: 126,
  playfieldMaxY: 574,
});

const ENV_KEYS = Object.freeze({
  lobbyCountdownSeconds: "LOBBY_COUNTDOWN_SECONDS",
  matchDurationSeconds: "MATCH_DURATION_SECONDS",
  finalResultsSeconds: "FINAL_RESULTS_SECONDS",
  maxPlayers: "MAX_PLAYERS",
  freezeSeconds: "FREEZE_SECONDS",
  playerMaxHealth: "PLAYER_MAX_HEALTH",
  playerSpeed: "PLAYER_SPEED",
  hamHealAmount: "HAM_HEAL_AMOUNT",
  slayScore: "SLAY_SCORE",
  deathScore: "DEATH_SCORE",
  chestScore: "CHEST_SCORE",
  hamSpawnMinSeconds: "HAM_SPAWN_MIN_SECONDS",
  hamSpawnMaxSeconds: "HAM_SPAWN_MAX_SECONDS",
  maxActiveHams: "MAX_ACTIVE_HAMS",
  chestSpawnMinSeconds: "CHEST_SPAWN_MIN_SECONDS",
  chestSpawnMaxSeconds: "CHEST_SPAWN_MAX_SECONDS",
  maxActiveChests: "MAX_ACTIVE_CHESTS",
  chestMinHits: "CHEST_MIN_HITS",
  chestMaxHits: "CHEST_MAX_HITS",
  attackDamage: "ATTACK_DAMAGE",
  attackCooldownMs: "ATTACK_COOLDOWN_MS",
  attackActiveMs: "ATTACK_ACTIVE_MS",
  maxInputMessagesPerSecond: "MAX_INPUT_MESSAGES_PER_SECOND",
  playfieldMinX: "PLAYFIELD_MIN_X",
  playfieldMaxX: "PLAYFIELD_MAX_X",
  playfieldMinY: "PLAYFIELD_MIN_Y",
  playfieldMaxY: "PLAYFIELD_MAX_Y",
});

export function buildGameConfig(env = {}) {
  const config = { ...DEFAULT_GAME_CONFIG };
  for (const [configKey, envKey] of Object.entries(ENV_KEYS)) {
    config[configKey] = envNumber(env[envKey], DEFAULT_GAME_CONFIG[configKey]);
  }
  return Object.freeze(config);
}

function envNumber(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const CHARACTER_IDS = Object.freeze([
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
  "wizard",
]);
