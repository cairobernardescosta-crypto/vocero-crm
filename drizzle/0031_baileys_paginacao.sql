CREATE INDEX IF NOT EXISTS "baileys_chat_activity_page_idx" ON "baileys_chat" ("organization_id", COALESCE("last_message_at", "updated_at") DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baileys_message_chat_page_idx" ON "baileys_message" ("organization_id", "chat_id", "occurred_at" DESC, "id" DESC);
