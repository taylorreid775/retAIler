#!/usr/bin/env bash
# Creates GitHub issues from the Phase 1 red-team assessment.
# Requires: gh auth login
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
ensure_label "phase-1-redteam" "b60205" "Phase 1 red-team findings"
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

# ─── 1. Fingerprint confidence ───────────────────────────────────────────────

create_issue \
  "[Phase 1] Fingerprint scores are heuristic weights, not calibrated probabilities" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`detectPlatformSignals()` sums arbitrary weights (0.15–0.45) per platform and uses the max as `platformConfidence`. There is no normalization, second-place margin, or empirical calibration.

## Severity
**High**

## Impact
The 0.5 gate that triggers platform packs is essentially arbitrary. Weak single signals stay below threshold while two mediocre signals on the same platform can cross it without evidence those signals reliably indicate the platform.

## Recommended fix
Calibrate thresholds from labeled retailer data. Require minimum signal count and/or margin over runner-up platform (e.g. winner exceeds second place by ≥0.15). Track per-platform precision/recall and tune weights from outcomes.

## References
- `packages/crawler/src/fingerprint/signals.ts`
- `docs/discovery/TOOLS.md`
EOF
)"

create_issue \
  "[Phase 1] Salesforce fingerprint inflated by generic \"site\" substring in __NEXT_DATA__" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
This condition adds 0.15 Salesforce confidence when `__NEXT_DATA__` contains the substring `"site"`:
```ts
if (lower.includes('__next_data__') && (lower.includes('"site"') || lower.includes('props.site')))
```
The substring `"site"` appears in almost any Next.js `__NEXT_DATA__` blob.

## Severity
**High**

## Impact
Non-SFCC Next.js sites can accumulate Salesforce score and cross the 0.5 platform-pack threshold, triggering incorrect SFCC probes and delaying correct discovery paths.

## Recommended fix
Parse `__NEXT_DATA__` JSON and match specific SFCC keys (`props.pageProps.site`, `props.siteId`, known SFCC shapes). Remove bare `"site"` substring matching.

## References
- `packages/crawler/src/fingerprint/signals.ts`
EOF
)"

create_issue \
  "[Phase 1] Fingerprint agentUrls input miswired to sampleProductUrls" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`fingerprintSite()` accepts `agentUrls`, but `discover-config.ts` passes `discovery.crawlRecipe.sampleProductUrls` instead of agent manifest API URLs, bundle URLs, or llms.txt hints.

## Severity
**Medium**

## Impact
Fingerprinting ignores authoritative agent-manifest API URLs. Platform routing relies almost entirely on homepage HTML, which is often bot-stripped or incomplete.

## Recommended fix
Pass `agentManifest?.apiUrls`, sitemap URLs, and extracted script bundle URLs as separate fingerprint inputs.

## References
- `apps/worker/src/consumers/discover-config.ts`
- `packages/crawler/src/fingerprint/index.ts`
EOF
)"

create_issue \
  "[Phase 1] recommendedStrategy platform_pack set for platforms without packs" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Fingerprint sets `recommendedStrategy: platform_pack` for any platform with confidence ≥ 0.5, including BigCommerce, Magento, and WooCommerce — none of which have implemented packs.

## Severity
**Medium**

## Impact
Persisted fingerprints claim a strategy the system cannot execute. Future orchestration may route incorrectly based on stored strategy.

## Recommended fix
Set `recommendedStrategy: platform_pack` only when `PACKS[platform]` exists. Otherwise fall through to `network_sniff` or `sitemap`.

## References
- `packages/crawler/src/fingerprint/index.ts`
- `packages/crawler/src/discover/platform-packs/index.ts`
EOF
)"

# ─── 2. False positive platform ID ───────────────────────────────────────────

create_issue \
  "[Phase 1] /s/{segment}/ path treated as SFCC signal (false positive)" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
The regex `\/s\/[a-z0-9_-]+\/` in HTML adds 0.10 Salesforce confidence. Many non-SFCC sites use `/s/` for shares, sessions, subscriptions, or localized paths.

## Severity
**Medium**

## Impact
Increases false Salesforce classification, causing wasted SFCC probes and delayed fallback to Jina/network sniff.

## Recommended fix
Require co-occurrence with demandware markers, or match SFCC-specific shapes like `/s/{SiteId}/dw/shop/`.

## References
- `packages/crawler/src/fingerprint/signals.ts`
EOF
)"

create_issue \
  "[Phase 1] wp-content alone triggers WooCommerce fingerprint" \
  "discovery,phase-1-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
Any WordPress site matches WooCommerce fingerprinting via `wp-content` at weight 0.30 without WooCommerce-specific signals.

## Severity
**Low**

## Impact
Stored fingerprints wrong for generic WordPress sites; pollutes future analytics and pack prioritization when Woo pack is added.

## Recommended fix
Require `/wp-json/wc/store/` or WooCommerce block markers before assigning WooCommerce platform.

## References
- `packages/crawler/src/fingerprint/signals.ts`
EOF
)"

create_issue \
  "[Phase 1] Shopify CDN presence does not imply Shopify-owned catalog" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`cdn.shopify.com` can appear on hybrid stacks (Buy Button, checkout-only, embedded widgets) where the main catalog is custom/headless and `/products.json` is absent or partial.

## Severity
**Medium**

## Impact
Fingerprint triggers Shopify pack unnecessarily, or succeeds on a partial public JSON subset while the real catalog lives elsewhere.

## Recommended fix
Require probe success before confirming Shopify platform. Downgrade fingerprint to `unknown` if pack validation fails.

## References
- `packages/crawler/src/fingerprint/signals.ts`
- `packages/crawler/src/discover/platform-packs/shopify.ts`
EOF
)"

# ─── 3. Platform pack coverage ───────────────────────────────────────────────

create_issue \
  "[Phase 1] Platform pack coverage gap vs documented ~40% claim" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Only Shopify `products.json` and generic SFCC OCAPI `product_search` v21_10 are implemented. No packs for BigCommerce, Magento, WooCommerce, Hydrogen GraphQL, or SFCC APIM gateways (e.g. Sport Chek).

## Severity
**High**

## Impact
Expected token/latency savings are overstated. Most high-confidence fingerprints still fall through to Jina + LLM + network sniff. Flagship SFCC reference (Sport Chek) is not covered by the Salesforce pack.

## Recommended fix
Prioritize packs by measured onboarding volume. Add APIM gateway detection. Implement Hydrogen GraphQL probe before claiming Hydrogen support.

## References
- `docs/discovery/PLATFORM-PACKS.md`
- `packages/schema/src/recipes/sportchek-crawl-recipe.ts`
EOF
)"

create_issue \
  "[Phase 1] Shopify Hydrogen routed to products.json pack that will fail" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`shopify_hydrogen` uses `shopifyPlatformPack`, which only probes `/products.json`. Hydrogen storefronts typically use Storefront GraphQL exclusively.

## Severity
**High**

## Impact
Hydrogen retailers fingerprint as high-confidence Shopify, fail the pack, then take the expensive fallback path — worse than skipping straight to network sniff.

## Recommended fix
Separate Hydrogen pack with GraphQL probes (`/api/unstable/graphql.json`, Storefront token extraction). Do not route Hydrogen to `products.json`.

## References
- `packages/crawler/src/discover/platform-packs/index.ts`
- `docs/discovery/PLATFORM-PACKS.md`
EOF
)"

create_issue \
  "[Phase 1] Shopify collections.json probe succeeds but cannot build recipe" \
  "discovery,phase-1-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
Shopify pack's second probe can succeed on `collections.json`, but `buildRecipe()` only handles `products` arrays and returns `null` for collections responses.

## Severity
**Low**

## Impact
Wasted probe round-trip; incomplete implementation with no functional promotion harm.

## Recommended fix
Remove the probe or implement collection-based catalog iteration as documented fallback.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
EOF
)"

# ─── 4. Recipe validation ─────────────────────────────────────────────────────

create_issue \
  "[Phase 1] validateApiRecipe far below documented promotion rules" \
  "discovery,phase-1-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
WORKFLOW Stage 3 requires `confidence >= 0.7 AND estimatedCatalogSize >= 50 AND reliability >= 0.9`. Actual `validateApiRecipe()` only requires 2 samples with title + price from a single pass — no reliability testing, catalog size estimate, or pagination verification.

## Severity
**Critical**

## Impact
Under-validated recipes get persisted, versioned, and crawled. Onboarding appears successful while catalog crawl returns trivial or empty data.

## Recommended fix
Implement documented `ValidationReport`: 3 requests over 30s, pagination page-1 vs page-2 probe, `estimatedCatalogSize`, field completeness. Gate promotion on documented thresholds.

## References
- `packages/crawler/src/discover/validate-api-recipe.ts`
- `docs/discovery/WORKFLOW.md`
EOF
)"

create_issue \
  "[Phase 1] Platform pack validated with browser but crawled with plain fetch" \
  "discovery,phase-1-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
Platform pack validation in `discover-config.ts` uses Playwright `browserFetcher.fetchJson()`. Crawl-time API discovery in `discover.ts` uses global `fetch()` regardless of `fetchStrategy`.

## Severity
**Critical**

## Impact
Recipes validated under Playwright TLS/fingerprint/cookie context may fail at crawl time on bot-protected retailers — the exact sites handed off to the worker.

## Recommended fix
Validate with the same transport crawl will use. Set `fetchStrategy: browser` when validation required Playwright.

## References
- `apps/worker/src/consumers/discover-config.ts`
- `apps/worker/src/consumers/discover.ts`
EOF
)"

create_issue \
  "[Phase 1] validationReport never persisted on recipe version rows" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`writeRecipeVersion()` accepts `validationReport`, but no call site passes it. Version rows store recipes without audit evidence.

## Severity
**Medium**

## Impact
Rollback and repair cannot answer why a recipe was promoted. Health monitoring cannot distinguish probe luck from robust validation.

## Recommended fix
Pass full `ValidationReport` from validation into `writeRecipeVersion()` on every promotion path.

## References
- `packages/db/src/recipe-versions.ts`
- `apps/worker/src/consumers/discover-config.ts`
EOF
)"

create_issue \
  "[Phase 1] mergePlatformPackIntoDiscovery inflates confidence without validation quality" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`mergePlatformPackIntoDiscovery()` sets discovery confidence to 0.75–0.90 based on sample count, independent of fingerprint or validation quality.

## Severity
**Medium**

## Impact
`retailers.discovery_confidence` and version rows overstate certainty. Future health/repair thresholds (0.4–0.7 band) will misfire.

## Recommended fix
Derive confidence from `ValidationReport` composite score, not fixed merge constants.

## References
- `packages/crawler/src/discover/platform-packs/types.ts`
EOF
)"

# ─── 5. Shopify catalog completeness ─────────────────────────────────────────

create_issue \
  "[Phase 1] Shopify pack has no catalog completeness guarantee" \
  "discovery,phase-1-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
Success requires only `products.length > 0` on page 1. A store with 3 public JSON products and 10,000 gated SKUs passes validation.

## Severity
**Critical**

## Impact
Customers onboard successfully but monitor a trivial fraction of a competitor catalog. Assortment intelligence becomes systematically biased without error signal.

## Recommended fix
Estimate catalog size from pagination metadata or multi-page probe during validation. Fail promotion if below threshold unless user accepts partial catalog mode.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
- `docs/discovery/WORKFLOW.md`
EOF
)"

create_issue \
  "[Phase 1] Shopify products.json increasingly restricted/unavailable" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Shopify has been restricting public `products.json` access (password-protected stores, headless builds, selective publication channels, rate limits).

## Severity
**High**

## Impact
Pack works on older/simple stores but fails on modern Shopify, undermining zero-AI onboarding for new Shopify merchants.

## Recommended fix
Add Storefront GraphQL probe as primary path; treat `products.json` as secondary. Detect 401/403 and downgrade gracefully.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
- `docs/discovery/PLATFORM-PACKS.md`
EOF
)"

create_issue \
  "[Phase 1] Shopify field map uses variants[0] only (multi-variant loss)" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Field map uses `variants[0]` for SKU, price, and availability. Multi-variant products collapse to one variant.

## Severity
**Medium**

## Impact
Incomplete price coverage for variant-heavy apparel/footwear competitors — core Canadian retail use case.

## Recommended fix
Expand variant handling at ingest or map variant arrays. Validate sample products have expected variant structure.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
EOF
)"

create_issue \
  "[Phase 1] Shopify pack hardcodes currency CAD" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Shopify platform pack always sets `currency: 'CAD'`.

## Severity
**Medium**

## Impact
US/international Shopify stores get wrong currency on price observations, breaking comparison logic.

## Recommended fix
Detect currency from Shopify JSON or retailer country setting.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
EOF
)"

create_issue \
  "[Phase 1] Shopify pagination cap may truncate large catalogs silently" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`maxPages: 100` × `limit: 250` = 25,000 product ceiling. Large Shopify catalogs may be partially crawled with no health anomaly until Phase 2.1.

## Severity
**Medium**

## Impact
Large Shopify competitors partially crawled; competitive intelligence incomplete without warning.

## Recommended fix
Compare against Shopify total count if available. Emit validation warning when maxPages cap is hit during probe.

## References
- `packages/crawler/src/discover/platform-packs/shopify.ts`
- `packages/crawler/src/discover/api-recipe.ts`
EOF
)"

# ─── 6. Salesforce edge cases ────────────────────────────────────────────────

create_issue \
  "[Phase 1] Sport Chek APIM pattern not supported by Salesforce pack" \
  "discovery,phase-1-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
Reference recipe uses `apim.sportchek.ca` with 15+ custom headers. Salesforce pack probes `{origin}/s/{siteId}/dw/shop/v21_10/product_search`.

## Severity
**Critical**

## Impact
Sport Chek fingerprints as Salesforce, pack fails, falls back to network sniff + LLM — the slow path Phase 1 was meant to eliminate for SFCC.

## Recommended fix
Maintain hand-authored recipes for known APIM gateways. Detect APIM host patterns in fingerprint and skip generic OCAPI pack.

## References
- `packages/schema/src/recipes/sportchek-crawl-recipe.ts`
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
EOF
)"

create_issue \
  "[Phase 1] Salesforce pack hardcodes OCAPI version v21_10" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
SFCC sites run different OCAPI versions. Wrong version returns 404 or HTML errors.

## Severity
**High**

## Impact
Generic SFCC pack success rate likely low outside sites matching v21_10.

## Recommended fix
Probe version from HTML/network hints, or try an ordered list of common versions.

## References
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
EOF
)"

create_issue \
  "[Phase 1] Salesforce productsPath selection is fragile" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`productsPath` uses reference equality: `hits === getAtPath(response.body, 'hits') ? 'hits' : 'products'`. Nested paths like `data.products` get wrong `productsPath`.

## Severity
**High**

## Impact
Probe succeeds and validation maps products, but full crawl reads wrong JSON path and ingests zero products.

## Recommended fix
Return `{ array, path }` from `productHits()` and persist the exact dot-path.

## References
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
EOF
)"

create_issue \
  "[Phase 1] Salesforce pack pagination uses wrong start offset semantics" \
  "discovery,phase-1-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
`pageParam: 'start'` is offset-based but paginator increments `page` 1, 2, 3 and assigns to `start` — producing offsets 1, 2, 3 instead of 0, 24, 48. `totalPagesPath: 'count'` maps to results-in-page, not total pages.

## Severity
**Critical**

## Impact
SFCC recipes passing initial validation fail on page 2+, retrieving duplicates or empty pages. Catalog crawl collapses after appearing to work.

## Recommended fix
Implement offset pagination as `start = (page-1) * pageSize`. Parse SFCC total/count fields correctly. Add page-2 validation per WORKFLOW.

## References
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
- `packages/crawler/src/discover/api-recipe.ts`
EOF
)"

create_issue \
  "[Phase 1] Salesforce pack missing category dimension iteration" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Sport Chek recipe requires `group=MEN|WOMEN|…`. Generic SFCC pack uses empty `q=` only — many catalogs return empty or truncated results without category/group params.

## Severity
**High**

## Impact
Validation passes on small global search sample while full catalog requires category fan-out the recipe cannot perform.

## Recommended fix
Discover category params from homepage/nav or network capture. Include `categoryParam` in SFCC pack when detected.

## References
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
- `packages/schema/src/recipes/sportchek-crawl-recipe.ts`
EOF
)"

create_issue \
  "[Phase 1] extractSiteId() can produce false-positive SFCC site IDs" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Site ID extracted from generic `/s/{token}/` in HTML or `__NEXT_DATA__.props.site` may be locale, brand code, or unrelated string — not SFCC site ID.

## Severity
**Medium**

## Impact
Probes hit invalid URLs (404). Low damage due to validation gate, but adds noise and delays.

## Recommended fix
Validate site ID by requiring successful probe with product-like schema, not regex extraction alone.

## References
- `packages/crawler/src/discover/platform-packs/salesforce.ts`
EOF
)"

# ─── 7. Database migration ───────────────────────────────────────────────────

create_issue \
  "[Phase 1] Migration journal retroactively includes 0004 (environment drift risk)" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`0004_jina_listing_pages` was added to `_journal.json` during Phase 1 but may already exist or not exist inconsistently across environments. Drizzle snapshot for 0005 was not regenerated.

## Severity
**Medium**

## Impact
Journal/state drift between environments. Fresh vs existing deploys may diverge silently.

## Recommended fix
Verify migration state per environment before deploy. Generate proper Drizzle snapshot for 0005. Document manual reconciliation steps.

## References
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/drizzle/0005_discovery_schema.sql`
EOF
)"

create_issue \
  "[Phase 1] Migration IF NOT EXISTS masks partial or wrong schema" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
0005 uses `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` without verifying column types or constraints match expected schema.

## Severity
**Medium**

## Impact
Manually altered columns pass migration silently. Application expects specific types/defaults; DB may differ.

## Recommended fix
Add post-migration verification script asserting column types, constraints, and indexes.

## References
- `packages/db/drizzle/0005_discovery_schema.sql`
EOF
)"

create_issue \
  "[Phase 1] retailer_recipe_versions.created_by has no DB enum constraint" \
  "discovery,phase-1-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
`created_by text NOT NULL` accepts any string — no enum check at DB level.

## Severity
**Low**

## Impact
Application bugs could write garbage audit values; rollback tooling cannot filter reliably.

## Recommended fix
Add `CHECK (created_by IN ('discovery', 'repair', 'manual'))` or Postgres enum.

## References
- `packages/db/drizzle/0005_discovery_schema.sql`
- `packages/db/src/schema.ts`
EOF
)"

create_issue \
  "[Phase 1] Backfill script does not sync denormalized retailer columns" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`backfill-recipe-versions.ts` inserts version rows but does not populate `retailers.fingerprint`, `discovery_confidence`, or `crawl_health_score` for existing retailers.

## Severity
**Medium**

## Impact
Pre-existing retailers have v1 history but null fingerprint/confidence on parent row — inconsistent denormalization breaks queries filtering on those columns.

## Recommended fix
Backfill should copy `crawl_recipe.confidence` → `discovery_confidence`, set default health score, document null fingerprint for legacy rows.

## References
- `packages/db/src/backfill-recipe-versions.ts`
EOF
)"

# ─── 8. Recipe versioning ────────────────────────────────────────────────────

create_issue \
  "[Phase 1] Recipe promotion is not wrapped in a DB transaction" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`writeRecipeVersion()` inserts version row then separately updates `retailers`. Retailer insert/update and version write are not in one transaction.

## Severity
**High**

## Impact
Crash between steps yields retailer without version row, or version row without denormalized column updates.

## Recommended fix
Wrap retailer creation/update + version insert in a single DB transaction.

## References
- `packages/db/src/recipe-versions.ts`
- `apps/worker/src/consumers/discover-config.ts`
EOF
)"

create_issue \
  "[Phase 1] Recipe version allocation race (MAX+1 without locking)" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Version number computed via `MAX(version) + 1` without row locking or serializable isolation.

## Severity
**Medium**

## Impact
Concurrent promotions can collide on `(retailer_id, version)` unique constraint — one fails after retailer already exists.

## Recommended fix
Use serializable transaction, `SELECT … FOR UPDATE` on retailer row, or atomic insert with conflict retry.

## References
- `packages/db/src/recipe-versions.ts`
EOF
)"

create_issue \
  "[Phase 1] writeRecipeVersion does not update retailers.crawl_recipe" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Version helper updates fingerprint, discovery_confidence, crawl_health_score but not `retailers.crawl_recipe`. Callers must remember to update separately.

## Severity
**Medium**

## Impact
Future callers writing version history without paired crawl_recipe update create rollback confusion — live recipe diverges from latest version.

## Recommended fix
Include `crawlRecipe` in retailer update inside `writeRecipeVersion()`, or expose single `promoteRecipe()` API enforcing paired updates.

## References
- `packages/db/src/recipe-versions.ts`
EOF
)"

create_issue \
  "[Phase 1] writeRecipeVersion resets crawlHealthScore to 1.0 on every write" \
  "discovery,phase-1-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Every `writeRecipeVersion()` call sets `crawlHealthScore: 1`, including re-onboarding of unhealthy retailers.

## Severity
**High**

## Impact
Unhealthy retailer re-onboarded by second org has health forcibly reset — masking catalog degradation and bypassing Phase 2 repair triggers.

## Recommended fix
Only reset health on first version or explicit repair success. Preserve existing score on metadata-only version writes.

## References
- `packages/db/src/recipe-versions.ts`
EOF
)"

create_issue \
  "[Phase 1] Existing retailer re-onboarding may skip recipe versioning" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
For duplicate domain hits, version is written only when `recipeChanged` (API/Jina/platform pack). Linking org to existing sitemap-only retailer creates no version row.

## Severity
**Medium**

## Impact
Audit trail incomplete for org access grants. Violates "every new retailer has v1" criterion for shared-retailer scenarios.

## Recommended fix
Write access-grant audit event or ensure versioning policy covers all promotion paths.

## References
- `apps/worker/src/consumers/discover-config.ts`
EOF
)"

create_issue \
  "[Phase 1] No active_recipe_version pointer on retailers table" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Schema stores immutable versions but `retailers.crawl_recipe` is live config with no `active_recipe_version` column. Rollback requires manual SQL.

## Severity
**Medium**

## Impact
Ops rollback on `crawl_recipe` only can drift from version history. Dashboard/worker can write v2 while ops rolled back to v1 manually.

## Recommended fix
Add `active_recipe_version int` on `retailers`. Make promotion update both atomically.

## References
- `packages/db/src/schema.ts`
- `docs/discovery/DATABASE-SCHEMA.md`
EOF
)"

create_issue \
  "[Phase 1] Dashboard fast-path promotion skips platform packs" \
  "discovery,phase-1-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Static 12s `discoverSite()` promotion in dashboard `actions.ts` never runs fingerprint-driven platform packs — only the worker path does.

## Severity
**Medium**

## Impact
Shopify stores passing static sitemap discovery get sitemap crawl instead of API pack. Same platform gets inconsistent recipe quality depending on bot-wall timing.

## Recommended fix
Run platform pack attempt on dashboard path before promotion, or always hand off API-capable platforms to worker.

## References
- `apps/dashboard/src/app/(app)/competitors/actions.ts`
- `apps/worker/src/consumers/discover-config.ts`
EOF
)"

echo ""
echo "Done. Created Phase 1 red-team issues in $REPO"
gh issue list --repo "$REPO" --label phase-1-redteam --limit 50
