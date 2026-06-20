import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  portalUserId: text("portal_user_id").unique().notNull(),
  portalProfileId: text("portal_profile_id"),
  handle: text("handle").notNull(),
  picture: text("picture"),
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const roundtableMatches = pgTable(
  "roundtable_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull(),
    startedByPlayerId: uuid("started_by_player_id").references(() => players.id),
    endedByPlayerId: uuid("ended_by_player_id").references(() => players.id),
    lobbyCountdownSeconds: integer("lobby_countdown_seconds").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    combatStartedAt: timestamp("combat_started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("roundtable_matches_status_idx").on(t.status),
    index("roundtable_matches_ended_at_idx").on(t.endedAt),
  ]
);

export const roundtableMatchPlayers = pgTable(
  "roundtable_match_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .references(() => roundtableMatches.id)
      .notNull(),
    playerId: uuid("player_id")
      .references(() => players.id)
      .notNull(),
    characterId: text("character_id").notNull(),
    score: integer("score").notNull(),
    slays: integer("slays").notNull(),
    deaths: integer("deaths").notNull(),
    damageDealt: integer("damage_dealt").notNull(),
    damageTaken: integer("damage_taken").notNull(),
    hamsCollected: integer("hams_collected").notNull(),
    chestsOpened: integer("chests_opened").notNull(),
    finalRank: integer("final_rank").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (t) => [
    index("roundtable_match_players_match_idx").on(t.matchId),
    index("roundtable_match_players_score_idx").on(t.score),
  ]
);
