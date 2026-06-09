ALTER TABLE "retailers" ADD COLUMN IF NOT EXISTS "fingerprint" jsonb;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN IF NOT EXISTS "discovery_confidence" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN IF NOT EXISTS "last_rediscovery_at" timestamptz;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN IF NOT EXISTS "crawl_health_score" real DEFAULT 1.0;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retailer_recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"crawl_recipe" jsonb NOT NULL,
	"fingerprint" jsonb,
	"validation_report" jsonb,
	"confidence" real NOT NULL,
	"primary_endpoint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "retailer_recipe_versions_retailer_id_version_unique" UNIQUE("retailer_id","version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_recipe_versions" ADD CONSTRAINT "retailer_recipe_versions_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_recipe_versions_retailer_id_idx" ON "retailer_recipe_versions" USING btree ("retailer_id");
