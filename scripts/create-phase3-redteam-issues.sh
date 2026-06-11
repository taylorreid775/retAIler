#!/usr/bin/env bash
# Creates GitHub issues from the Phase 3 network depth red-team assessment.
set -euo pipefail

REPO="${GITHUB_REPO:-taylorreid775/retAIler}"

if ! gh auth status &>/dev/null; then
  echo "Error: not logged in. Run: gh auth login" >&2
  exit 1
fi

ensure_label() {
  local name="$1" color="$2" description="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" 2>/dev/null || true
}

ensure_label "discovery" "1d76db" "Retailer discovery system"
ensure_label "phase-3-redteam" "5319e7" "Phase 3 network depth red-team findings"
ensure_label "severity:critical" "d73a4a" "Critical severity"
ensure_label "severity:high" "e99695" "High severity"
ensure_label "severity:medium" "fbca04" "Medium severity"
ensure_label "severity:low" "0e8a16" "Low severity"

create_issue() {
  local title="$1"
  shift
  local labels="$1"
  shift
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body "$1"
}

create_issue \
  "[Phase 3] Header dependency inference is non-functional: cookies stripped before analysis" \
  "discovery,phase-3-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
Phase 3 claims `cookiesRequired` and `dependsOn` inference, but `sanitizeHeaders()` in `apps/worker/src/network-capture.ts` strips **both** `Cookie` (request) and `Set-Cookie` (response) before captures are stored. `inferHeaderDependencies()` then reads empty header values and produces empty dependency graphs.

`replayableHeaders()` is defined in `header-deps.ts` but is **never called** anywhere in the codebase.

## Why it matters
TOOLS.md and WORKFLOW.md specify identifying required request context (cookies, CSRF, custom headers) via capture analysis. This is a core Phase 3 success criterion (“full header replay config”). Today the feature is effectively a no-op.

## Severity
**Critical**

## Likelihood
**Common** — affects every network-sniff onboarding.

## Impact
Recipes promoted without session context; static replay fails on first crawl; repair escalates to full rediscovery; false confidence that discovery captured replay requirements.

## Recommended fix
1. Preserve `Set-Cookie` in `responseHeaders` (and optionally `Cookie` in a separate `sensitiveHeaders` field not written to public HAR).
2. Run `inferHeaderDependencies()` on **chronological** captures before sorting for inference rank.
3. Implement TOOLS.md diff replay: replay top capture without cookies/headers, add back one at a time.
4. Merge `replayableHeaders()` + required cookies into `ApiRecipe.headers` / `staticQuery` at promotion time.

## References
- `apps/worker/src/network-capture.ts` (`sanitizeHeaders`, lines 37–43)
- `packages/crawler/src/discover/header-deps.ts`
- `docs/discovery/TOOLS.md` (Header Replay Inference)
EOF
)"

create_issue \
  "[Phase 3] Network capture loses requests due to async handler race with page teardown" \
  "discovery,phase-3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`captureNetworkRequests()` registers `page.on('response')` handlers as fire-and-forget `void (async () => { ... })()`. The page is closed after `waitForTimeout(5000)` and the browser is closed in `finally` without awaiting in-flight handlers.

Response body reads (`response.text()`) may fail or be truncated when the page/context is already destroyed.

## Why it matters
Incomplete capture sets cause false negatives in network sniff, wrong AI inference input, and empty HAR artifacts — undermining the primary Phase 3 deliverable.

## Severity
**High**

## Likelihood
**Common** on slow APIs, large JSON bodies, or bot-protected pages.

## Impact
Missed catalog endpoints; flaky onboarding; non-reproducible discovery failures at scale.

## Recommended fix
Track in-flight handler promises per page; `await Promise.all(pending)` before `page.close()` and `browser.close()`. Consider Playwright `page.route` or CDP Network domain for deterministic collection.

## References
- `apps/worker/src/network-capture.ts` (lines 75–133)
EOF
)"

create_issue \
  "[Phase 3] dependsOn inference uses score-sorted captures, destroying request order" \
  "discovery,phase-3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`inferHeaderDependencies()` assumes chronological request order to correlate `Set-Cookie` responses with later requests. `captureNetworkRequests()` sorts captures by `productLikeScore` **before** calling `inferHeaderDependencies()`.

## Why it matters
Even if cookie headers were preserved, dependency chains would be wrong. Token/session prerequisites cannot be reconstructed for replay or repair.

## Severity
**High**

## Likelihood
**Common** whenever multiple captures exist in one session.

## Impact
Incorrect `dependsOn` arrays mislead inference prompts and knowledge docs; repair cannot replay prerequisite requests.

## Recommended fix
Call `inferHeaderDependencies()` on chronologically ordered captures first; sort a **copy** for AI ranking afterward.

## References
- `apps/worker/src/network-capture.ts` (lines 138–148)
- `packages/crawler/src/discover/header-deps.ts`
EOF
)"

create_issue \
  "[Phase 3] needsApiSniff gate blocks network capture on sitemap-success API-capable sites" \
  "discovery,phase-3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Network sniff only runs when:
```
!platformPackUsed && !jinaResult && (confidence <= 0 || !productUrlPattern)
```

AGENT-ARCHITECTURE and WORKFLOW Stage 2 specify network analysis when no validated endpoint reaches confidence ≥ 0.7 — including sites with working sitemaps but superior hidden catalog APIs.

## Why it matters
Phase 1.3 parallel orchestrator was meant to recover API paths on sitemap-success retailers. This gate reintroduces sequential fallback behavior and leaves catalog APIs undiscovered.

## Severity
**High**

## Likelihood
**Occasional** — common among custom React/Next.js retailers with good sitemaps.

## Impact
Suboptimal crawl recipes (sitemap+PDP vs API); higher crawl cost; incomplete catalogs for large retailers; Phase 3 network depth unused on a major segment.

## Recommended fix
Trigger network capture when `apiValidationReport` is null or below `PROMOTION_MIN_CONFIDENCE`, regardless of sitemap/Jina success. Align with orchestrator candidate scoring.

## References
- `apps/worker/src/consumers/discover-config.ts` (lines 181–192)
- `docs/discovery/AGENT-ARCHITECTURE.md`
- `docs/discovery/WORKFLOW.md` Stage 2
EOF
)"

create_issue \
  "[Phase 3] HAR artifacts uploaded as public blobs may leak session and catalog data" \
  "discovery,phase-3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`storeNetworkHar()` uploads with `access: 'public'`. HAR entries include request/response headers and up to 32KB of response bodies per capture. Even with `sanitizeHeaders`, bodies may contain customer tokens, internal SKUs, pricing, and PII.

## Why it matters
At thousands of retailers, Blob becomes a growing public archive of third-party API traffic. Compliance and incident risk increase with every onboarding.

## Severity
**High**

## Likelihood
**Occasional** per retailer; **Common** in aggregate at scale.

## Impact
Data exposure; regulatory risk; leaked replay tokens enable third-party catalog scraping.

## Recommended fix
Use private Blob access; store signed URLs in `discovery_runs` / knowledge docs; redact bodies in HAR; never persist raw `Cookie`/`Authorization` in public artifacts.

## References
- `packages/crawler/src/discover/har.ts`
- `docs/discovery/SCALING.md` (Blob lifecycle)
EOF
)"

create_issue \
  "[Phase 3] GraphQL POST endpoints not replayable: operation captured but not persisted in recipe" \
  "discovery,phase-3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`parseGraphqlOperationName()` extracts operation names from captures, but:
- `ApiRecipe` has no field for GraphQL query body / operationName / variables template
- `buildApiPageQuery()` only mutates URL query params (GET-centric)
- Cursor pagination for GraphQL (Shopify Hydrogen, commercetools) requires POST body mutation, not query params

`inferApiRecipeFromCaptures()` can emit `method: 'POST'` but runtime pagination and crawl replay cannot execute it correctly.

## Why it matters
A growing share of modern commerce stacks expose catalog data via GraphQL POST. Phase 3 success criterion “full header replay config” cannot be met for these retailers.

## Severity
**High**

## Likelihood
**Occasional** today; **Common** as platform mix diversifies.

## Impact
False promotions; pagination breaks on first crawl; repair loops; manual intervention.

## Recommended fix
Extend `ApiRecipe` with `graphql: { operationName, query, variablesPath }` or `requestBodyTemplate`; teach `buildApiPageUrl` / fetch layer to POST; detect cursor in GraphQL `pageInfo`.

## References
- `packages/crawler/src/discover/graphql.ts`
- `packages/crawler/src/discover/api-recipe.ts`
- `docs/discovery/WORKFLOW.md` (GraphQL cursors)
EOF
)"

create_issue \
  "[Phase 3] Deploy migration 0007 before enabling retailer_endpoints writes" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`saveRetailerEndpointsFromDiscovery()` writes to `retailer_endpoints`, but the table only exists after `packages/db/drizzle/0007_retailer_endpoints.sql` is applied. The discover-config worker catches failures and logs a warning, silently skipping endpoint registry population.

## Why it matters
FAILURE-RECOVERY and COST-OPTIMIZATION assume `retailer_endpoints` is queryable for repair, rediscovery seeding, and capture cache skips.

## Severity
**Medium** (Critical in production if migration skipped)

## Likelihood
**Common** on first deploy of Phase 3 without migration run.

## Impact
Empty endpoint registry; repair `endpoint_swap` cannot use stored alternates; rediscovery re-sniffs unnecessarily.

## Recommended fix
Add migration to deploy checklist; fail onboarding promotion if endpoint save fails in production; add health check for table existence.

## References
- `packages/db/drizzle/0007_retailer_endpoints.sql`
- `apps/worker/src/consumers/discover-config.ts`
EOF
)"

create_issue \
  "[Phase 3] detectPaginationStyle amplifies HTTP probes during every validation and repair" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`validateApiRecipe()` always calls `detectPaginationStyle()`, which sequentially probes multiple page-param candidates, offset params, cursor styles, and link_rel — each requiring page-1 and page-2 fetches. Combined with the existing 3× reliability loop (~30s), a single validation can issue **20+ requests** to the retailer API.

Repair (`pagination_fix`) reuses the same detector. No global rate budget or backoff on 429.

## Why it matters
WORKFLOW Stage 3 requires rate-limit observation; SCALING.md targets per-retailer rate limits. At hundreds of onboardings + repairs, this risks blocks and unreliable validation.

## Severity
**Medium**

## Likelihood
**Common** at scale; **Occasional** per single retailer.

## Impact
429 bans; false `low_reliability`; retailer blocking; inflated discovery latency.

## Recommended fix
Short-circuit when configured pagination already verifies; cap probe attempts; record 429 in `failureModes`; share detected pagination in `retailer_endpoints` to skip re-probing within 24h (per COST-OPTIMIZATION).

## References
- `packages/crawler/src/discover/detect-pagination.ts`
- `packages/crawler/src/discover/validate-api-recipe.ts`
- `docs/discovery/WORKFLOW.md` Stage 3
EOF
)"

create_issue \
  "[Phase 3] Pagination and catalog-size validation prone to false positives" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
1. `pagesHaveDistinctProducts()` passes if **one** product on page 2 is not on page 1 — insufficient for randomized feeds, featured+organic overlap, or shuffled search APIs.
2. `paginationVerified` is set `true` when `page1Records.length < perPage` even if page 2 is empty (last-page case conflated with working pagination).
3. `estimateCatalogSize()` returns `perPage * 2` when no total-count field exists, inflating small catalogs (e.g. 25 items/page → 50 passes `PROMOTION_MIN_CATALOG_SIZE`).

## Why it matters
Promotion rule requires `confidence >= 0.7`, `catalog >= 50`, `reliability >= 0.9`. False positives promote broken recipes that fail at crawl scale.

## Severity
**Medium**

## Likelihood
**Occasional** per retailer; material at thousands of retailers.

## Impact
Incomplete catalogs; `pagination_break` anomalies; repair churn; customer-visible data gaps.

## Recommended fix
Require ≥50% novel IDs on page 2; probe page 3 for confirmation; use conservative catalog estimates without total field; cross-check sitemap count when available.

## References
- `packages/crawler/src/discover/detect-pagination.ts`
- `packages/crawler/src/discover/validate-api-recipe.ts`
EOF
)"

create_issue \
  "[Phase 3] Phase 2 recovery artifacts not wired: HAR URL, retailer_endpoints unused in repair/rediscovery" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Phase 3 added HAR export and `retailer_endpoints`, but:
- `writeKnowledgeDocs()` still hardcodes `har-blob-url: '(not captured)'` and `dependency-chain: '(not captured in phase 2)'`
- `discover-repair.ts` does not read `retailer_endpoints` or stored HAR
- `discovery_runs` table (checkpoint + artifact URLs) not implemented
- COST-OPTIMIZATION rule “reuse HAR if < 24h” not implemented

## Why it matters
FAILURE-RECOVERY explicitly lists HAR and endpoint registry as rediscovery inputs. Without wiring, Phase 3 artifacts are write-only and do not reduce repair/rediscovery cost.

## Severity
**Medium**

## Likelihood
**Common** once repairs trigger on API retailers.

## Impact
Every repair re-sniffs network; higher Playwright + AI cost; slower MTTR; ops cannot find HAR from knowledge docs.

## Recommended fix
Pass HAR URL into `writeKnowledgeDocs`; load latest Blob HAR in repair before browser capture; `endpoint_swap` should query `retailer_endpoints` alternates; add `discovery_runs` checkpoint rows.

## References
- `packages/crawler/src/discover/knowledge/writer.ts`
- `apps/worker/src/consumers/discover-repair.ts`
- `docs/discovery/FAILURE-RECOVERY.md`
- `docs/discovery/COST-OPTIMIZATION.md`
EOF
)"

create_issue \
  "[Phase 3] retailer_endpoints data quality: unvalidated secondary rows and weak classification" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
1. Secondary captures (top 5 by `productLikeScore`) are stored with `reliability_score = productLikeScore` — not validated reliability.
2. `endpointTypeFromCapture()` uses URL substring `/search` and loose GraphQL heuristics (`query` + `{` in body).
3. URL dedup in capture uses full URL string — distinct GraphQL POST bodies to same `/graphql` collapse to one capture.
4. Platform-pack promotions save endpoints but never attach HAR/capture context.

## Why it matters
Downstream repair and future endpoint pattern library (SCALING.md) assume `retailer_endpoints` is a vetted registry. Polluted rows misroute `endpoint_swap` and pattern aggregation.

## Severity
**Medium**

## Likelihood
**Common** for GraphQL and multi-endpoint retailers.

## Impact
Wrong endpoint type labels; false GraphQL classification; repair targets wrong URL; pattern library learns noise.

## Recommended fix
Only persist primary validated endpoint + explicitly validated alternates; hash dedup key includes method+body prefix; tighten `isGraphqlCapture`; store `graphqlOperationName` column.

## References
- `packages/crawler/src/discover/endpoints-db.ts`
- `packages/crawler/src/discover/graphql.ts`
- `apps/worker/src/network-capture.ts`
EOF
)"

create_issue \
  "[Phase 3] Implement discovery_runs checkpointing with HAR and capture artifact references" \
  "discovery,phase-3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
AGENT-ARCHITECTURE requires per-stage checkpointing to `discovery_runs` with `outputArtifactUrl`. Phase 3 stores HAR to Blob but only logs the URL — no durable DB reference, no resume after worker crash, no token/cost accounting.

## Why it matters
At thousands of retailers, long Playwright sniff jobs will fail mid-flight. Without checkpoints, work is discarded and retried from scratch (cost multiplier).

## Severity
**Medium**

## Likelihood
**Occasional** per job; **Common** in aggregate.

## Impact
Duplicated Playwright sessions; orphaned blobs; no ops visibility into discovery stage progress.

## Recommended fix
Add `discovery_runs` migration; insert row at onboarding start; update stages (`network`, `validate`, `promote`) with artifact URLs and timestamps.

## References
- `docs/discovery/AGENT-ARCHITECTURE.md`
- `docs/discovery/DATABASE-SCHEMA.md`
EOF
)"

create_issue \
  "[Phase 3] Add HAR compression and Blob lifecycle policy for discovery artifacts" \
  "discovery,phase-3-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
Each network sniff writes a new `discovery/{key}/{timestamp}/network.har` with pretty-printed JSON. SCALING.md specifies compression and 90-day lifecycle. No retention or size controls exist.

## Why it matters
1000 retailers × multiple sniffs/rediscoveries × ~100–500KB per HAR → unbounded Blob cost and management overhead.

## Severity
**Low** near-term; **Medium** at 500+ retailers

## Likelihood
**Common** at scale.

## Impact
Growing storage bill; slower artifact retrieval; compliance retention ambiguity.

## Recommended fix
Gzip HAR before upload; Vercel lifecycle rules; reference counting via `discovery_runs`; prune on rediscovery success.

## References
- `docs/discovery/SCALING.md`
- `packages/crawler/src/discover/har.ts`
EOF
)"

create_issue \
  "[Phase 3] Network capture misses scroll-triggered and infinite-catalog APIs" \
  "discovery,phase-3-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
Capture loads up to 6 seed URLs with `domcontentloaded` + fixed 5s wait. No scroll simulation, intersection observer triggers, or “load more” interaction. WORKFLOW lists infinite scroll detection via scroll-triggered network requests.

## Why it matters
Large retailers (department stores, marketplaces) lazy-load catalog APIs only after scroll. Phase 3 capture never sees them.

## Severity
**Low** per retailer; **Medium** for long-tail large catalogs

## Likelihood
**Occasional**.

## Impact
False negatives; fallback to expensive sitemap/PDP crawl; incomplete coverage.

## Recommended fix
After page load, programmatic scroll burst + wait for idle network; optional second-pass on listing seeds derived from sitemap.

## References
- `apps/worker/src/network-capture.ts`
- `docs/discovery/WORKFLOW.md` (Infinite scroll)
EOF
)"

create_issue \
  "[Phase 3] endpoint_swap repair should consult retailer_endpoints registry before platform packs" \
  "discovery,phase-3-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
`trySwapEndpoint()` only re-runs `runPlatformPack()` for alternates. It ignores rows in `retailer_endpoints` from prior network captures (secondary catalog/search/graphql URLs).

FAILURE-RECOVERY documents endpoint swap for 404s using known alternates.

## Why it matters
Phase 3 invested in endpoint registry, but repair cannot benefit until wired.

## Severity
**Low** now; **Medium** once registry is populated

## Likelihood
**Occasional** when primary endpoint rots but captured alternates remain valid.

## Impact
Unnecessary full platform-pack reprobe; missed fast repair path.

## Recommended fix
Query active `retailer_endpoints` ordered by `reliability_score`; validate each before platform pack fallback.

## References
- `packages/crawler/src/discover/repair/endpoint-swap.ts`
- `packages/crawler/src/discover/endpoints-db.ts`
- `docs/discovery/FAILURE-RECOVERY.md`
EOF
)"

echo "Phase 3 red-team issues created."
