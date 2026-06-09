# Worker Implementation Plan

Phased plan to evolve `apps/worker` from linear `discover-config` to production discovery orchestrator.

## Phase 1 — Foundation (2–3 weeks)

### Deliverables

- [ ] `RetailerFingerprintSchema` in `packages/schema`
- [ ] `fingerprintSite()` in `packages/crawler/src/fingerprint/`
- [ ] Platform packs: **Shopify**, **Salesforce** (highest ROI)
- [ ] `discoverOrchestrator()` with parallel Stage 0–1
- [ ] `retailer_recipe_versions` migration + backfill
- [ ] `writeKnowledgeDocs()` + templates
- [ ] `discovery_runs` table + checkpointing

### Files to Create

```
packages/crawler/src/fingerprint/index.ts
packages/crawler/src/fingerprint/signals.ts
packages/crawler/src/discover/platform-packs/shopify.ts
packages/crawler/src/discover/platform-packs/salesforce.ts
packages/crawler/src/discover/platform-packs/index.ts
packages/crawler/src/discover/orchestrator.ts
packages/crawler/src/discover/knowledge/writer.ts
packages/crawler/src/discover/knowledge/reader.ts
packages/db/drizzle/0005_discovery_schema.sql
packages/db/src/backfill-recipe-versions.ts
```

### Files to Modify

```
packages/crawler/src/agent-manifest.ts     # extend detectPlatform()
packages/schema/src/crawl-recipe.ts        # version 2 fields
packages/db/src/schema.ts                  # new tables
apps/worker/src/consumers/discover-config.ts  # delegate to orchestrator
```

### Success Criteria

- Shopify store onboarded via platform pack with 0 LLM tokens
- Recipe version 1 written to `retailer_recipe_versions`
- Knowledge docs generated under `docs/discovery/retailers/{key}/`

---

## Phase 2 — Network & Validation (2–3 weeks)

### Deliverables

- [ ] Extended `captureNetworkRequests()` with header dependency graph
- [ ] Endpoint validation suite with pagination auto-detection
- [ ] HAR storage to Vercel Blob
- [ ] `retailer_endpoints` population on discovery completion
- [ ] GraphQL operation name extraction

### Files to Create

```
packages/crawler/src/discover/stages/network-capture.ts
packages/crawler/src/discover/stages/validate-endpoint.ts
packages/crawler/src/discover/stages/catalog-probe.ts
apps/worker/src/blob-storage.ts
```

### Files to Modify

```
apps/worker/src/network-capture.ts
packages/crawler/src/discover/validate-api-recipe.ts
packages/crawler/src/discover/pagination.ts
```

### Success Criteria

- Non-platform retailer discovered via network sniff + AI field-map
- HAR artifact stored and referenced in `discovery_runs`
- Pagination auto-detected for offset and cursor styles

---

## Phase 3 — Health & Repair (2 weeks)

### Deliverables

- [ ] `crawl-health` post-processor on crawl completion
- [ ] `discover-repair` consumer with incremental strategies
- [ ] Confidence decay + rediscovery triggers
- [ ] Dashboard discovery status + health visibility
- [ ] `discovery_repairs` logging

### Files to Create

```
apps/worker/src/consumers/crawl-health.ts
apps/worker/src/consumers/discover-repair.ts
packages/crawler/src/discover/repair/index.ts
packages/crawler/src/discover/repair/header-refresh.ts
packages/crawler/src/discover/repair/pagination-fix.ts
packages/crawler/src/discover/repair/endpoint-swap.ts
```

### Files to Modify

```
apps/worker/src/consumers/discover.ts       # enqueue CrawlHealthJob on complete
apps/worker/src/index.ts                    # register new workers
packages/jobs/src/queues.ts                 # new queue helpers
packages/schema/src/jobs.ts                 # new job schemas
```

### Success Criteria

- Simulated endpoint failure triggers repair (not full rediscovery)
- Health score visible per retailer in DB
- Recipe rollback works via `retailer_recipe_versions`

---

## Phase 4 — Scale (Ongoing)

### Deliverables

- [ ] Dedicated discovery worker fleet on Fly.io (separate from crawl workers)
- [ ] Platform packs: Magento, BigCommerce, WooCommerce, Commercetools
- [ ] `listing_pages` runtime adapter (schema exists, no adapter today)
- [ ] Cross-retailer endpoint pattern library
- [ ] Domain-level shared retailer dedup
- [ ] Dashboard parity (surface discovery stages in UI)

### Infrastructure

```
# fly.toml — separate process group
[processes]
  crawl = "node dist/index.js --workers=crawl"
  discovery = "node dist/index.js --workers=discovery"
```

Discovery workers: 2–4 machines, browser pool, no crawl queue consumption.

### Success Criteria

- 100+ retailers onboarded with <5% human intervention
- Discovery workers independent of crawl load
- Mean discovery time <5 min for API-mode retailers

---

## Worker Registration

```typescript
// apps/worker/src/index.ts (target state)

if (workers.includes('discovery') || workers.includes('all')) {
  startDiscoverOrchestratorWorker();
  startDiscoverRepairWorker();
}

if (workers.includes('crawl') || workers.includes('all')) {
  startDiscoverWorker();
  startFetchWorker();
  startExtractWorker();
  startMatchWorker();
  startCrawlHealthWorker();
}
```

---

## Refactor Notes for `discover-config.ts`

Current worker (`apps/worker/src/consumers/discover-config.ts`):

- Concurrency 1 (shared browser)
- Linear: `discoverSite` → Jina → API sniff
- Promotes on success gates

Target:

- Delegate to `discoverOrchestrator()`
- Keep concurrency 1 until browser pool exists
- Write `discovery_runs` checkpoints
- Create `retailer_recipe_versions` on promotion
- Generate knowledge docs before enqueueing first crawl

Do **not** delete `discover-config.ts` immediately — run orchestrator behind feature flag `DISCOVERY_ORCHESTRATOR=1` until validated.

---

## Testing Strategy

| Layer | Test type | Location |
|-------|-----------|----------|
| Platform packs | Unit + HTTP mock | `platform-packs/*.test.ts` |
| Fingerprint | Unit with HTML fixtures | `fingerprint/*.test.ts` |
| Validation | Unit | `validate-endpoint.test.ts` |
| Orchestrator | Integration with fixtures | `orchestrator.test.ts` |
| Jina path | Live opt-in | `sites.integration.test.ts` (`JINA_INTEGRATION=1`) |
| Health/repair | Unit + DB integration | `repair/*.test.ts` |

Existing patterns to follow:

- `packages/crawler/src/discover/listing-md.test.ts`
- `packages/crawler/src/discovery.pattern.test.ts`
- `packages/crawler/src/discover/fixtures/`
