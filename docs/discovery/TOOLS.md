# Discovery Tool Definitions

Tools are TypeScript functions invoked by the discovery orchestrator. They are **not** LLM tool-calling primitives.

## Tool Registry

| Tool | Type | Input | Output | AI? | Existing Code |
|------|------|-------|--------|-----|---------------|
| `fetchPage` | Deterministic | URL, strategy | HTML/text | No | `discover-fetch.ts` |
| `fetchRobotsTxt` | Deterministic | domain | robots rules, sitemap URLs | No | `discovery.ts` |
| `fetchSitemaps` | Deterministic | sitemap URLs | URL corpus + counts | No | `discovery.ts` |
| `fetchAgentManifest` | Deterministic | origin | `AgentManifestHints` | No | `agent-manifest.ts` |
| `analyzeBundles` | Deterministic | JS bundle URLs | platform signals, API base URLs | No | **New** |
| `fingerprintSite` | Deterministic | all above | `RetailerFingerprint` | No | **New** (extends `detectPlatform`) |
| `runPlatformPack` | Deterministic | platform + domain | `ApiRecipe[]` | No | **New** |
| `captureNetwork` | Deterministic | seed URLs | `CapturedRequest[]` | No | `network-capture.ts` |
| `scoreJsonResponse` | Deterministic | JSON body | product-likeness 0–1 | No | `score-json-response.ts` |
| `inferApiRecipe` | AI-assisted | top captures | `ApiRecipe` | **Yes** | `infer-api-recipe.ts` |
| `validateEndpoint` | Deterministic | recipe + pagination | `ValidationReport` | No | `validate-api-recipe.ts` |
| `probeCatalog` | Deterministic | recipe | sample products + count estimate | No | `api-recipe.ts` |
| `extractFromHtml` | Deterministic | PDP URLs | JSON-LD / `__NEXT_DATA__` | No | `extract/structured.ts` |
| `discoverCategories` | Hybrid | homepage MD | `CategoryDirectory` | **Yes** | `category-directory.ts` |
| `generateCrawlRecipe` | Deterministic | validated outputs | `CrawlRecipe` v2 | No | `agent-manifest.ts` `buildCrawlRecipe` |
| `writeKnowledgeDocs` | Deterministic | stage outputs | markdown files | No | **New** |
| `repairRecipe` | Deterministic | health report + old recipe | patched recipe or null | No | **New** |

## Tool Interfaces

### `fingerprintSite`

```typescript
interface RetailerFingerprint {
  domain: string;
  platform: Platform | 'unknown';
  platformConfidence: number;
  framework: 'nextjs' | 'react' | 'hydrogen' | 'stencil' | 'unknown';
  commerceEngine: string | null;
  botProtection: 'none' | 'cloudflare' | 'akamai' | 'incapsula' | 'unknown';
  apiHints: string[];
  bundleSignals: string[];
  recommendedStrategy: 'platform_pack' | 'network_sniff' | 'sitemap' | 'jina_nav';
  detectedAt: string;
}

type Platform =
  | 'shopify'
  | 'shopify_hydrogen'
  | 'salesforce'
  | 'magento'
  | 'bigcommerce'
  | 'woocommerce'
  | 'sap_commerce'
  | 'commercetools'
  | 'custom_react'
  | 'custom_nextjs'
  | 'unknown';
```

### `captureNetwork` (extended)

Extend existing `captureNetworkJson()` → `captureNetworkRequests()`:

```typescript
interface CapturedRequest {
  url: string;
  method: string;
  resourceType: 'xhr' | 'fetch' | 'document' | 'script';
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;          // GraphQL query + operationName
  status: number;
  contentType: string;
  responseBody?: string;         // truncated to 256KB
  timing: { startMs: number; durationMs: number };
  initiatorUrl: string;
  cookiesRequired: string[];     // inferred by diffing success/fail
  dependsOn?: string[];          // prior request URLs that set cookies/tokens
}
```

Persist HAR to Vercel Blob (private access, redacted headers): `discovery/{retailerKey}/{timestamp}/network.har`

### `validateEndpoint`

```typescript
interface ValidationReport {
  endpoint: string;
  reliability: number;           // 0-1, from 3 requests over 30s
  estimatedCatalogSize: number;
  paginationStyle: 'offset' | 'cursor' | 'page' | 'link_rel' | 'none';
  paginationParam: string | null;
  fieldsPresent: Record<string, number>;  // field → % present in sample
  failureModes: string[];
  confidence: number;            // composite 0-1
}
```

**Promotion rule:** `confidence >= 0.7 AND estimatedCatalogSize >= 50 AND reliability >= 0.9`

### `generateCrawlRecipe`

Output `CrawlRecipe` v2 — see [WORKFLOW.md](./WORKFLOW.md#stage-5--configuration-generation).

## Header Replay Inference

`captureNetwork` must automatically identify required request context:

- User-Agent requirements
- Locale / Accept-Language
- Referer requirements
- Custom API headers (e.g. `x-shopify-storefront-access-token`)
- Session cookies
- CSRF tokens
- GraphQL operation names

**Method:** Diff requests that succeed vs fail without cookies/headers. Store results in `ApiRecipe.headers` and `ApiRecipe.staticQuery`.

## Tool Location Convention

```
packages/crawler/src/
  fingerprint/
    index.ts
    signals.ts
    bundles.ts
  discover/
    stages/
      fingerprint.ts
      static-analysis.ts
      network-capture.ts
      validate-endpoint.ts
      catalog-probe.ts
      generate-config.ts
    platform-packs/
      shopify.ts
      salesforce.ts
      magento.ts
      bigcommerce.ts
      woocommerce.ts
      index.ts
    repair/
      index.ts
      header-refresh.ts
      pagination-fix.ts
      endpoint-swap.ts
    knowledge/
      writer.ts
      reader.ts
    orchestrator.ts
```
