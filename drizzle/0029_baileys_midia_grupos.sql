ALTER TABLE "baileys_chat" ADD COLUMN IF NOT EXISTS "is_group" boolean DEFAULT false NOT NULL;
ALTER TABLE "baileys_chat" ADD COLUMN IF NOT EXISTS "avatar_url" text;
ALTER TABLE "baileys_chat" ADD COLUMN IF NOT EXISTS "participants" jsonb;
ALTER TABLE "baileys_message" ADD COLUMN IF NOT EXISTS "media_asset_id" text REFERENCES "media_asset"("id") ON DELETE SET NULL;
