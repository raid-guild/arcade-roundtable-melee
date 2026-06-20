CREATE TABLE "melee_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_user_id" text NOT NULL,
	"portal_profile_id" text,
	"handle" text NOT NULL,
	"picture" text,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "melee_players_portal_user_id_unique" UNIQUE("portal_user_id")
);
--> statement-breakpoint
CREATE TABLE "melee_match_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"score" integer NOT NULL,
	"slays" integer NOT NULL,
	"deaths" integer NOT NULL,
	"damage_dealt" integer NOT NULL,
	"damage_taken" integer NOT NULL,
	"hams_collected" integer NOT NULL,
	"chests_opened" integer NOT NULL,
	"final_rank" integer NOT NULL,
	"joined_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "melee_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"started_by_player_id" uuid,
	"ended_by_player_id" uuid,
	"lobby_countdown_seconds" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"started_at" timestamp with time zone,
	"combat_started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "melee_match_players" ADD CONSTRAINT "melee_match_players_match_id_melee_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."melee_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melee_match_players" ADD CONSTRAINT "melee_match_players_player_id_melee_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."melee_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melee_matches" ADD CONSTRAINT "melee_matches_started_by_player_id_melee_players_id_fk" FOREIGN KEY ("started_by_player_id") REFERENCES "public"."melee_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melee_matches" ADD CONSTRAINT "melee_matches_ended_by_player_id_melee_players_id_fk" FOREIGN KEY ("ended_by_player_id") REFERENCES "public"."melee_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "melee_match_players_match_idx" ON "melee_match_players" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "melee_match_players_score_idx" ON "melee_match_players" USING btree ("score");--> statement-breakpoint
CREATE INDEX "melee_matches_status_idx" ON "melee_matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "melee_matches_ended_at_idx" ON "melee_matches" USING btree ("ended_at");
