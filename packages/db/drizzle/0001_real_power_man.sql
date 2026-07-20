CREATE TABLE "game_matches" (
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
ALTER TABLE "messages" ADD COLUMN "game_match_id" uuid;--> statement-breakpoint
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_matches_user_type_status_idx" ON "game_matches" USING btree ("user_id","game_type","status");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_game_match_id_game_matches_id_fk" FOREIGN KEY ("game_match_id") REFERENCES "public"."game_matches"("id") ON DELETE no action ON UPDATE no action;