CREATE TYPE "public"."availability" AS ENUM('in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."crawl_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('CAD', 'USD');--> statement-breakpoint
CREATE TYPE "public"."fetch_strategy" AS ENUM('static', 'browser');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('unmatched', 'auto_matched', 'needs_review', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('trial', 'starter', 'growth', 'scale');--> statement-breakpoint
CREATE TYPE "public"."signal_severity" AS ENUM('info', 'notable', 'critical');--> statement-breakpoint
CREATE TYPE "public"."signal_type" AS ENUM('price_drop', 'price_increase', 'new_product', 'back_in_stock', 'low_stock', 'out_of_stock', 'assortment_expansion', 'seo_keyword_gap');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"alert_rule_id" uuid,
	"signal_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_email_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"signal_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retailer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_severity" "signal_severity" DEFAULT 'notable' NOT NULL,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"status" "crawl_run_status" DEFAULT 'queued' NOT NULL,
	"urls_discovered" integer DEFAULT 0 NOT NULL,
	"urls_fetched" integer DEFAULT 0 NOT NULL,
	"products_extracted" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_product_id" uuid NOT NULL,
	"candidate_product_id" uuid,
	"confidence" real NOT NULL,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"retailer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"plan" "plan" DEFAULT 'trial' NOT NULL,
	"own_retailer_id" uuid,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "page_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"url" text NOT NULL,
	"blob_key" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"http_status" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_product_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"list_amount_minor" integer,
	"currency" "currency" DEFAULT 'CAD' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_embeddings" (
	"retailer_product_id" uuid PRIMARY KEY NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_title" text NOT NULL,
	"brand_id" uuid,
	"category_id" uuid,
	"gtin" text,
	"mpn" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retailer_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"raw_path" text NOT NULL,
	"category_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retailer_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid NOT NULL,
	"product_id" uuid,
	"url" text NOT NULL,
	"retailer_sku" text,
	"raw_title" text NOT NULL,
	"brand_raw" text,
	"category_path_raw" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gtin" text,
	"mpn" text,
	"image_url" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL,
	"match_confidence" real,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"country" varchar(2) DEFAULT 'CA' NOT NULL,
	"affiliate_tag" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"request_delay_ms" integer DEFAULT 2000 NOT NULL,
	"max_concurrency" integer DEFAULT 2 NOT NULL,
	"respect_robots_txt" boolean DEFAULT true NOT NULL,
	"fetch_strategy" "fetch_strategy" DEFAULT 'static' NOT NULL,
	"use_proxy" boolean DEFAULT false NOT NULL,
	"crawl_schedule" text DEFAULT '0 6 * * *' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "serp_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"retailer_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "signal_type" NOT NULL,
	"severity" "signal_severity" DEFAULT 'info' NOT NULL,
	"retailer_id" uuid NOT NULL,
	"retailer_product_id" uuid,
	"product_id" uuid,
	"title" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_product_id" uuid NOT NULL,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"qty" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_review_queue" ADD CONSTRAINT "match_review_queue_retailer_product_id_retailer_products_id_fk" FOREIGN KEY ("retailer_product_id") REFERENCES "public"."retailer_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_review_queue" ADD CONSTRAINT "match_review_queue_candidate_product_id_products_id_fk" FOREIGN KEY ("candidate_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_competitors" ADD CONSTRAINT "org_competitors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orgs" ADD CONSTRAINT "orgs_own_retailer_id_retailers_id_fk" FOREIGN KEY ("own_retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_competitors" ADD CONSTRAINT "org_competitors_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_retailer_product_id_retailer_products_id_fk" FOREIGN KEY ("retailer_product_id") REFERENCES "public"."retailer_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_retailer_product_id_retailer_products_id_fk" FOREIGN KEY ("retailer_product_id") REFERENCES "public"."retailer_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_categories" ADD CONSTRAINT "retailer_categories_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_categories" ADD CONSTRAINT "retailer_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_products" ADD CONSTRAINT "retailer_products_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailer_products" ADD CONSTRAINT "retailer_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "serp_observations" ADD CONSTRAINT "serp_observations_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "serp_observations" ADD CONSTRAINT "serp_observations_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_retailer_product_id_retailer_products_id_fk" FOREIGN KEY ("retailer_product_id") REFERENCES "public"."retailer_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_observations" ADD CONSTRAINT "stock_observations_retailer_product_id_retailer_products_id_fk" FOREIGN KEY ("retailer_product_id") REFERENCES "public"."retailer_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_events_org_time_idx" ON "alert_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_aliases_alias_idx" ON "brand_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_idx" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_path_idx" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keywords_term_idx" ON "keywords" USING btree ("term");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_competitors_uniq" ON "org_competitors" USING btree ("org_id","retailer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orgs_clerk_idx" ON "orgs" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_snapshots_url_time_idx" ON "page_snapshots" USING btree ("url","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_obs_rp_time_idx" ON "price_observations" USING btree ("retailer_product_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_gtin_idx" ON "products" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailer_categories_idx" ON "retailer_categories" USING btree ("retailer_id","raw_path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailer_products_url_idx" ON "retailer_products" USING btree ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_products_retailer_idx" ON "retailer_products" USING btree ("retailer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_products_product_idx" ON "retailer_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retailer_products_match_status_idx" ON "retailer_products" USING btree ("match_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retailers_key_idx" ON "retailers" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "serp_obs_kw_idx" ON "serp_observations" USING btree ("keyword_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_type_time_idx" ON "signals" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_retailer_time_idx" ON "signals" USING btree ("retailer_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_obs_rp_time_idx" ON "stock_observations" USING btree ("retailer_product_id","captured_at");