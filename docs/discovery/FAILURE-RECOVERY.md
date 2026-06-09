# Failure Recovery Strategy

Detect degradation during crawls. Attempt incremental repair before full rediscovery.

## Health Detection

`CrawlHealthJob` runs after each `crawl-discover` completion.

### Metrics Collected

| Metric | Source | Weight |
|--------|--------|--------|
| `catalogCoverageRatio` | `urls_discovered` vs `health.baselineCatalogSize` | 0.30 |
| `endpointSuccessRate` | API/Jina fetch success during crawl | 0.30 |
| `extractionSuccessRate` | extract jobs succeeded / attempted (sitemap path) | 0.20 |
| `priceFieldPresence` | % of ingested products with price | 0.20 |

### Composite Score

```typescript
function computeHealthScore(report: CrawlHealthInput): number {
  return (
    report.catalogCoverageRatio * 0.3 +
    report.endpointSuccessRate * 0.3 +
    report.extractionSuccessRate * 0.2 +
    report.priceFieldPresence * 0.2
  );
}
```

Persist to `crawl_health_reports` and update `retailers.crawl_health_score`.

### Anomaly Detection

```typescript
interface HealthAnomaly {
  type:
    | 'catalog_drop'        // >30% size decrease
    | 'endpoint_4xx'        // auth/not found
    | 'endpoint_5xx'        // server errors
    | 'pagination_break'    // page 2 returns empty or same items
    | 'field_missing'       // price/name field dropped
    | 'extraction_rate_drop' // JSON-LD stopped working
    | 'bot_wall'            // challenge page detected
    | 'rate_limited';       // sustained 429s
  severity: 'warning' | 'critical';
  details: string;
}
```

---

## Escalation Ladder

```
crawl completes
  → CrawlHealthJob computes health_score

health_score >= 0.7
  → log anomalies as warnings, continue schedule

0.4 <= health_score < 0.7
  → enqueue DiscoverRepairJob

health_score < 0.4 for 3 consecutive crawls
  → enqueue RediscoverJob

repair fails 2× consecutively
  → enqueue RediscoverJob + ops alert

hard_block detected (Incapsula, persistent Cloudflare)
  → mark retailer status blocked, stop retries
```

---

## Incremental Repair (Before Full Rediscovery)

| Failure | Repair action | Deterministic? | File |
|---------|---------------|----------------|------|
| 401/403 on API | Re-capture cookies via browser; diff headers; patch `ApiRecipe.headers` | Yes | `repair/header-refresh.ts` |
| 404 on endpoint | Check platform pack for alternate endpoint | Yes | `repair/endpoint-swap.ts` |
| Pagination break | Re-probe page 1/2; detect new param | Yes | `repair/pagination-fix.ts` |
| Missing price field | Check alternate JSON path in cached response | Yes | `repair/field-path-fix.ts` |
| GraphQL schema change | Re-capture; re-infer field map only | AI (bounded) | `infer-api-recipe.ts` |
| Cloudflare/bot wall | Switch `fetchStrategy` to `browser` or `jina_reader` | Yes | orchestrator |
| Rate limited | Increase `requestDelayMs`; reduce `maxConcurrency` | Yes | recipe update |
| Site redesign / framework migration | Full rediscovery | Orchestrator | `RediscoverJob` |

### Repair Job Flow

```typescript
async function runRepair(job: DiscoverRepairJob) {
  const retailer = await loadRetailer(job.retailerKey);
  const knowledge = await readKnowledgeDocs(retailer.key);
  const lastHealth = await loadHealthReport(job.healthReportId);

  const strategies = selectRepairStrategies(lastHealth.anomalies, knowledge);

  for (const strategy of strategies) {
    const patched = await strategy.apply(retailer.crawlRecipe);
    if (patched && (await validateEndpoint(patched.api)).confidence >= 0.7) {
      await saveRecipeVersion(retailer, patched, 'repair');
      await logRepair(job, strategy.name, true);
      return;
    }
  }

  await logRepair(job, 'all_failed', false);
  await queues.rediscover({ retailerKey: job.retailerKey, reason: 'repair_exhausted' });
}
```

---

## Full Rediscovery

`RediscoverJob` re-runs orchestrator with existing knowledge:

```typescript
{
  retailerKey: 'sportchek',
  mode: 'rediscover',
  preserveEndpoints: true,  // seed platform pack from retailer_endpoints
}
```

### Rediscovery Reads Before Acting

1. `docs/discovery/retailers/{key}/known-issues.md`
2. `docs/discovery/retailers/{key}/endpoint-analysis.md`
3. `retailer_recipe_versions` history
4. Latest HAR from Blob (if < 30 days old)

### Rediscovery Writes

- New `retailer_recipe_versions` entry
- Updated knowledge docs with CHANGELOG entry
- `retailers.last_rediscovery_at` timestamp

---

## Rollback

Instant rollback via version table:

```sql
UPDATE retailers
SET crawl_recipe = (
  SELECT crawl_recipe
  FROM retailer_recipe_versions
  WHERE retailer_id = $1 AND version = $2
)
WHERE id = $1;
```

Expose rollback in dashboard ops UI for manual intervention.

---

## Failure Scenarios

### Endpoint Changes

**Symptom:** 404 on previously working URL.

**Repair:** `endpoint-swap` tries platform pack alternates.

**Example:** Shopify `/products.json` disabled → try Storefront GraphQL.

### GraphQL Schema Changes

**Symptom:** 200 response but empty products array or field paths return null.

**Repair:** Re-capture network; re-run `inferApiRecipe` on new response shape only.

### Cloudflare / Bot Detection

**Symptom:** Challenge page HTML; non-JSON responses; HTTP 403 with CF headers.

**Repair:** Escalate `fetchStrategy`: `static` → `browser` → `jina_reader`.

**Hard block:** Incapsula, persistent challenges → mark `blocked`, do not retry.

### Rate Limiting

**Symptom:** HTTP 429; `Retry-After` headers.

**Repair:** Double `requestDelayMs`; halve `maxConcurrency`; use `RetryAfterError` in fetch consumer (existing pattern in `rotation.ts`).

### Header / Cookie Changes

**Symptom:** 401/403 with previously working recipe.

**Repair:** `header-refresh` — browser capture session, diff headers against stored recipe, patch.

### Site Redesign / Framework Migration

**Symptom:** Multiple anomalies simultaneously; fingerprint platform change.

**Repair:** None incremental — full `RediscoverJob`.

### Coverage Drops

**Symptom:** `catalog_size` drops >30% without errors.

**Repair:** Check pagination break first; then endpoint swap; then rediscover.

---

## Blocked Retailer Handling

```typescript
// retailers table — optional future column
blocked: boolean
blocked_reason: string | null
blocked_at: timestamptz | null
```

Known hard blocks today:

- Sports Experts (Incapsula) — explicitly rejected in code
- Some retailers block Jina Reader

Do not waste discovery/repair cycles on known blocks. Surface in dashboard with clear message.

---

## Monitoring Alerts

| Condition | Alert |
|-----------|-------|
| `crawl_health_score < 0.4` for 3 crawls | Pager / Slack |
| Repair failed 2× | Ops review queue |
| Discovery cost > $0.10 | Budget alert |
| `blocked` retailer crawl attempted | Log warning |
| Global discovery failure rate > 20% / day | System alert |
