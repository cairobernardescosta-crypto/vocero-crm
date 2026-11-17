CREATE INDEX "baileys_message_text_search_idx"
ON "baileys_message"
USING gin (to_tsvector('simple', coalesce("text", '')))
WHERE "text" IS NOT NULL;
