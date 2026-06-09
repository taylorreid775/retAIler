# Existing Code Map

Maps the target architecture to the current RetAIler codebase. Use this when implementing — extend existing code rather than replacing it.

## Requirement → Implementation Status

| Requirement | Built today | Needs building |
|-------------|-------------|----------------|
| Homepage URL onboarding | `store_onboarding`, dashboard `actions.ts` | Domain dedup, shared retailer model |
| Platform fingerprinting | `detectPlatform()` (4 platforms) | Full fingerprint, 10+ platforms, bundle analysis |
| Sitemap discovery | `discoverSite()` | Run parallel with API discovery |
| Network sniff | `captureNetworkJson()` | Full request graph, header deps, HAR storage |
| API recipe inference | `inferApiRecipeFromCaptures()` | Platform packs first, pagination auto-detect |
| Jina categories | `discoverCategoryDirectory()` | Demote to nav-only, not primary catalog |
| CrawlRecipe config | `CrawlRecipeSchema` v1 | v2 with endpoints, health, versioning |
| Recurring crawls | `scheduler.ts` | Health monitoring, repair triggers |
| Knowledge docs | `discoveryNotes` column only | `docs/discovery/retailers/` structure |
| Retailer knowledge reuse | `crawlRecipe` jsonb | Recipe versions, endpoint registry, doc reader |
| Product normalization | `pipeline/ingest.ts` | No changes needed |
| Matching | `pipeline/matching.ts` | No changes needed |
| `listing_pages` mode | Schema only | Runtime adapter |
| Dashboard deep discovery | Worker only | Optional: surface stages in UI |

---

## Key Files by Layer

### Crawler (`packages/crawler`)

| File | Role | Architecture stage |
|------|------|-------------------|
| `src/discovery.ts` | `discoverSite()`, `deriveProductPattern()`, `SiteDiscovery` | Stage 1 |
| `src/agent-manifest.ts` | `fetchAgentManifest()`, `buildCrawlRecipe()`, `detectPlatform()` | Stage 0–1, 5 |
| `src/discover/infer-api-recipe.ts` | AI → `ApiRecipe` | Stage 2–3 |
| `src/discover/validate-api-recipe.ts` | Probe inferred recipes | Stage 3 |
| `src/discover/api-recipe.ts` | `discoverProductsFromApiRecipe()` replay | Stage 4, crawl |
| `src/discover/score-json-response.ts` | Heuristic JSON scoring | Stage 2 |
| `src/discover/category-directory.ts` | Jina + AI categories | Stage 1 (nav only) |
| `src/discover/listing-md.ts` | Parse Jina listing markdown | Crawl (jina mode) |
| `src/discover/pagination.ts` | `ListingPagination` URL building | Stage 3, crawl |
| `src/discover/listing-pages-db.ts` | `saveListingPages()`, `loadListingPages()` | Stage 5 |
| `src/jina/fetcher.ts` | `fetchJinaMarkdown()` | Stage 1–2 |
| `src/adapters/index.ts` | Adapter registry + `resolveAdapter()` | Crawl runtime |
| `src/adapters/generic.ts` | Sitemap URL discovery | Crawl (sitemap mode) |
| `src/adapters/recipe-adapter.ts` | API mode adapter | Crawl (api mode) |
| `src/adapters/jina-adapter.ts` | Jina listing crawl | Crawl (jina mode) |
| `src/adapters/sportchek-api.ts` | Re-exports hand-authored recipe | Reference |
| `src/extract/index.ts` | Layered extraction orchestration | Crawl |
| `src/extract/llm.ts` | LLM PDP fallback | Crawl (not discovery) |

### Worker (`apps/worker`)

| File | Role |
|------|------|
| `src/consumers/discover-config.ts` | Onboarding worker (refactor → orchestrator) |
| `src/consumers/discover.ts` | Crawl enumeration, adapter resolution |
| `src/discover-fetch.ts` | Static-first + Playwright fallback |
| `src/network-capture.ts` | Playwright XHR sniff |
| `src/fetchers.ts` | `fetcherFor('static' \| 'browser' \| 'jina_reader')` |
| `src/scheduler.ts` | Cron → `DiscoverJob` per retailer |
| `src/crawl-run.ts` | Crawl run lifecycle |
| `src/enqueue.ts` | Manual job enqueue |

### Schema (`packages/schema`)

| File | Role |
|------|------|
| `src/crawl-recipe.ts` | `CrawlRecipe`, `ApiRecipe`, `JinaRecipe` |
| `src/retailer.ts` | `Retailer`, `CrawlPolicy`, `FetchStrategy` |
| `src/jobs.ts` | BullMQ job payload schemas |
| `src/product.ts` | `RawExtractedProduct`, observations |
| `src/recipes/sportchek-crawl-recipe.ts` | Reference API recipe |

### Database (`packages/db`)

| File | Role |
|------|------|
| `src/schema.ts` | `retailers`, `retailer_listing_pages`, `store_onboarding`, `crawl_runs` |
| `drizzle/0004_jina_listing_pages.sql` | Listing pages migration |

### Jobs (`packages/jobs`)

| File | Role |
|------|------|
| `src/queues.ts` | Queue registry, `discoverConfig()`, `discover()` |
| `src/connection.ts` | Redis connection |

### Pipeline (`packages/pipeline`)

| File | Role |
|------|------|
| `src/ingest.ts` | Upsert `retailer_products` |
| `src/normalize.ts` | Brand/category canonicalization |
| `src/embeddings.ts` | Product embeddings |
| `src/matching.ts` | pgvector + LLM adjudication |
| `src/match.ts` | Match orchestration |

### Core (`packages/core`)

| File | Role |
|------|------|
| `src/ai.ts` | AI Gateway client |
| `src/env.ts` | Environment validation |
| `src/logger.ts` | Structured logging |

### Dashboard (`apps/dashboard`)

| File | Role |
|------|------|
| `src/app/(app)/competitors/actions.ts` | Fast static onboarding + worker handoff |

---

## Current Discovery Flow (Code Path)

```
Dashboard actions.ts
  → discoverSite() [12s static cap]
  → promote OR enqueue DiscoverConfigJob

discover-config.ts
  → discoverSite() [browser]
  → discoverCategoryDirectory() [Jina + AI]
  → captureNetworkJson() + inferApiRecipe() [if Jina failed]
  → validateApiRecipe()
  → saveListingPages()
  → INSERT retailers
  → enqueue DiscoverJob

discover.ts
  → resolveAdapter(crawlRecipe.discoveryMode)
  → jina | api | sitemap path
  → ingest + match OR fetch fan-out
```

---

## Adapter Resolution (Today)

From `apps/worker/src/consumers/discover.ts` `resolveAdapter()`:

| `discoveryMode` | Adapter | Product source |
|-----------------|---------|----------------|
| `api` | `createRecipeAdapter` | API JSON |
| `jina_categories` | `createJinaAdapter` | Jina listing markdown |
| `sitemap` | hand-written or `createGenericAdapter` | PDP URLs → fetch → extract |
| `listing_pages` | **Not implemented** | — |

---

## Type Reference

| Type | Location |
|------|----------|
| `SiteDiscovery` | `packages/crawler/src/discovery.ts` |
| `CrawlRecipe`, `ApiRecipe`, `JinaRecipe` | `packages/schema/src/crawl-recipe.ts` |
| `CategoryDirectory`, `CategoryDirectoryResult` | `packages/crawler/src/discover/category-directory.ts` |
| `RetailerAdapter`, `DiscoverContext` | `packages/crawler/src/adapters/types.ts` |
| `DiscoverConfigJob`, `DiscoverJob` | `packages/schema/src/jobs.ts` |
| `ListingPageRow` | `packages/crawler/src/discover/listing-pages-db.ts` |
| `AgentManifestHints` | `packages/crawler/src/agent-manifest.ts` |
| `RawExtractedProduct` | `packages/schema/src/product.ts` |

---

## Probe Scripts (WIP Tooling)

Development scripts — not production workers:

```
apps/worker/src/scripts/
  probe-jina.ts
  probe-jina-sites.ts
  probe-jina-categories.ts
  probe-jina-extract.ts
  probe-one.ts
  batch-probe-discovery.ts
  analyze-jina-md.ts
```

Useful for validating platform packs and Jina coverage before wiring into orchestrator.

---

## Tests

| File | Coverage |
|------|----------|
| `packages/crawler/src/discovery.pattern.test.ts` | URL pattern derivation |
| `packages/crawler/src/discover/listing-md.test.ts` | Jina markdown parsing |
| `packages/crawler/src/discover/category-directory.test.ts` | Category discovery |
| `packages/crawler/src/discover/sites.integration.test.ts` | Live Jina (`JINA_INTEGRATION=1`) |
| `packages/crawler/src/discovery.pattern.test.ts` | Pattern tests |

---

## Git Status Note

Active development branch includes uncommitted work on Jina discovery, listing pages, and discover-config changes. Agents should read current file contents before assuming behavior matches this doc.
