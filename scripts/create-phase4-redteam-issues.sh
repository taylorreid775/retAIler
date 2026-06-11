#!/usr/bin/env bash
# Creates GitHub issues from the Phase 4 scale red-team assessment.
set -euo pipefail

REPO="${GITHUB_REPO:-taylorreid775/retAIler}"

if ! gh auth status &>/dev/null; then
  echo "Error: not logged in. Run: gh auth login" >&2
  exit 1
fi

create_issue() {
  local title="$1"
  local labels="$2"
  local body="$3"
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body "$body"
}

# ── Category A: Must Fix Before Phase 5 ──

create_issue \
  "[Phase 4] Browser pool shares Playwright context across concurrent discovery jobs" \
  "discovery,phase-4-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
`BrowserPool.acquire()` round-robins across a fixed set of `BrowserFetcher` instances, each holding **one** shared `BrowserContext`. `DISCOVERY_CONCURRENCY` defaults to 2 (see `fly.toml`) and can exceed pool size.

Concurrent `discover-config` jobs therefore share cookies, localStorage, and session state across unrelated retailers/domains.

## Why it matters
SCALING.md targets 4–8 parallel discoveries at 1000+ retailers. Shared session state causes cross-retailer contamination: wrong cookies on API probes, false platform-pack successes, bot-wall bypass for one site affecting another, and non-deterministic discovery.

## Severity
**Critical**

## Likelihood
**Common** whenever `DISCOVERY_CONCURRENCY > 1` (default in Fly config).

## Impact
Incorrect recipes promoted; intermittent production failures; data quality corruption; security/compliance exposure (session bleed between customer competitors).

## Recommended fix
Use exclusive lease semantics: one browser context per in-flight discovery job (pool size ≥ concurrency), or mutex per fetcher for job duration. Restart context after N jobs. Do not increase concurrency until isolation exists.

## References
- `apps/worker/src/browser-pool.ts`
- `apps/worker/src/browser-fetcher.ts`
- `apps/worker/fly.toml` (`DISCOVERY_CONCURRENCY`, `BROWSER_POOL_SIZE`)
EOF
)"

create_issue \
  "[Phase 4] Dedup hit updates recipe versions but not retailers.crawlRecipe" \
  "discovery,phase-4-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
When `discover-config` finds an existing retailer (`existing` branch), it writes a new `retailer_recipe_versions` row when `recipeChanged`, but only updates `fetchStrategy`, `productUrlPattern`, and `discoveryNotes` on `retailers` — **not** `crawlRecipe`, `fingerprint`, or `discoveryConfidence`.

Crawl runtime reads `retailers.crawlRecipe` via `resolveAdapter()`.

## Why it matters
Second org onboarding or re-discovery can persist validated API/listing recipes in version history while the active crawl continues using stale config. Violates FAILURE-RECOVERY.md versioning/rollback model and IMPLEMENTATION-ORDER 4.1 shared-retailer semantics.

## Severity
**Critical**

## Likelihood
**Occasional** — whenever a domain already exists and discovery improves the recipe.

## Impact
Silent stale crawls; health/repair operate on wrong active recipe; false confidence from new version rows that are never applied.

## Recommended fix
On dedup hit with `recipeChanged`, update `retailers.crawlRecipe`, `fingerprint`, and `discoveryConfidence` in the same transaction as `writeRecipeVersion`, or promote latest version to active explicitly.

## References
- `apps/worker/src/consumers/discover-config.ts` (existing retailer branch ~264–288)
EOF
)"

create_issue \
  "[Phase 4] Dashboard fast-path promotion lacks dedup re-check before INSERT" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`promoteDiscoveredStore()` in dashboard `actions.ts` inserts into `retailers` without re-checking normalized domain, unlike `discover-config.ts`.

Two orgs can pass `startAddStoreByUrl` concurrently (before either retailer exists), both succeed at static discovery, and both attempt INSERT.

## Why it matters
IMPLEMENTATION-ORDER 4.1 requires instant second-org access via shared retailer. Race loses dedup benefits and relies on DB unique index as a crash path.

## Severity
**High**

## Likelihood
**Occasional** — concurrent onboarding of same domain on fast static path.

## Impact
Unique constraint violation → user-facing error; or duplicate rows if migration not applied; duplicate crawl work.

## Recommended fix
Use `INSERT … ON CONFLICT (domain) DO UPDATE` or pre-insert lookup + link `org_competitors` pattern matching worker path. Handle conflict by linking org and skipping duplicate crawl enqueue.

## References
- `apps/dashboard/src/app/(app)/competitors/actions.ts` (`promoteDiscoveredStore`)
EOF
)"

create_issue \
  "[Phase 4] Migration 0008 adds unique domain index without duplicate resolution" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`0008_retailer_domain_dedup.sql` normalizes `www.` prefixes then `CREATE UNIQUE INDEX retailers_domain_idx ON retailers (domain)` with no merge/repoint-FK step for existing duplicates (e.g. `sportchek.ca` vs `www.sportchek.ca` rows, subdomain variants).

## Why it matters
Production deploy will fail or leave latent duplicates if historical data contains collisions. Blocks safe rollout of shared-retailer model at scale.

## Severity
**High**

## Likelihood
**Occasional** in prod; **Common** in long-running dev/staging with manual seeds.

## Impact
Migration failure; ops firefight; inability to ship Phase 4 dedup.

## Recommended fix
Add preflight query + merge script: keep canonical retailer, repoint FKs (`org_competitors`, `retailer_products`, etc.), delete dupes, then create index. Gate migration on zero duplicates.

## References
- `packages/db/drizzle/0008_retailer_domain_dedup.sql`
EOF
)"

create_issue \
  "[Phase 4] finalizeWaitingOnboardings bypasses org plan competitor limits" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`finalizeWaitingOnboardings()` inserts `org_competitors` for all queued/discovering rows with matching `normalized_domain` without checking each org's plan `maxCompetitors`.

Primary onboarding path checks limits; waiting orgs do not.

## Why it matters
B2B billing/plan enforcement breaks under shared-discovery model. At thousands of retailers, drive-by orgs can exceed entitlements for free.

## Severity
**High**

## Likelihood
**Occasional** — multi-tenant same-domain onboarding.

## Impact
Revenue leakage; support disputes; unbounded competitor tracking.

## Recommended fix
Per waiting org: check plan limit before `org_competitors` insert; mark onboarding failed with upgrade message if over cap.

## References
- `apps/worker/src/consumers/discover-config.ts` (`finalizeWaitingOnboardings`)
EOF
)"

create_issue \
  "[Phase 4] Waiting org onboardings not failed when primary discovery fails" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Cross-org dedup creates `queued` onboarding rows for org B while org A discovers. If org A's job fails (`markFailed`), waiting rows remain `queued` indefinitely. `processAddStoreByUrl` returns `{ pending: true }` without enqueueing work.

No mechanism propagates failure to sibling onboardings sharing `normalized_domain`.

## Why it matters
IMPLEMENTATION-ORDER 4.1 success criterion ("instant access") fails on the failure path. Ops burden grows with queue of stuck cards.

## Severity
**High**

## Likelihood
**Common** for hard sites (bot walls) where first discovery fails.

## Impact
Permanent stuck UI state; silent org B never notified; support tickets.

## Recommended fix
On `markFailed`, fail or re-queue all onboardings with same `normalized_domain`. Optionally allow org B to become primary discoverer.

## References
- `apps/worker/src/consumers/discover-config.ts` (`markFailed`, `finalizeWaitingOnboardings`)
- `apps/dashboard/.../actions.ts` (waiting org flow)
EOF
)"

# ── Category B: Should Fix Soon ──

create_issue \
  "[Phase 4] crawl-health repair gated to API mode only — listing_pages not repairable" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`crawl-health.ts` enqueues `discoverRepair` only when `isApiRepairable` (discoveryMode === `api`). Phase 4 adds `listing_pages` adapter but no repair/health path for extraction failures, pagination breaks, or empty listing crawls.

## Why it matters
FAILURE-RECOVERY.md escalation ladder assumes health-driven repair for degraded crawls. New discovery mode lacks operational recovery at scale.

## Severity
**High**

## Likelihood
**Common** for listing_pages retailers (weak HTML extraction).

## Impact
Zero-yield crawls persist; manual ops; false Phase 4 success for listing_pages mode.

## Recommended fix
Extend repair triggers and strategies for `listing_pages` / `jina_categories` (re-seed listing URLs, switch fetchStrategy, re-run category discovery).

## References
- `apps/worker/src/consumers/crawl-health.ts` (`isApiRepairable`)
- `packages/crawler/src/adapters/listing-pages-adapter.ts`
EOF
)"

create_issue \
  "[Phase 4] RediscoverJob queue/consumer not implemented — recovery ladder incomplete" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
FAILURE-RECOVERY.md and BULLMQ-JOBS.md define `RediscoverJob` / `store-rediscover` for health_score < 0.4 (3 consecutive) and failed repairs. No consumer or enqueue path exists in `apps/worker`.

## Why it matters
At thousands of retailers, without automated rediscovery the system accumulates permanently unhealthy configs. Phase 4 worker split assumes discovery pool handles repair/rediscovery workloads.

## Severity
**High**

## Likelihood
**Common** over months as configs rot.

## Impact
Manual re-onboarding; growing unhealthy long tail; repair dead-end.

## Recommended fix
Implement `RediscoverJob` consumer on discovery pool; enqueue from crawl-health after consecutive low scores; wire to orchestrator/discover-config with existing retailer id.

## References
- `docs/discovery/FAILURE-RECOVERY.md`
- `docs/discovery/BULLMQ-JOBS.md`
EOF
)"

create_issue \
  "[Phase 4] GraphQL platform packs (Hydrogen/Commercetools) not replayable beyond page 1" \
  "discovery,phase-4-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Hydrogen and Commercetools packs build `ApiRecipe` with static `requestBody` and pagination styles (`cursor` / `offset`) that are not wired into runtime GraphQL variable mutation. Commercetools uses `style: offset` on a GraphQL POST body — incompatible with `buildApiPageUrl` query-param logic.

## Why it matters
WORKFLOW.md Stage 3 requires validated pagination. Large catalogs truncate at first page (~20–24 SKUs) → systematic under-coverage at scale.

## Severity
**High**

## Likelihood
**Common** on Hydrogen/Commercetools retailers with >24 products.

## Impact
False healthy crawls with tiny catalog; bad competitive intelligence; health coverage ratio drift.

## Recommended fix
Implement GraphQL pagination in `api-recipe.ts` (cursor variable injection in JSON body); validate page 2 in `validateApiRecipe`; align Commercetools with cursor/`offset` args in GraphQL variables.

## References
- `packages/crawler/src/discover/platform-packs/shopify-hydrogen.ts`
- `packages/crawler/src/discover/platform-packs/commercetools.ts`
- `packages/crawler/src/discover/detect-pagination.ts`
EOF
)"

create_issue \
  "[Phase 4] runPlatformPack treats fetchJson null/non-null as HTTP 200/404" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`runPlatformPack` sets `status = responseBody != null ? 200 : 404`. `createApiFetchJson` returns `null` for non-2xx **and** JSON parse failures. Probes cannot distinguish auth errors, rate limits, or GraphQL `{ errors: [...] }` bodies with 200.

## Why it matters
False negatives (skip valid pack) and false positives (successCheck passes on error JSON shapes) undermine Phase 4 platform pack ROI.

## Severity
**Medium**

## Likelihood
**Common** on protected storefront APIs.

## Impact
Wrong discovery path selection; wasted network sniff / AI tokens; missed deterministic onboarding.

## Recommended fix
Return `{ status, body }` from fetchJson; treat GraphQL errors; pass real HTTP status from browser/static fetch.

## References
- `packages/crawler/src/discover/platform-packs/index.ts`
- `apps/worker/src/api-fetch.ts`
EOF
)"

create_issue \
  "[Phase 4] Domain normalization ignores mobile/regional subdomains" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`normalizeRetailerDomain()` strips `www.` only. `m.example.com`, `shop.example.com`, and `example.com` produce different domains/keys → duplicate retailers and duplicate discovery (opposite of Phase 4.1 goal).

## Why it matters
Many large retailers use mobile subdomains or shop. subdomains for the same catalog. At scale, duplicate rows multiply crawl cost and fragment org links.

## Severity
**Medium**

## Likelihood
**Occasional** — common among enterprise retailers.

## Impact
Duplicate discovery/crawl; split product catalog; dedup failure.

## Recommended fix
Document limitation or add configurable apex-domain mapping (e.g. store `canonical_domain`); optional DNS/homepage redirect following to apex.

## References
- `packages/crawler/src/domain.ts`
- `docs/discovery/ARCHITECTURE.md` (shared retailer model)
EOF
)"

create_issue \
  "[Phase 4] listing_pages adapter uses html.length as duplicate-page detector" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`listing-pages-adapter.ts` uses `String(html.length)` as content hash for pagination stop. Distinct pages with equal byte length prematurely stop pagination; conversely different lengths on empty/error pages continue looping.

## Why it matters
Catalog coverage estimation fails; large retailers with uniform PLP templates lose tail pages (false negative) or over-crawl (false positive).

## Severity
**Medium**

## Likelihood
**Common** on templated ecommerce PLPs.

## Impact
Under-crawled catalogs; incorrect health scores; spurious pagination in repair.

## Recommended fix
Reuse content-hash approach from Jina adapter (`markdownContentHash`) applied to normalized product URL sets or main content extract.

## References
- `packages/crawler/src/adapters/listing-pages-adapter.ts`
- `packages/crawler/src/adapters/jina-adapter.ts`
EOF
)"

create_issue \
  "[Phase 4] listing_pages seeding falls back to homepage-only with weak extraction" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`discoverListingPageUrls()` falls back to `[homepage]` when no category links match. HTML extraction uses generic `<a href>` scraping without JSON-LD/product-card structure. No category breadth comparable to Jina path.

## Why it matters
IMPLEMENTATION-ORDER 4.3 success: "Agent manifest listing patterns work without Jina." Homepage-only yields partial catalog for large retailers.

## Severity
**Medium**

## Likelihood
**Common** when agent manifest lacks explicit collection URLs in homepage HTML.

## Impact
Low catalog coverage; missing categories; poor price field presence → repair triggers (if API) or silent degradation (listing mode).

## Recommended fix
Deep-link from agent manifest URLs; shallow BFS for listing patterns; validate listing page count before promotion; block promotion if < N listing URLs.

## References
- `packages/crawler/src/discover/listing-pages-db.ts`
- `packages/crawler/src/discover/listing-html.ts`
EOF
)"

create_issue \
  "[Phase 4] Commercetools pack maps centAmount without currency scaling" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Commercetools field map uses `prices[0].value.centAmount` directly as `price`. Pipeline expects major currency units (dollars). Prices off by 100×.

## Why it matters
Data quality / matching corruption for Commercetools retailers; false price signals in analytics.

## Severity
**Medium**

## Likelihood
**Common** when Commercetools pack validates.

## Impact
Wrong competitive pricing; customer trust loss.

## Recommended fix
Divide by 10^fractionDigits or use formatted price fields; add validation gate in `validateApiRecipe` for sane price ranges.

## References
- `packages/crawler/src/discover/platform-packs/commercetools.ts`
EOF
)"

create_issue \
  "[Phase 4] HAR export may persist GraphQL tokens in postData while headers redacted" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`buildHarFromCaptures` redacts sensitive headers but embeds full `requestBody` in HAR `postData.text`. GraphQL POST bodies and API keys in JSON bodies are stored in Vercel Blob (`storeNetworkHar`).

## Why it matters
Security/compliance at scale: thousands of HARs in Blob with session tokens. Conflicts with header-deps redaction intent.

## Severity
**Medium**

## Likelihood
**Occasional** — sites embedding tokens in POST bodies.

## Impact
Secret leakage in Blob; compliance violation; token replay if Blob ACL misconfigured.

## Recommended fix
Redact postData using same rules as headers; truncate/store hash only; optional opt-in full HAR for ops.

## References
- `packages/crawler/src/discover/har.ts`
- `packages/crawler/src/discover/header-deps.ts`
EOF
)"

create_issue \
  "[Phase 4] Network capture drops non-2xx responses — misses auth-gated catalog APIs" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`captureNetworkRequests` returns early when `status < 200 || status >= 300`. Many catalog APIs return 401/403 with JSON error bodies that indicate endpoint presence and auth requirements.

## Why it matters
TOOLS.md/WORKFLOW.md Stage 2 expects full request graph. False negatives push sites to AI inference or failure; header-refresh repair lacks capture evidence.

## Severity
**Medium**

## Likelihood
**Common** on authenticated storefront APIs.

## Impact
Failed discovery; missed endpoint classification; higher AI cost.

## Recommended fix
Capture 401/403 JSON responses with lower productLikeScore; classify as `auth_required` endpoint type in `retailer_endpoints`.

## References
- `apps/worker/src/network-capture.ts`
- `packages/crawler/src/discover/endpoints-db.ts`
EOF
)"

create_issue \
  "[Phase 4] Discovery pool scale-to-zero can stall discover-repair jobs" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Worker split places `discover-repair` on discovery pool only. SCALING.md suggests scaling discovery down overnight. Crawl-health runs on crawl pool and enqueues repair — if no discovery machines consume queue, repairs stall.

## Why it matters
Operational coupling: crawl degradation cannot self-heal without discovery fleet always-on.

## Severity
**Medium**

## Likelihood
**Occasional** with autoscaling/min_machines tuning.

## Impact
Growing repair queue lag; configs stay broken until manual intervention.

## Recommended fix
Min discovery machines > 0 when repair queue depth > 0; or allow repair on crawl pool with browser fetcher; queue depth alert.

## References
- `apps/worker/src/index.ts`
- `docs/discovery/SCALING.md`
EOF
)"

# ── Category C: Future Enhancement ──

create_issue \
  "[Phase 4] Add cross-retailer endpoint pattern library (Phase 5 prep)" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
IMPLEMENTATION-ORDER Priority 5 lists endpoint pattern library; SCALING.md describes skipping network sniff when URL shape is known. Phase 4 adds platform packs but no aggregated pattern DB across retailers.

## Why it matters
At 1000+ retailers, repeated network sniff cost dominates onboarding latency and token spend.

## Severity
**Medium** (future scale)

## Likelihood
**Common** at target scale.

## Impact
Linear discovery cost; slow onboarding bursts.

## Recommended fix
Aggregate `retailer_endpoints` into pattern views; promote patterns with >80% success rate; consult before network capture.

## References
- `docs/discovery/IMPLEMENTATION-ORDER.md` (Priority 5)
- `docs/discovery/SCALING.md`
EOF
)"

create_issue \
  "[Phase 4] Track platform pack validation success rates per platform" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
PLATFORM-PACKS.md specifies deprioritizing packs with <50% validation success. Phase 4 adds five packs with no telemetry or rolling success metrics.

## Why it matters
False-positive packs (e.g. generic GraphQL endpoints) waste validation time and may promote bad recipes at scale.

## Severity
**Medium**

## Likelihood
**Common** over aggregate onboarding volume.

## Impact
Increased failure rate; ops noise; wrong platform routing.

## Recommended fix
Log pack probe/validation outcomes to `discovery_runs`; aggregate per platform; gate pack execution on success rate.

## References
- `docs/discovery/PLATFORM-PACKS.md`
- `packages/crawler/src/discover/platform-packs/index.ts`
EOF
)"

create_issue \
  "[Phase 4] HAR Blob artifacts lack lifecycle/retention policy" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Each network sniff uploads HAR to Vercel Blob at `discovery/{retailerKey}/{timestamp}/network.har` with no TTL or compaction. SCALING.md mentions 90-day lifecycle — not implemented.

## Why it matters
Storage cost grows linearly with rediscoveries × retailers; compliance retention unclear.

## Severity
**Medium**

## Likelihood
**Common** at 1000+ retailers with periodic rediscovery.

## Impact
Blob cost growth; ops burden; PII surface area.

## Recommended fix
Blob lifecycle rules; store pointer + compressed summary in DB; delete HAR after successful promotion or 90 days.

## References
- `packages/crawler/src/discover/har.ts`
- `docs/discovery/SCALING.md`
EOF
)"

create_issue \
  "[Phase 4] Implement staggered crawl cron jitter for large retailer fleet" \
  "discovery,phase-4-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
SCALING.md documents per-retailer cron jitter to avoid thundering herd. Scheduler still uses flat `retailers.crawlSchedule` defaults.

## Why it matters
Phase 4 separates discovery/crawl pools but crawl pool still vulnerable to synchronized daily crawls at thousands of retailers.

## Severity
**Low** (until fleet size grows)

## Likelihood
**Common** at 500+ retailers on same default schedule.

## Impact
Redis/DB spikes; rate limits; elevated error rates during crawl windows.

## Recommended fix
Implement `cronForRetailer(key, baseHour)` in scheduler registration.

## References
- `docs/discovery/SCALING.md`
- `apps/worker/src/scheduler.ts`
EOF
)"

create_issue \
  "[Phase 4] Add discovery/crawl queue depth metrics and alerting" \
  "discovery,phase-4-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Phase 4 splits worker pools but provides no metrics for queue depth, discovery latency, browser pool utilization, or cross-org waiting onboarding count.

## Why it matters
SCALING.md target metrics (queue depth <50, onboarding <5 min) cannot be verified operationally.

## Severity
**Medium**

## Likelihood
**Common** during onboarding bursts.

## Impact
Blind scaling decisions; SLA misses discovered by customers not dashboards.

## Recommended fix
Export BullMQ queue stats on `/metrics`; structured logs with onboarding stage timings; dashboard ops view.

## References
- `docs/discovery/SCALING.md`
- `apps/worker/src/health.ts`
EOF
)"

echo "Phase 4 red-team issues created."
