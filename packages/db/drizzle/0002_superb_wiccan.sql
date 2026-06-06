CREATE TYPE "public"."onboarding_status" AS ENUM('queued', 'discovering', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"input_url" text NOT NULL,
	"status" "onboarding_status" DEFAULT 'queued' NOT NULL,
	"retailer_id" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_onboarding" ADD CONSTRAINT "store_onboarding_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_onboarding" ADD CONSTRAINT "store_onboarding_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_onboarding_org_time_idx" ON "store_onboarding" USING btree ("org_id","created_at");