# Database Schema Additions

Extend `packages/db/src/schema.ts`. Add Drizzle migration in `packages/db/drizzle/`.

## New Columns on `retailers`

```sql
ALTER TABLE retailers ADD COLUMN fingerprint jsonb;
ALTER TABLE retailers ADD COLUMN discovery_confidence real DEFAULT 0;
ALTER TABLE retailers ADD COLUMN last_rediscovery_at timestamptz;
ALTER TABLE retailers ADD COLUMN crawl_health_score real DEFAULT 1.0;
```

Denormalize key fingerprint fields for querying without parsing `crawl_recipe`.

---

## `retailer_recipe_versions`

Immutable recipe history. Enables rollback and audit.

```sql
CREATE TABLE retailer_recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  version int NOT NULL,
  crawl_recipe jsonb NOT NULL,
  fingerprint jsonb,
  validation_report jsonb,
  confidence real NOT NULL,
  primary_endpoint text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by text NOT NULL,  -- 'discovery' | 'repair' | 'manual'
  UNIQUE(retailer_id, version)
);

CREATE INDEX retailer_recipe_versions_retailer_id_idx
  ON retailer_recipe_versions(retailer_id);
```

### Rollback Usage

```sql
UPDATE retailers
SET crawl_recipe = (
  SELECT crawl_recipe
  FROM retailer_recipe_versions
  WHERE retailer_id = $1 AND version = $2
);
```

---

## `retailer_endpoints`

Queryable endpoint registry across retailers.

```sql
CREATE TABLE retailer_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  endpoint_type text NOT NULL,
  -- 'catalog' | 'search' | 'product' | 'inventory' | 'variants' | 'graphql'
  url text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  headers jsonb DEFAULT '{}',
  pagination_style text,
  reliability_score real,
  last_validated_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(retailer_id, url, method)
);

CREATE INDEX retailer_endpoints_type_idx ON retailer_endpoints(endpoint_type);
CREATE INDEX retailer_endpoints_active_idx ON retailer_endpoints(active) WHERE active = true;
```

---

## `crawl_health_reports`

Per-crawl health metrics. Drives repair/rediscovery triggers.

```sql
CREATE TABLE crawl_health_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  crawl_run_id uuid REFERENCES crawl_runs(id) ON DELETE SET NULL,
  catalog_size int,
  previous_catalog_size int,
  coverage_ratio real,
  endpoint_success_rate real,
  extraction_success_rate real,
  price_field_presence real,
  health_score real NOT NULL,
  anomalies jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX crawl_health_reports_retailer_id_idx
  ON crawl_health_reports(retailer_id);
CREATE INDEX crawl_health_reports_created_at_idx
  ON crawl_health_reports(created_at);
```

### Anomaly Shape

```typescript
interface HealthAnomaly {
  type:
    | 'catalog_drop'
    | 'endpoint_4xx'
    | 'endpoint_5xx'
    | 'pagination_break'
    | 'field_missing'
    | 'extraction_rate_drop'
    | 'bot_wall'
    | 'rate_limited';
  severity: 'warning' | 'critical';
  details: string;
}
```

---

## `discovery_runs`

Multi-stage discovery job tracking.

```sql
CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id uuid REFERENCES retailers(id) ON DELETE SET NULL,
  onboarding_id uuid REFERENCES store_onboarding(id) ON DELETE SET NULL,
  status text NOT NULL,
  -- 'running' | 'completed' | 'failed' | 'repair'
  current_stage text,
  stages_completed jsonb DEFAULT '[]',
  fingerprint jsonb,
  started_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz,
  error text,
  token_usage int NOT NULL DEFAULT 0,
  cost_usd numeric(10, 4) NOT NULL DEFAULT 0
);

CREATE INDEX discovery_runs_onboarding_id_idx ON discovery_runs(onboarding_id);
CREATE INDEX discovery_runs_status_idx ON discovery_runs(status);
```

---

## `discovery_repairs`

Repair attempt log.

```sql
CREATE TABLE discovery_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  -- 'health_drop' | 'endpoint_failure' | 'schema_drift' | 'manual'
  repair_type text NOT NULL,
  -- 'header_refresh' | 'pagination_fix' | 'endpoint_swap' | 'full_rediscovery'
  before_recipe_version int,
  after_recipe_version int,
  success boolean NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX discovery_repairs_retailer_id_idx ON discovery_repairs(retailer_id);
```

---

## Existing Tables (No Schema Change Required)

| Table | Role in discovery |
|-------|-------------------|
| `retailers` | Active config, scheduling |
| `retailer_listing_pages` | Jina/nav category URLs |
| `store_onboarding` | B2B URL submission state machine |
| `crawl_runs` | Per-crawl progress counters |
| `retailer_products` | Ingested catalog |
| `products` | Canonical matched products |

### Optional Future Addition

```sql
-- Link listing pages to specific search API endpoints
ALTER TABLE retailer_listing_pages ADD COLUMN endpoint_id uuid
  REFERENCES retailer_endpoints(id);
```

---

## Drizzle Type Additions

Add to `packages/schema/src/`:

```typescript
// fingerprint.ts
export const RetailerFingerprintSchema = z.object({ ... });
export type RetailerFingerprint = z.infer<typeof RetailerFingerprintSchema>;

// discovery-run.ts
export const DiscoveryRunStatusSchema = z.enum([
  'running', 'completed', 'failed', 'repair',
]);
```

Update `CrawlRecipeSchema` to support `version: 2` — see [WORKFLOW.md](./WORKFLOW.md).

---

## Migration Order

1. Add `retailers` columns (non-breaking)
2. Create `retailer_recipe_versions`; backfill v1 from current `crawl_recipe`
3. Create `discovery_runs`, `retailer_endpoints`
4. Create `crawl_health_reports`, `discovery_repairs`
5. Deploy health monitor; start populating reports
6. Migrate active recipes to v2 format incrementally

Backfill script location: `packages/db/src/backfill-recipe-versions.ts` (to be created).
