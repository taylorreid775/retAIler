ALTER TYPE "fetch_strategy" ADD VALUE IF NOT EXISTS 'jina_reader';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retailer_listing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL,
	"parent_id" uuid,
	"pagination" jsonb,
	"product_url_pattern" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_listing_pages" ADD CONSTRAINT "retailer_listing_pages_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailer_listing_pages_url_idx" ON "retailer_listing_pages" USING btree ("retailer_id","url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_listing_pages_retailer_idx" ON "retailer_listing_pages" USING btree ("retailer_id");
