import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * pgvector column type. Dimension matches the embedding model
 * (text-embedding-3-small = 1536).
 */
export const EMBEDDING_DIM = 1536;
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.replace(/[[\]]/g, '').split(',').map(Number);
  },
});

// ─── Enums ──────────────────────────────────────────────────────────────
export const fetchStrategyEnum = pgEnum('fetch_strategy', ['static', 'browser', 'jina_reader']);
/** How a retailer entered the platform: built-in seed vs. self-serve URL onboarding. */
export const retailerSourceEnum = pgEnum('retailer_source', ['seed', 'user']);
/** Lifecycle of a self-serve store onboarding (URL → browser discovery → retailer). */
export const onboardingStatusEnum = pgEnum('onboarding_status', [
  'queued',
  'discovering',
  'ready',
  'failed',
]);
export const availabilityEnum = pgEnum('availability', [
  'in_stock',
  'out_of_stock',
  'preorder',
  'discontinued',
  'unknown',
]);
export const currencyEnum = pgEnum('currency', ['CAD', 'USD']);
export const signalTypeEnum = pgEnum('signal_type', [
  'price_drop',
  'price_increase',
  'new_product',
  'back_in_stock',
  'low_stock',
  'out_of_stock',
  'assortment_expansion',
  'seo_keyword_gap',
]);
export const signalSeverityEnum = pgEnum('signal_severity', ['info', 'notable', 'critical']);
export const planEnum = pgEnum('plan', ['trial', 'starter', 'growth', 'scale']);
export const crawlRunStatusEnum = pgEnum('crawl_run_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);
export const matchStatusEnum = pgEnum('match_status', [
  'unmatched',
  'auto_matched',
  'needs_review',
  'confirmed',
  'rejected',
]);

// ─── Retailers & crawl config ───────────────────────────────────────────
export const retailers = pgTable(
  'retailers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 64 }).notNull(),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    country: varchar('country', { length: 2 }).notNull().default('CA'),
    affiliateTag: text('affiliate_tag'),
    enabled: boolean('enabled').notNull().default(true),
    requestDelayMs: integer('request_delay_ms').notNull().default(2000),
    maxConcurrency: integer('max_concurrency').notNull().default(2),
    respectRobotsTxt: boolean('respect_robots_txt').notNull().default(true),
    fetchStrategy: fetchStrategyEnum('fetch_strategy').notNull().default('static'),
    useProxy: boolean('use_proxy').notNull().default(false),
    crawlSchedule: text('crawl_schedule').notNull().default('0 6 * * *'),
    // ── Self-serve onboarding (auto-discovered crawl config) ──
    source: retailerSourceEnum('source').notNull().default('seed'),
    /** Homepage URL the user submitted (origin used to derive everything else). */
    homepageUrl: text('homepage_url'),
    /** Discovered sitemap entry point used by the generic adapter. */
    sitemapUrl: text('sitemap_url'),
    /** Discovered product-detail URL pattern (substring or regex source). */
    productUrlPattern: text('product_url_pattern'),
    /** Discovered llms.txt URL, if any. */
    llmsTxtUrl: text('llms_txt_url'),
    /** Persisted crawl + extraction recipe (from llms.txt + discovery). */
    crawlRecipe: jsonb('crawl_recipe').$type<import('@retailer/schema').CrawlRecipe>(),
    /** Human-readable summary of what discovery found / could not find. */
    discoveryNotes: text('discovery_notes'),
    /** Latest retailer fingerprint from discovery. */
    fingerprint: jsonb('fingerprint').$type<import('@retailer/schema').RetailerFingerprint>(),
    discoveryConfidence: real('discovery_confidence').default(0),
    lastRediscoveryAt: timestamp('last_rediscovery_at', { withTimezone: true }),
    crawlHealthScore: real('crawl_health_score').default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: uniqueIndex('retailers_key_idx').on(t.key),
    domainIdx: uniqueIndex('retailers_domain_idx').on(t.domain),
  }),
);

/** Category/collection listing URLs discovered via Jina + AI (one row per URL). */
export const retailerListingPages = pgTable(
  'retailer_listing_pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    label: text('label').notNull(),
    parentId: uuid('parent_id'),
    pagination: jsonb('pagination').$type<import('@retailer/schema').ListingPagination>(),
    productUrlPattern: text('product_url_pattern'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    urlIdx: uniqueIndex('retailer_listing_pages_url_idx').on(t.retailerId, t.url),
    retailerIdx: index('retailer_listing_pages_retailer_idx').on(t.retailerId),
  }),
);

/** Immutable crawl recipe history for rollback and audit. */
export const retailerRecipeVersions = pgTable(
  'retailer_recipe_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    crawlRecipe: jsonb('crawl_recipe')
      .$type<import('@retailer/schema').CrawlRecipe>()
      .notNull(),
    fingerprint: jsonb('fingerprint').$type<import('@retailer/schema').RetailerFingerprint>(),
    validationReport: jsonb('validation_report'),
    confidence: real('confidence').notNull(),
    primaryEndpoint: text('primary_endpoint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  (t) => ({
    retailerVersionIdx: uniqueIndex('retailer_recipe_versions_retailer_id_version_unique').on(
      t.retailerId,
      t.version,
    ),
    retailerIdx: index('retailer_recipe_versions_retailer_id_idx').on(t.retailerId),
  }),
);

export const crawlRuns = pgTable('crawl_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  retailerId: uuid('retailer_id')
    .notNull()
    .references(() => retailers.id, { onDelete: 'cascade' }),
  status: crawlRunStatusEnum('status').notNull().default('queued'),
  urlsDiscovered: integer('urls_discovered').notNull().default(0),
  urlsFetched: integer('urls_fetched').notNull().default(0),
  productsExtracted: integer('products_extracted').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Per-crawl health metrics; drives repair and rediscovery triggers. */
export const crawlHealthReports = pgTable(
  'crawl_health_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    crawlRunId: uuid('crawl_run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
    catalogSize: integer('catalog_size'),
    previousCatalogSize: integer('previous_catalog_size'),
    coverageRatio: real('coverage_ratio'),
    endpointSuccessRate: real('endpoint_success_rate'),
    extractionSuccessRate: real('extraction_success_rate'),
    priceFieldPresence: real('price_field_presence'),
    healthScore: real('health_score').notNull(),
    anomalies: jsonb('anomalies')
      .$type<import('@retailer/schema').HealthAnomaly[]>()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    retailerIdx: index('crawl_health_reports_retailer_id_idx').on(t.retailerId),
    createdAtIdx: index('crawl_health_reports_created_at_idx').on(t.createdAt),
  }),
);

/** Queryable endpoint registry across retailers. */
export const retailerEndpoints = pgTable(
  'retailer_endpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    endpointType: text('endpoint_type').notNull(),
    url: text('url').notNull(),
    method: text('method').notNull().default('GET'),
    headers: jsonb('headers').$type<Record<string, string>>().default({}),
    paginationStyle: text('pagination_style'),
    reliabilityScore: real('reliability_score'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    retailerUrlMethodIdx: uniqueIndex('retailer_endpoints_retailer_id_url_method_unique').on(
      t.retailerId,
      t.url,
      t.method,
    ),
    typeIdx: index('retailer_endpoints_type_idx').on(t.endpointType),
    activeIdx: index('retailer_endpoints_active_idx').on(t.active),
  }),
);

/** Incremental repair attempt log. */
export const discoveryRepairs = pgTable(
  'discovery_repairs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    repairType: text('repair_type').notNull(),
    beforeRecipeVersion: integer('before_recipe_version'),
    afterRecipeVersion: integer('after_recipe_version'),
    success: boolean('success').notNull(),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    retailerIdx: index('discovery_repairs_retailer_id_idx').on(t.retailerId),
  }),
);

// ─── Taxonomy ───────────────────────────────────────────────────────────
export const brands = pgTable(
  'brands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ slugIdx: uniqueIndex('brands_slug_idx').on(t.slug) }),
);

export const brandAliases = pgTable(
  'brand_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
  },
  (t) => ({ aliasIdx: uniqueIndex('brand_aliases_alias_idx').on(t.alias) }),
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    parentId: uuid('parent_id'),
    path: text('path').notNull(),
    depth: integer('depth').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pathIdx: uniqueIndex('categories_path_idx').on(t.path),
  }),
);

export const retailerCategories = pgTable(
  'retailer_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    rawPath: text('raw_path').notNull(),
    categoryId: uuid('category_id').references(() => categories.id),
  },
  (t) => ({
    rcIdx: uniqueIndex('retailer_categories_idx').on(t.retailerId, t.rawPath),
  }),
);

// ─── Products ───────────────────────────────────────────────────────────
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalTitle: text('canonical_title').notNull(),
    brandId: uuid('brand_id').references(() => brands.id),
    categoryId: uuid('category_id').references(() => categories.id),
    gtin: text('gtin'),
    mpn: text('mpn'),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gtinIdx: index('products_gtin_idx').on(t.gtin),
    brandIdx: index('products_brand_idx').on(t.brandId),
  }),
);

export const retailerProducts = pgTable(
  'retailer_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    url: text('url').notNull(),
    retailerSku: text('retailer_sku'),
    rawTitle: text('raw_title').notNull(),
    brandRaw: text('brand_raw'),
    categoryPathRaw: jsonb('category_path_raw').$type<string[]>().notNull().default([]),
    gtin: text('gtin'),
    mpn: text('mpn'),
    imageUrl: text('image_url'),
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
    matchStatus: matchStatusEnum('match_status').notNull().default('unmatched'),
    matchConfidence: real('match_confidence'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    urlIdx: uniqueIndex('retailer_products_url_idx').on(t.url),
    retailerIdx: index('retailer_products_retailer_idx').on(t.retailerId),
    productIdx: index('retailer_products_product_idx').on(t.productId),
    matchStatusIdx: index('retailer_products_match_status_idx').on(t.matchStatus),
  }),
);

export const productEmbeddings = pgTable('product_embeddings', {
  retailerProductId: uuid('retailer_product_id')
    .primaryKey()
    .references(() => retailerProducts.id, { onDelete: 'cascade' }),
  embedding: vector('embedding').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Time series: price & stock ─────────────────────────────────────────
export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerProductId: uuid('retailer_product_id')
      .notNull()
      .references(() => retailerProducts.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    listAmountMinor: integer('list_amount_minor'),
    currency: currencyEnum('currency').notNull().default('CAD'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rpTimeIdx: index('price_obs_rp_time_idx').on(t.retailerProductId, t.capturedAt),
  }),
);

export const stockObservations = pgTable(
  'stock_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerProductId: uuid('retailer_product_id')
      .notNull()
      .references(() => retailerProducts.id, { onDelete: 'cascade' }),
    availability: availabilityEnum('availability').notNull().default('unknown'),
    qty: integer('qty'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rpTimeIdx: index('stock_obs_rp_time_idx').on(t.retailerProductId, t.capturedAt),
  }),
);

// ─── Raw page snapshots (provenance) ────────────────────────────────────
export const pageSnapshots = pgTable(
  'page_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Vercel Blob key. */
    blobKey: text('blob_key').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    httpStatus: integer('http_status'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    urlTimeIdx: index('page_snapshots_url_time_idx').on(t.url, t.capturedAt),
  }),
);

// ─── Signals (intelligence layer output) ────────────────────────────────
export const signals = pgTable(
  'signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: signalTypeEnum('type').notNull(),
    severity: signalSeverityEnum('severity').notNull().default('info'),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    retailerProductId: uuid('retailer_product_id').references(() => retailerProducts.id, {
      onDelete: 'cascade',
    }),
    productId: uuid('product_id').references(() => products.id),
    title: text('title').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeTimeIdx: index('signals_type_time_idx').on(t.type, t.occurredAt),
    retailerTimeIdx: index('signals_retailer_time_idx').on(t.retailerId, t.occurredAt),
  }),
);

// ─── SEO ────────────────────────────────────────────────────────────────
export const keywords = pgTable(
  'keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    term: text('term').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ termIdx: uniqueIndex('keywords_term_idx').on(t.term) }),
);

export const serpObservations = pgTable(
  'serp_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    keywordId: uuid('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kwIdx: index('serp_obs_kw_idx').on(t.keywordId, t.capturedAt),
  }),
);

// ─── Tenancy / billing ──────────────────────────────────────────────────
export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkOrgId: text('clerk_org_id').notNull(),
    name: text('name').notNull(),
    plan: planEnum('plan').notNull().default('trial'),
    /** The org's own storefront (for "you vs competitors" SEO gap analysis). */
    ownRetailerId: uuid('own_retailer_id').references(() => retailers.id),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ clerkIdx: uniqueIndex('orgs_clerk_idx').on(t.clerkOrgId) }),
);

export const orgCompetitors = pgTable(
  'org_competitors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    retailerId: uuid('retailer_id')
      .notNull()
      .references(() => retailers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('org_competitors_uniq').on(t.orgId, t.retailerId),
  }),
);

export const alertRules = pgTable('alert_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  signalTypes: jsonb('signal_types').$type<string[]>().notNull().default([]),
  retailerIds: jsonb('retailer_ids').$type<string[]>().notNull().default([]),
  minSeverity: signalSeverityEnum('min_severity').notNull().default('notable'),
  channels: jsonb('channels').$type<string[]>().notNull().default(['in_app']),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    alertRuleId: uuid('alert_rule_id').references(() => alertRules.id, { onDelete: 'set null' }),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    deliveredEmailAt: timestamp('delivered_email_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgTimeIdx: index('alert_events_org_time_idx').on(t.orgId, t.createdAt),
  }),
);

// Human review queue for low-confidence product matches.
export const matchReviewQueue = pgTable('match_review_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  retailerProductId: uuid('retailer_product_id')
    .notNull()
    .references(() => retailerProducts.id, { onDelete: 'cascade' }),
  candidateProductId: uuid('candidate_product_id').references(() => products.id),
  confidence: real('confidence').notNull(),
  reason: text('reason'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Self-serve store onboarding. Tracks a URL submitted by an org while it is
 * being discovered in the background (worker + browser). Only successful
 * discoveries are promoted into a `retailers` row; failures stay here until the
 * user dismisses them. Keeps failed attempts out of the retailers table.
 */
export const storeOnboarding = pgTable(
  'store_onboarding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    inputUrl: text('input_url').notNull(),
    /** Normalized host for cross-org dedup (no www., lowercase). */
    normalizedDomain: text('normalized_domain'),
    status: onboardingStatusEnum('status').notNull().default('queued'),
    /** Set once discovery succeeds and a retailer row is created. */
    retailerId: uuid('retailer_id').references(() => retailers.id, { onDelete: 'set null' }),
    /** Snapshot of the discovery result for display (sitemap, pattern, etc.). */
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgTimeIdx: index('store_onboarding_org_time_idx').on(t.orgId, t.createdAt),
    normalizedDomainStatusIdx: index('store_onboarding_normalized_domain_status_idx').on(
      t.normalizedDomain,
      t.status,
    ),
  }),
);

/** Multi-stage discovery job tracking (onboarding + rediscovery). */
export const discoveryRuns = pgTable(
  'discovery_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retailerId: uuid('retailer_id').references(() => retailers.id, { onDelete: 'set null' }),
    onboardingId: uuid('onboarding_id').references(() => storeOnboarding.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    currentStage: text('current_stage'),
    stagesCompleted: jsonb('stages_completed')
      .$type<import('@retailer/schema').StageCheckpoint[]>()
      .notNull()
      .default([]),
    fingerprint: jsonb('fingerprint').$type<import('@retailer/schema').RetailerFingerprint>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    tokenUsage: integer('token_usage').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
  },
  (t) => ({
    onboardingIdx: index('discovery_runs_onboarding_id_idx').on(t.onboardingId),
    statusIdx: index('discovery_runs_status_idx').on(t.status),
    retailerIdx: index('discovery_runs_retailer_id_idx').on(t.retailerId),
    startedAtIdx: index('discovery_runs_started_at_idx').on(t.startedAt),
  }),
);

export const schemaSql = sql; // re-export for migration helpers
