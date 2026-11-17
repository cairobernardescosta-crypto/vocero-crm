DROP INDEX IF EXISTS "baileys_chat_activity_page_idx";--> statement-breakpoint
CREATE INDEX "baileys_chat_activity_page_idx" ON "baileys_chat" ("organization_id", COALESCE("last_message_at", timestamp '1970-01-01') DESC, "id" DESC);
