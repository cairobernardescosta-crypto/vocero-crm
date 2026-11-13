-- Fork local: Baileys é um conector opcional, isolado das tabelas Meta.
CREATE TABLE IF NOT EXISTS "baileys_connection" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "phone" text,
  "error" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "baileys_connection_org_uq" ON "baileys_connection" ("organization_id");

CREATE TABLE IF NOT EXISTS "baileys_chat" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "remote_jid" text NOT NULL,
  "name" text,
  "phone" text,
  "last_message" text,
  "last_message_at" timestamp,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "baileys_chat_org_jid_uq" ON "baileys_chat" ("organization_id", "remote_jid");
CREATE INDEX IF NOT EXISTS "baileys_chat_org_last_idx" ON "baileys_chat" ("organization_id", "last_message_at");

CREATE TABLE IF NOT EXISTS "baileys_message" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "chat_id" text NOT NULL REFERENCES "baileys_chat"("id") ON DELETE cascade,
  "provider_id" text NOT NULL,
  "direction" text NOT NULL,
  "type" text DEFAULT 'text' NOT NULL,
  "text" text,
  "status" text DEFAULT 'sent' NOT NULL,
  "error" text,
  "occurred_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "baileys_message_org_provider_uq" ON "baileys_message" ("organization_id", "provider_id");
CREATE INDEX IF NOT EXISTS "baileys_message_org_chat_idx" ON "baileys_message" ("organization_id", "chat_id", "occurred_at");
