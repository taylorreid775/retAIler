# System Architecture

## Overview

RetAIler discovery spans two phases:

1. **Onboarding / config discovery** — Determine how to extract a retailer's full catalog.
2. **Crawl discovery** — Enumerate products on each scheduled or on-demand run.

Config is persisted on `retailers.crawlRecipe` plus optional `retailer_listing_pages` rows. Crawl runs are tracked in `crawl_runs`.

## High-Level Diagram

```mermaid
flowchart TB
    subgraph ingress [Ingress]
        UI[Dashboard: competitor URL]
        API[API / webhook]
    end

    subgraph resolve [Retailer Resolution]
        RU[Retailer Resolver]
        RU -->|exists| GRANT[Grant org access]
        RU -->|new| ONB[store_onboarding]
    end

    subgraph discovery [Discovery Orchestrator]
        FP[Fingerprint Engine]
        S1[Stage 1: Static Analysis]
        S2[Stage 2: Network Capture]
        S3[Stage 3: Endpoint Validation]
        S4[Stage 4: Catalog Probe]
        S5[Stage 5: Config Generation]
        FP --> S1 --> S2 --> S3 --> S4 --> S5
    end

    subgraph knowledge [Knowledge Layer]
        DB[(Neon: retailers, recipes, health)]
        BLOB[(Vercel Blob: HAR, captures)]
        DOCS[docs/discovery/retailers/]
    end

    subgraph crawl [Crawl Runtime]
        DISC[crawl-discover]
        FETCH[crawl-fetch]
        EXT[pipeline-extract]
        MATCH[pipeline-match]
    end

    subgraph repair [Health & Repair]
        HEALTH[Crawl Health Monitor]
        REPAIR[Incremental Repair]
        REDISC[Targeted Rediscovery]
    end

    UI --> RU
    API --> RU
    ONB --> FP
    S5 --> DB
    S5 --> DOCS
    S2 --> BLOB
    S5 --> DISC
    DISC --> FETCH --> EXT --> MATCH
    DISC --> HEALTH
    HEALTH -->|confidence drop| REPAIR
    REPAIR -->|repair failed| REDISC
    REDISC --> FP
```

## Package Placement

| Module | Package | Role |
|--------|---------|------|
| `fingerprint/` | `packages/crawler` | Platform detection, bundle analysis, strategy routing |
| `discover/stages/` | `packages/crawler` | Deterministic stage implementations |
| `discover/platform-packs/` | `packages/crawler` | Shopify, SFCC, Magento, etc. known endpoints |
| `discover/repair/` | `packages/crawler` | Incremental config repair |
| `discover/knowledge/` | `packages/crawler` | Read/write retailer intelligence docs |
| `RetailerFingerprintSchema` | `packages/schema` | Typed fingerprint + health |
| `discover-orchestrator` consumer | `apps/worker` | Multi-stage job coordinator |
| `crawl-health` consumer | `apps/worker` | Post-crawl health evaluation |
| `discover-repair` consumer | `apps/worker` | Incremental repair attempts |

## Retailer Resolution (B2B Entry Point)

When a business submits a homepage URL:

```
normalizeUrl(input) → domain
  → lookup retailers WHERE domain = ? OR homepage_url = ?
    → HIT: link org_competitors, return existing retailer (immediate access)
    → MISS: create store_onboarding → enqueue DiscoverOrchestratorJob
```

### If competitor exists

- Reuse existing `retailers` row and `crawlRecipe`
- Reuse existing catalog data in `retailer_products`
- Grant org access via `org_competitors`
- No rediscovery unless health score is below threshold

### If competitor does not exist

- Run full discovery orchestrator
- Build reusable crawl configuration
- Populate retailer catalog via first `crawl-discover` job
- Schedule recurring refreshes via existing scheduler

**Implementation note:** Domain-level dedup and shared-retailer model need to be added. Today `store_onboarding` is per-org; one discovery should serve all orgs monitoring the same domain.

## Current Pipeline (Baseline)

```mermaid
flowchart TD
    A[User submits store URL] --> B[startAddStoreByUrl]
    B --> C[store_onboarding row]
    C --> D[discoverSite static 12s cap]
    D -->|pattern + confidence > 0| E[promoteDiscoveredStore]
    D -->|fail/timeout| F[DiscoverConfigJob queue]
    F --> G[discover-config worker]
    G --> H[discoverSite + browser fetchText]
    H --> I[discoverCategoryDirectory Jina+AI]
    I -->|confidence >= 0.3| J[mergeJinaIntoCrawlRecipe]
    I -->|low confidence| K{needs API sniff?}
    K -->|yes| L[captureNetworkJson → inferApiRecipe → validateApiRecipe]
    K -->|no| M[validate path evidence]
    J --> N[Insert/update retailers + saveListingPages]
    L --> N
    M --> N
    E --> O[DiscoverJob first crawl]
    N --> O
    O --> P[discover worker: resolveAdapter]
    P -->|jina_categories| Q[JinaAdapter → ingest + match]
    P -->|api| R[RecipeAdapter → ingest + match]
    P -->|sitemap| S[GenericAdapter → FetchJob fan-out]
    S --> T[fetch → extract → match pipeline]
```

The target architecture **evolves** this pipeline into a parallel orchestrator with health/repair loops — not a greenfield rewrite.

## Crawl Runtime (Unchanged Core)

`crawl-discover` resolves adapter from `crawlRecipe.discoveryMode`:

| Mode | Adapter | Flow |
|------|---------|------|
| `api` | `createRecipeAdapter` | Paginated API → direct ingest |
| `jina_categories` | `createJinaAdapter` | Paginated Jina listing pages → direct ingest |
| `sitemap` | `createGenericAdapter` or hand-written | URL discovery → `crawl-fetch` → extract → match |
| `listing_pages` | **Not implemented** | Schema exists; needs adapter |

## Tech Stack Integration

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19 (dashboard onboarding UI) |
| Workers | BullMQ, Fly.io workers |
| Database | Neon Postgres, Drizzle ORM |
| Cache/queues | Upstash Redis |
| Artifacts | Vercel Blob (HAR, bundles, probes) |
| Browser | Playwright (network capture, bot-protected sites) |
| AI | Vercel AI SDK via AI Gateway (`@retailer/core`) |
| Fetch proxy | Jina Reader (navigation/markdown only) |
