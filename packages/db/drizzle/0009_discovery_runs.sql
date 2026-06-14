CREATE TABLE IF NOT EXISTS "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid,
	"onboarding_id" uuid,
	"status" text NOT NULL,
	"current_stage" text,
	"stages_completed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"token_usage" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_onboarding_id_store_onboarding_id_fk" FOREIGN KEY ("onboarding_id") REFERENCES "public"."store_onboarding"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_runs_onboarding_id_idx" ON "discovery_runs" USING btree ("onboarding_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_runs_status_idx" ON "discovery_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_runs_retailer_id_idx" ON "discovery_runs" USING btree ("retailer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_runs_started_at_idx" ON "discovery_runs" USING btree ("started_at");
