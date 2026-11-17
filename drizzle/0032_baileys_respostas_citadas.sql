ALTER TABLE "baileys_message" ADD COLUMN "sender_jid" text;
ALTER TABLE "baileys_message" ADD COLUMN "reply_to_provider_id" text;
ALTER TABLE "baileys_message" ADD COLUMN "reply_to_type" text;
ALTER TABLE "baileys_message" ADD COLUMN "reply_to_text" text;
CREATE INDEX "baileys_message_org_reply_idx" ON "baileys_message" USING btree ("organization_id","reply_to_provider_id");
