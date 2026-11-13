ALTER TABLE "baileys_chat" ADD COLUMN IF NOT EXISTS "stage_id" text;
DO $$ BEGIN
 ALTER TABLE "baileys_chat" ADD CONSTRAINT "baileys_chat_stage_id_pipeline_stage_id_fk"
 FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "baileys_chat_org_stage_idx" ON "baileys_chat" ("organization_id", "stage_id");
