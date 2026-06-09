# Scaling Strategy

Scale from tens to thousands of retailers without linear growth in cost, latency, or human intervention.

## Infrastructure Tiers

| Tier | Retailers | Architecture |
|------|-----------|--------------|
| 0–100 | Current | Single worker process; discovery concurrency 1 |
| 100–500 | Phase 4 | Dedicated discovery workers on Fly.io (2–4 machines) |
| 500–2000 | Scale-out | Discovery pool separate from crawl pool; regional browser pools |
| 2000+ | Mature | Per-platform worker specialization; shared endpoint pattern DB |

---

## Worker Separation

### Problem

Today: discovery and crawl share one worker process. Playwright discovery (concurrency 1) blocks or competes with crawl throughput.

### Solution

```toml
# fly.toml — separate process groups
[processes]
  crawl = "node dist/index.js --workers=crawl"
  discovery = "node dist/index.js --workers=discovery"
```

| Pool | Queues consumed | Resources |
|------|-----------------|-----------|
| Crawl | `crawl-discover`, `crawl-fetch`, `pipeline-extract`, `pipeline-match`, `crawl-health` | CPU, network, rate limits |
| Discovery | `store-discover-orchestrator`, `store-discover-repair`, `store-rediscover` | Playwright, browser memory |
| Analytics | `analytics-compute`, `reports-send` | CPU, DB |

Discovery machines: scale up during onboarding bursts; scale down overnight.

---

## Crawl Scheduling at Scale

### Staggered Cron

Avoid thundering herd when 1000+ retailers share the same schedule:

```typescript
function cronForRetailer(retailerKey: string, baseHour: number): string {
  const jitterMin = Math.abs(hashCode(retailerKey)) % 60;
  return `${jitterMin} ${baseHour} * * *`;
}
```

Spread each retailer's daily crawl within a 1-hour window.

### Priority Tiers

| Tier | Retailers | Schedule | Concurrency |
|------|-----------|----------|-------------|
| Active (paying, recently viewed) | Top 10% | Every 6–12h | Higher |
| Standard | Majority | Daily | Default |
| Dormant (no views 30d) | Long tail | Weekly | Lower |

Store tier on `retailers.crawlSchedule` or future `crawl_priority` column.

---

## Rate Limit Budget

Per-retailer limits in `crawlRecipe.compliance`:

```typescript
{
  requestDelayMs: 500,
  maxConcurrency: 2,
}
```

Global Redis rate limiter:

```typescript
// packages/crawler/src/rate-limit.ts
await rateLimiter.acquire(`retailer:${key}`, {
  maxPerSecond: 1 / (delayMs / 1000),
});
```

Per-domain limiter prevents multiple retailers on same CDN from sharing egress IP and getting blocked.

---

## Shared Knowledge Flywheel

As discovery volume grows, reuse patterns across retailers:

### 1. Endpoint Pattern Library

"This URL shape is a Salesforce search API" → skip network sniff.

Store successful patterns:

```typescript
interface EndpointPattern {
  platform: Platform;
  urlRegex: string;
  method: string;
  successRate: number;
  sampleFieldMap: Record<string, string>;
}
```

### 2. Platform Pack Success Rates

Deprioritize packs with <50% validation success over rolling 30-day window.

### 3. Cross-Retailer Header Templates

"Shopify Storefront needs `X-Shopify-Storefront-Access-Token`" — apply as defaults before inference.

### 4. Blocked Domain List

Incapsula, aggressive Cloudflare, Jina-blocked → early exit in fingerprint stage.

---

## Database Scaling

| Table | Strategy |
|-------|----------|
| `retailer_endpoints` | Index by `endpoint_type`; aggregate patterns periodically |
| `crawl_health_reports` | Partition by month (Timescale or manual archive) |
| `retailer_recipe_versions` | Keep last 10 versions hot; archive older to Blob |
| `discovery_runs` | Retain 90 days; aggregate stats then purge |
| `retailer_products` | Existing indexes on `retailer_id`, `url` |
| `product_embeddings` | HNSW index (existing) — separate from discovery |

### Read Replicas

Neon read replica for dashboard health queries and analytics — do not route crawl writes through replica.

---

## Discovery Throughput

### Target Metrics

| Metric | 100 retailers | 1000 retailers |
|--------|---------------|----------------|
| Parallel discoveries | 1–2 | 4–8 |
| Mean onboard time (API) | <5 min | <5 min |
| Mean onboard time (sitemap) | <30 min | <30 min |
| Human intervention | <10% | <5% |
| Discovery queue depth | <10 | <50 |

### Bottleneck Mitigation

| Bottleneck | Mitigation |
|------------|------------|
| Playwright browser | Browser pool (2–4 instances per discovery machine) |
| Jina rate limits | Queue throttle; cache homepage markdown 24h |
| AI Gateway rate limits | Platform packs reduce inference to <20% of sites |
| Neon write throughput | Batch health reports; async recipe version writes |
| Blob storage | Compress HAR; 90-day lifecycle policy |

---

## Multi-Tenancy (B2B)

### Shared Retailer Model

```
domain sportchek.ca
  → one retailers row
  → one crawlRecipe
  → many org_competitors links
```

Benefits:

- One discovery serves all customers monitoring the same competitor
- Catalog crawled once, matched products shared (with org-level visibility rules)
- Discovery cost amortized across customers

### Org-Level Access

On URL submit:

```sql
SELECT id FROM retailers WHERE domain = normalize_domain($url);
-- if found: INSERT org_competitors (org_id, retailer_id)
-- if not: INSERT store_onboarding → discovery
```

---

## Geographic Scaling

For retailers geo-blocking non-local IPs:

- Fly.io machines in `yyz` (Toronto) for Canadian retailers (current market)
- Future: `iad`, `lhr` pools selected by retailer `country` field
- Proxy support via existing `useProxy` on `retailers` table

---

## Operational Model at 1000+ Retailers

| Function | Approach |
|----------|----------|
| Onboarding | Fully automated; ops reviews only `blocked` and `needs_review` |
| Health monitoring | Automated repair → rediscovery escalation |
| Recipe changes | Versioned; rollback via DB |
| Compliance | Per-retailer robots + rate limits; global kill switch |
| Cost control | Per-run token budget; weekly spend dashboard |
| Incident response | Retailer-level isolation (disable `enabled` flag) |

### Human Intervention Queue

Surface retailers where:

- `crawl_health_score < 0.4` after rediscovery
- `discovery_runs.status = failed` after 2 attempts
- `blocked = true` with user-requested unblock

Target: <5% of retailers per quarter require human action.
