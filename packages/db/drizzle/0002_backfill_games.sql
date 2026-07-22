-- Backfill for DBs that applied the pre-merge 0000_init (before the games
-- feature was squashed into it). 0000_init was regenerated to include
-- game_matches + messages.game_match_id, and 0001 added rate_limits, but any
-- database that had already recorded 0000/0001 as applied never received that
-- DDL. This migration re-applies the missing objects idempotently so existing
-- DBs self-heal via `pnpm migrate`. On a fresh DB (where 0000/0001 create these
-- already) every statement is a no-op.
CREATE TABLE IF NOT EXISTS "game_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"game_type" text NOT NULL,
	"initiator" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"state" jsonb NOT NULL,
	"turn_no" integer DEFAULT 0 NOT NULL,
	"seed" integer NOT NULL,
	"winner" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "game_match_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_matches_user_id_users_id_fk') THEN
		ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_matches_conversation_id_conversations_id_fk') THEN
		ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_game_match_id_game_matches_id_fk') THEN
		ALTER TABLE "messages" ADD CONSTRAINT "messages_game_match_id_game_matches_id_fk" FOREIGN KEY ("game_match_id") REFERENCES "public"."game_matches"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_matches_user_type_status_idx" ON "game_matches" USING btree ("user_id","game_type","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");
