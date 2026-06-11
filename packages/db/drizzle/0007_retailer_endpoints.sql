CREATE TABLE IF NOT EXISTS "retailer_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"endpoint_type" text NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"headers" jsonb DEFAULT '{}',
	"pagination_style" text,
	"reliability_score" real,
	"last_validated_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "retailer_endpoints_retailer_id_url_method_unique" UNIQUE("retailer_id","url","method")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_endpoints" ADD CONSTRAINT "retailer_endpoints_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_endpoints_type_idx" ON "retailer_endpoints" USING btree ("endpoint_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_endpoints_active_idx" ON "retailer_endpoints" USING btree ("active") WHERE active = true;
