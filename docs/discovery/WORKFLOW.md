# Discovery Workflow

Five stages plus fingerprinting (Stage 0). Stages 1–3 should run **in parallel** where possible, not as sequential fallbacks.

## Stage 0 — Fingerprint

**Goal:** Route discovery strategy before expensive browser/network work.

**Inputs:** homepage, robots.txt, first HTML response, JS bundle URLs, response headers, cookies.

**Runs before:** all other stages.

### Platform Signals (Weighted Scoring)

| Platform | Deterministic signals |
|----------|----------------------|
| Shopify | `cdn.shopify.com`, `Shopify.theme`, `/products.json`, Storefront API headers |
| Shopify Hydrogen | `@shopify/hydrogen`, Oxygen headers, `/api/unstable/graphql` |
| Salesforce CC | `demandware`, `dw.ac`, `/on/demandware.store/`, `__NEXT_DATA__.props.site` |
| Magento | `mage/`, `/rest/V1/`, `data-mage-init` |
| BigCommerce | `bigcommerce.com`, `window.BCData` |
| WooCommerce | `wp-content`, `/wp-json/wc/store/` |
| SAP Commerce | `hybris`, `/occ/v2/` |
| Commercetools | `commercetools`, `/graphql` + commercetools operation names |
| Custom Next.js | `__NEXT_DATA__`, `/_next/static/` |
| Custom React | Bundle analysis for commerce SDKs (Algolia, Constructor.io, Stripe) |

**Output:** `RetailerFingerprint` with `recommendedStrategy`.

**Extend:** `packages/crawler/src/agent-manifest.ts` `detectPlatform()` — currently only Shopify, BigCommerce, Salesforce, unknown.

---

## Stage 1 — Initial Analysis

**Goal:** Gather site structure evidence without full network capture.

**Reuse:** `discoverSite()`, `fetchAgentManifest()`.

### Analyze

- Homepage structure and category links
- Category pages (sample)
- Product pages (sample, content-confirmed)
- Site structure (shallow BFS if no sitemap)
- `robots.txt` directives and crawl-delay
- Sitemaps (multi-sitemap support)
- Agent manifests (`llms.txt`, `ai.txt`, etc.)
- JavaScript bundles (new): extract `*.js` URLs from HTML, fetch first 3, regex-scan for API base URLs, GraphQL endpoints, commerce SDKs

### Identify

- Platform, framework, commerce engine
- Known URL patterns (product, listing, API)
- Fetch strategy (`static` vs `browser`)

### Parallel Execution

Run concurrently with Stage 0 completion:

1. Sitemap corpus build
2. Platform pack probe (if fingerprint confidence ≥ 0.5)
3. Bundle analysis

---

## Stage 2 — Network Analysis

**Goal:** Behave like a skilled engineer using Chrome DevTools.

**Trigger:** When Stage 1 + platform packs produce no validated endpoint with confidence ≥ 0.7.

**Reuse/extend:** `apps/worker/src/network-capture.ts`, `scoreJsonForProducts()`.

### Record Per Request

- Fetch, XHR, GraphQL requests
- Request and response headers
- Query parameters and request body
- Cookies and authentication tokens
- Request order and timing
- Response schemas (truncated bodies)

### Determine

- Which requests contain product, pricing, inventory, variant data
- Which requests are required vs optional
- Which requests depend on prior requests (cookie/token chain)
- All headers required for successful replay

### Deterministic Classification (Before AI)

1. **GraphQL:** parse `operationName`, extract response shape
2. **REST:** score with `scoreJsonForProducts()`
3. Group by URL pattern; rank by `productLikeness × responseSize × paginationSignals`

### Storage

- HAR file → Vercel Blob `discovery/{retailerKey}/{timestamp}/network.har`
- Top-N captures → `discovery_runs` checkpoint metadata

---

## Stage 3 — Endpoint Validation

**Goal:** Confirm each candidate endpoint can retrieve a meaningful portion of the catalog.

**Applies to:** platform pack candidates, static analysis hints, network captures.

### For Every Discovered Endpoint

| Check | Method |
|-------|--------|
| Reliability | 3 requests over 30s; compute success rate |
| Pagination | Probe page 1 vs page 2; detect offset/cursor/page param |
| Product coverage | Compare `total_count` field vs items returned |
| Rate limits | Watch 429 / `Retry-After` headers |
| Auth durability | Replay without browser session |
| Field completeness | SKU, price, name present in ≥90% of sample items |

**Reuse:** `validateApiRecipe()` in `packages/crawler/src/discover/validate-api-recipe.ts`.

### Pagination Patterns

- Offset (`offset`, `start`)
- Cursor (`cursor`, `after`, `page_info.end_cursor`)
- Page number (`page`, `p`, `pageNumber`)
- Link rel (`<link rel="next">`)
- GraphQL cursors (`hasNextPage`, `endCursor`)
- Infinite scroll (detect via network capture of scroll-triggered requests)

### Promotion Rule

```
confidence >= 0.7
AND estimatedCatalogSize >= 50
AND reliability >= 0.9
```

---

## Stage 4 — Catalog Extraction (Probe)

**Goal:** Validate normalized product output — not a full catalog crawl.

### Probe Scope

- 1–3 pages per category dimension
- Maximum 50 products total during discovery
- Map to `RawExtractedProduct` via `ApiRecipe.fieldMap` or platform pack defaults

### Extract Fields

| Field | Required for promotion |
|-------|------------------------|
| Product ID / SKU | Yes |
| Name | Yes |
| Current price | Yes |
| Product URL | Yes |
| Brand | Preferred |
| Description | Optional at discovery |
| Category | Preferred |
| Images | Preferred |
| Regular/sale price | Preferred |
| Currency | Yes (default from retailer locale) |
| Variants, sizes, colours | Platform-dependent |
| Inventory status | Preferred |
| UPC/GTIN | High value for matching |

### Output Validation

Validate against `RawExtractedProduct` in `packages/schema/src/product.ts`. Ingest probe results are **not** persisted to production tables — stored in validation artifact only.

---

## Stage 5 — Configuration Generation

**Goal:** Produce reusable retailer configuration for all future crawls.

### Primary Endpoint Priority

1. Validated catalog/search API
2. Platform pack endpoint (e.g. Shopify `products.json`)
3. `jina_categories` (navigation only — products from API or PDP fetch)
4. `sitemap` + PDP extraction (last resort)

### CrawlRecipe v2 Shape

```typescript
interface CrawlRecipeV2 {
  version: 2;
  sources: CrawlRecipe['sources'];
  discoveryMode: 'sitemap' | 'listing_pages' | 'api' | 'jina_categories';
  platform: Platform | null;
  fingerprint: RetailerFingerprint;

  endpoints: {
    catalog?: ApiRecipe;
    search?: ApiRecipe;
    product?: ApiRecipe;      // single-PDP detail API
    inventory?: ApiRecipe;
    variants?: ApiRecipe;
  };
  primaryEndpoint: 'catalog' | 'search' | 'sitemap' | 'jina_categories';

  // Legacy fields (keep for adapter compatibility)
  sitemapUrls: string[];
  productUrlPattern: string | null;
  listingUrlPattern: string | null;
  fetchStrategy: 'static' | 'browser' | 'jina_reader' | null;
  extractionStrategy: 'json_ld' | 'next_data' | 'og_meta' | 'llm_fallback';
  extractionHints: { imageJsonPaths: string[]; priceJsonPaths: string[] };
  sampleProductUrls: string[];
  agentFileUrl: string | null;
  notes: string[];
  confidence: number;

  api: ApiRecipe | null;       // primary catalog/search recipe
  jina: JinaRecipe | null;

  pagination: {
    style: 'offset' | 'cursor' | 'page' | 'link_rel' | 'none';
    paramName: string | null;
    maxPages: number;
    delayMs: number;
  };

  health: {
    baselineCatalogSize: number;
    baselineConfidence: number;
    discoveredAt: string;
  };

  compliance: {
    robotsRespected: boolean;
    requestDelayMs: number;
    maxConcurrency: number;
  };

  rateLimits: {
    requestsPerSecond?: number;
    retryAfterMs?: number;
  };
}
```

### Example Configuration (Illustrative)

```json
{
  "retailer": "sportchek",
  "platform": "salesforce",
  "primaryEndpoint": "catalog",
  "search_endpoint": "https://www.sportchek.ca/api/products/search",
  "product_endpoint": null,
  "inventory_endpoint": null,
  "headers": {
    "Accept": "application/json",
    "Accept-Language": "en-CA"
  },
  "cookies": {},
  "pagination_strategy": "page",
  "product_schema": {
    "fieldMap": {
      "title": "name",
      "price": ["price.salePrice", "price.value"],
      "url": "url"
    }
  },
  "rate_limits": {
    "delayMs": 500,
    "maxPages": 100
  },
  "confidence_score": 0.92
}
```

### Persistence

| Destination | Content |
|-------------|---------|
| `retailers.crawl_recipe` | Active recipe (latest version) |
| `retailer_recipe_versions` | Immutable version history |
| `retailer_endpoints` | Queryable endpoint registry |
| `retailer_listing_pages` | Category URLs (Jina/nav modes) |
| `docs/discovery/retailers/{key}/` | Human/agent-readable knowledge docs |

### Post-Generation

1. Promote `store_onboarding` → `retailers` row
2. Link `org_competitors`
3. Enqueue first `crawl-discover` job
4. Write knowledge docs (no LLM)

---

## Rediscovery Workflow

Daily crawls should:

- Reuse existing configurations and retailer knowledge
- Refresh product data
- Detect schema changes, endpoint failures, coverage drops

Only trigger rediscovery when `crawl_health_score` falls below defined thresholds. See [FAILURE-RECOVERY.md](./FAILURE-RECOVERY.md).
