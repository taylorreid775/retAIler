CREATE TABLE IF NOT EXISTS "crawl_health_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"catalog_size" integer,
	"previous_catalog_size" integer,
	"coverage_ratio" real,
	"endpoint_success_rate" real,
	"extraction_success_rate" real,
	"price_field_presence" real,
	"health_score" real NOT NULL,
	"anomalies" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_health_reports" ADD CONSTRAINT "crawl_health_reports_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_health_reports" ADD CONSTRAINT "crawl_health_reports_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_health_reports_retailer_id_idx" ON "crawl_health_reports" USING btree ("retailer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_health_reports_created_at_idx" ON "crawl_health_reports" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_repairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"repair_type" text NOT NULL,
	"before_recipe_version" integer,
	"after_recipe_version" integer,
	"success" boolean NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_repairs" ADD CONSTRAINT "discovery_repairs_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_repairs_retailer_id_idx" ON "discovery_repairs" USING btree ("retailer_id");
