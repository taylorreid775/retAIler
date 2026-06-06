CREATE TYPE "public"."retailer_source" AS ENUM('seed', 'user');--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "source" "retailer_source" DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "homepage_url" text;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "sitemap_url" text;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "product_url_pattern" text;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "llms_txt_url" text;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "discovery_notes" text;