CREATE TABLE "map_contact_geo" (
  "id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "source" text NOT NULL,
  "source_id" text NOT NULL, "address" text, "city" text, "neighborhood" text,
  "latitude" double precision, "longitude" double precision, "status" text DEFAULT 'pending' NOT NULL,
  "provider" text, "address_hash" text, "manual" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_saved_segment" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "name" text NOT NULL, "filters" jsonb NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "marketing_consent" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "source" text NOT NULL, "source_id" text NOT NULL, "status" text NOT NULL, "legal_basis" text, "recorded_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "app_export_log" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "format" text NOT NULL, "row_count" integer NOT NULL, "filters" jsonb, "columns" jsonb, "created_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "campaign_result" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "name" text NOT NULL, "platform" text NOT NULL, "starts_at" timestamp, "ends_at" timestamp, "investment_cents" integer, "reach" integer, "impressions" integer, "clicks" integer, "leads" integer, "conversions" integer, "revenue_cents" integer, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "map_contact_geo" ADD CONSTRAINT "map_contact_geo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "map_saved_segment" ADD CONSTRAINT "map_saved_segment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "marketing_consent" ADD CONSTRAINT "marketing_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app_export_log" ADD CONSTRAINT "app_export_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "campaign_result" ADD CONSTRAINT "campaign_result_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "map_geo_org_source_uq" ON "map_contact_geo" ("organization_id","source","source_id");
--> statement-breakpoint
CREATE INDEX "map_geo_org_status_idx" ON "map_contact_geo" ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "map_segment_org_idx" ON "map_saved_segment" ("organization_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_consent_org_source_uq" ON "marketing_consent" ("organization_id","source","source_id");
--> statement-breakpoint
CREATE INDEX "app_export_org_idx" ON "app_export_log" ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX "campaign_result_org_period_idx" ON "campaign_result" ("organization_id","starts_at");
--> statement-breakpoint
CREATE TABLE "map_settings" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "map_provider" text DEFAULT 'openfreemap' NOT NULL, "geocoder" text DEFAULT 'manual' NOT NULL, "initial_latitude" double precision DEFAULT -19.7276 NOT NULL, "initial_longitude" double precision DEFAULT -50.2009 NOT NULL, "show_pins" boolean DEFAULT true NOT NULL, "show_heatmap" boolean DEFAULT false NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "app_integration" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "provider" text NOT NULL, "account_id" text, "credentials" jsonb, "enabled" boolean DEFAULT false NOT NULL, "status" text DEFAULT 'not_configured' NOT NULL, "last_sync_at" timestamp, "updated_at" timestamp DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "map_settings" ADD CONSTRAINT "map_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "app_integration" ADD CONSTRAINT "app_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "map_settings_org_uq" ON "map_settings" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "app_integration_org_provider_uq" ON "app_integration" ("organization_id","provider");
