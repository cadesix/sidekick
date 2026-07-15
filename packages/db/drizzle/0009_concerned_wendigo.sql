CREATE TABLE "device_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_token" text NOT NULL,
	"platform" text NOT NULL,
	"project_id" text NOT NULL,
	"permission_status" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_tokens_expo_token_unique" UNIQUE("expo_token")
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_push_token_id" uuid NOT NULL,
	"message_id" bigint,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expo_ticket_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"proactive_enabled" boolean DEFAULT false NOT NULL,
	"checkins_enabled" boolean DEFAULT true NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"awake_start" text DEFAULT '09:00' NOT NULL,
	"awake_end" text DEFAULT '21:30' NOT NULL,
	"proactive_paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proactive_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text DEFAULT 'friend' NOT NULL,
	"local_slot_date" date NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"eligibility_user_message_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancellation_reason" text,
	"prompt_version" text,
	"model" text,
	"opened_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_user_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "proactive_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "proactive_sequence" integer;--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_device_push_token_id_device_push_tokens_id_fk" FOREIGN KEY ("device_push_token_id") REFERENCES "public"."device_push_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_turns" ADD CONSTRAINT "proactive_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_turns" ADD CONSTRAINT "proactive_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_push_tokens_user_status_idx" ON "device_push_tokens" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "device_push_tokens_device_project_idx" ON "device_push_tokens" USING btree ("device_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_token_message_kind_idx" ON "notification_outbox" USING btree ("device_push_token_id","message_id","kind");--> statement-breakpoint
CREATE INDEX "notification_outbox_status_available_idx" ON "notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_turns_user_slot_kind_idx" ON "proactive_turns" USING btree ("user_id","local_slot_date","kind");--> statement-breakpoint
CREATE INDEX "proactive_turns_status_scheduled_idx" ON "proactive_turns" USING btree ("status","scheduled_for");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_proactive_turn_id_proactive_turns_id_fk" FOREIGN KEY ("proactive_turn_id") REFERENCES "public"."proactive_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_proactive_turn_sequence_idx" ON "messages" USING btree ("proactive_turn_id","proactive_sequence");
--> statement-breakpoint
INSERT INTO "notification_preferences" ("user_id") SELECT "id" FROM "users" ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "conversations" c
SET "last_user_message_at" = activity.last_user_message_at
FROM (
  SELECT "conversation_id", max("created_at") AS last_user_message_at
  FROM "messages"
  WHERE "role" = 'user'
  GROUP BY "conversation_id"
) activity
WHERE activity."conversation_id" = c."id";
