ALTER TABLE "attachments" ADD COLUMN "waveform" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reactions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;