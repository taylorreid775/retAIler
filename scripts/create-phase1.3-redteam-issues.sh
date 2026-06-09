#!/usr/bin/env bash
# Creates GitHub issues from the Phase 1.3 orchestrator red-team assessment.
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
ensure_label "phase-1.3-redteam" "5319e7" "Phase 1.3 orchestrator red-team findings"
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
  "[Phase 1.3] Platform pack track uses weaker seed fingerprint than linear discovery" \
  "discovery,phase-1.3-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
`runParallelDiscoveryStages()` runs platform-pack probing on a **seed** `discoverSite()` call (`sampleLimit: 12`, `corpusLimit: 100`) and fingerprints that seed. `tryPlatformPackDiscovery()` gates on `fingerprint.platformConfidence >= 0.5` and `recommendedStrategy === 'platform_pack'`.

The full static track may collect richer `agentUrls` / manifest hints and would produce a **stronger** fingerprint, but the pack track never sees it.

## Severity
**Critical**

## Impact
With `DISCOVERY_ORCHESTRATOR=1`, platform packs can be **skipped entirely** on sites where the legacy linear path would have attempted and validated a pack. This is a functional regression relative to the flag-off path, not just a performance tweak.

## Recommended fix
Fingerprint once from shared homepage evidence, or run the pack gate using the **full static track fingerprint** after `Promise.all` resolves (re-attempt pack if seed skipped but static fingerprint qualifies). Better: extract a shared homepage fetch, fingerprint, then fan out parallel static + pack probes from the same signals.

## References
- `packages/crawler/src/discover/orchestrator.ts` (`platformPackTrack`, lines 117–129)
- `apps/worker/src/consumers/discover-config.ts` (`tryPlatformPackDiscovery`, lines 387–388)
EOF
)"

create_issue \
  "[Phase 1.3] Orchestrator can reject validated platform packs that linear path always promotes" \
  "discovery,phase-1.3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Legacy linear discovery: if `tryPlatformPackDiscovery()` validates a pack, the pack **always** replaces the discovery result.

Orchestrator path: `selectDiscoveryCandidate()` compares `validationReport.confidence` to `scoreStaticDiscovery(staticDiscovery)`. A strong sitemap path (e.g. confidence 0.85, boosted floor 0.6) can **beat** a validated API pack at 0.75–0.84.

## Severity
**High**

## Impact
Enabling the orchestrator can **reduce** API-based onboarding on Shopify/SFCC sites that previously got platform-pack recipes. Phase 1.3 intended to recover API paths on sitemap-success sites, but this selection rule can do the opposite on high-confidence sitemap stores.

## Recommended fix
Define explicit policy: validated platform packs at or above `PROMOTION_MIN_CONFIDENCE` (0.7) should win over sitemap-only paths unless static is also API-validated. Alternatively, only compare against static **API** candidates, not sitemap confidence. Add regression tests for “validated pack vs strong sitemap”.

## References
- `packages/crawler/src/discover/orchestrator.ts` (`selectDiscoveryCandidate`, `scoreStaticDiscovery`)
- `apps/worker/src/consumers/discover-config.ts` (linear path, no selection)
EOF
)"

create_issue \
  "[Phase 1.3] Promise.all fail-fast aborts discovery when seed track throws" \
  "discovery,phase-1.3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`runParallelDiscoveryStages()` uses `Promise.all([discoverSite(full), platformPackTrack()])`. If the seed-track `discoverSite()` or pack validation throws, the **entire** orchestration fails—even when the full static track already succeeded.

## Severity
**High**

## Impact
Transient seed-track errors (timeout, bot wall, malformed sitemap on reduced corpus) fail onboarding jobs that linear discovery would have completed via the full static path.

## Recommended fix
Use `Promise.allSettled`, treat seed-track failure as `used: false`, and always proceed with static results. Log seed failures separately; only fail the job if the full static track rejects.

## References
- `packages/crawler/src/discover/orchestrator.ts` (lines 132–135)
EOF
)"

create_issue \
  "[Phase 1.3] Parallel orchestrator doubles discovery fetch load against target site" \
  "discovery,phase-1.3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
The orchestrator runs **two** `discoverSite()` invocations per onboarding (full + seed), each walking robots.txt, sitemaps, and sample pages through the same browser-backed `fetchText` helper.

## Severity
**High**

## Impact
- ~2× HTTP/browser requests to the retailer during onboarding
- Higher bot-wall / rate-limit risk (Incapsula, Cloudflare)
- Wall-clock may improve for pack wins, but worst-case cost rises for every site—including non-platform stores with no pack benefit
- Contradicts Phase 1.3 success criterion “discovery time reduced” for the common non-API case

## Recommended fix
Share a single homepage + robots + manifest fetch, then parallelize only the divergent work (full corpus walk vs pack probe). Do not run two independent `discoverSite()` pipelines.

## References
- `packages/crawler/src/discover/orchestrator.ts` (`runParallelDiscoveryStages`)
- `docs/discovery/IMPLEMENTATION-ORDER.md` §1.3
EOF
)"

create_issue \
  "[Phase 1.3] Network sniff fallback still blocked for sitemap-success sites" \
  "discovery,phase-1.3-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Phase 1.3 only parallelizes platform pack + static analysis. Post-selection fallbacks are unchanged:

```ts
const needsApiSniff =
  !platformPackUsed && !jinaResult && (discovery.confidence <= 0 || !discovery.productUrlPattern);
```

`AGENT-ARCHITECTURE.md` specifies network capture when **no valid candidate** exists (confidence ≥ 0.7), not merely when sitemap discovery fails outright.

## Severity
**High**

## Impact
Sites with mediocre sitemap coverage (confidence > 0, pattern present) still never reach network sniff—even with the orchestrator enabled. Custom React / SFCC APIM retailers remain stuck unless platform pack wins outright.

## Recommended fix
Implement `hasValidCandidate()` using promotion thresholds (`PROMOTION_MIN_CONFIDENCE`, catalog size, reliability). Trigger network sniff when parallel stages produce no candidate meeting those thresholds, even if a weak sitemap exists.

## References
- `apps/worker/src/consumers/discover-config.ts` (lines 176–178)
- `docs/discovery/AGENT-ARCHITECTURE.md` (Refactor Target pseudocode)
EOF
)"

create_issue \
  "[Phase 1.3] Validated platform-pack report discarded when static path wins selection" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
When `selectDiscoveryCandidate()` chooses static over platform pack, it sets `apiValidationReport: null` even if the pack track produced a validated `ValidationReport`.

## Severity
**Medium**

## Impact
- `writeRecipeVersion()` loses validation evidence for rejected API candidates
- No audit trail for “we validated an API but chose sitemap” decisions
- Harder to debug wrong selections or build repair/rediscovery logic later

## Recommended fix
Return both candidates and their reports in `OrchestratorResult`. Persist the rejected pack validation report in onboarding notes, `retailer_recipe_versions.validation_report`, or a future `discovery_runs` artifact.

## References
- `packages/crawler/src/discover/orchestrator.ts` (`selectDiscoveryCandidate`, lines 99–105)
- `apps/worker/src/consumers/discover-config.ts` (`writeRecipeVersion`)
EOF
)"

create_issue \
  "[Phase 1.3] Platform-pack winner merges incomplete static metadata" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
When platform pack wins, `selectDiscoveryCandidate()` copies key/name/domain/sitemaps/llmsTxt from static discovery but **not** `agentFiles`, `crawlDelayMs`, or richer `sampleProductUrls` from the full static run.

The pack discovery object is built from the **seed** track, which may have thinner evidence.

## Severity
**Medium**

## Impact
Promoted retailers may miss agent manifest URLs, crawl delay hints, or representative product samples gathered by the full static track— degrading crawl configuration and dashboard display vs static-only onboarding.

## Recommended fix
When pack wins, merge all non-recipe static fields from `staticDiscovery` into the selected result (agentFiles, crawlDelayMs, sampleProductUrls, notes), keeping only the API recipe block from the pack.

## References
- `packages/crawler/src/discover/orchestrator.ts` (lines 64–79)
EOF
)"

create_issue \
  "[Phase 1.3] Persisted fingerprint always from static track, not pack track" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`runParallelDiscoveryStages()` always fingerprints using the **full static** `discoverSite()` result before selection. When platform pack wins via the seed track (potentially different `agentUrls` / HTML completeness), the stored `retailers.fingerprint` may not reflect the evidence that triggered the pack.

## Severity
**Medium**

## Impact
Downstream repair, platform-pack routing, and knowledge docs may reference a fingerprint inconsistent with the promoted API recipe—especially when seed and static fingerprints diverge (see seed fingerprint gating issue).

## Recommended fix
When platform pack wins, persist fingerprint from the pack track (or merge signals from both tracks). Include `orchestratorNotes` in stored discovery metadata.

## References
- `packages/crawler/src/discover/orchestrator.ts` (lines 137–144)
- `packages/db/src/schema.ts` (`retailers.fingerprint`)
EOF
)"

create_issue \
  "[Phase 1.3] scoreStaticDiscovery 0.6 sitemap floor is arbitrary and uncalibrated" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`scoreStaticDiscovery()` applies a hard-coded `Math.max(confidence, 0.6)` whenever sitemap URLs and a product pattern exist. This constant is not tied to `PROMOTION_MIN_CONFIDENCE`, validation reliability, or empirical outcomes.

## Severity
**Medium**

## Impact
Selection outcomes swing on an arbitrary floor—blocking API wins in the 0.60–0.69 range and overweighting weak sitemap evidence against validated API candidates.

## Recommended fix
Reuse promotion thresholds from `validate-api-recipe.ts` or calibrate selection weights from labeled retailer outcomes. Document the selection policy in `AGENT-ARCHITECTURE.md`.

## References
- `packages/crawler/src/discover/orchestrator.ts` (`scoreStaticDiscovery`)
- `packages/crawler/src/discover/validate-api-recipe.ts` (`PROMOTION_MIN_CONFIDENCE`)
EOF
)"

create_issue \
  "[Phase 1.3] Shared BrowserFetcher singleton under parallel discoverSite calls" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Two concurrent `discoverSite()` calls share one module-level `BrowserFetcher` instance (`fetcherFor('browser')`) with a **single** Playwright browser context. Parallel discovery opens multiple pages and API requests on that context simultaneously.

## Severity
**Medium**

## Impact
Potential cookie/session cross-talk, Cloudflare clearance races, and non-deterministic fetch ordering under load—especially on bot-protected retailers where onboarding already uses browser fallback.

## Recommended fix
Serialize browser fetches behind a queue/mutex for discovery, use isolated contexts per parallel track, or eliminate duplicate `discoverSite()` calls via shared seed fetch.

## References
- `apps/worker/src/fetchers.ts` (singleton `BrowserFetcher`)
- `apps/worker/src/browser-fetcher.ts`
- `packages/crawler/src/discover/orchestrator.ts`
EOF
)"

create_issue \
  "[Phase 1.3] No integration tests for runParallelDiscoveryStages" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`orchestrator.test.ts` covers only pure selection/scoring helpers. There are no tests for `runParallelDiscoveryStages()` with mocked `discoverSite` / `tryPlatformPack` deps, and no worker integration test behind the feature flag.

## Severity
**Medium**

## Impact
Regressions in parallel wiring, fail-fast behavior, and fingerprint gating will not be caught in CI. `WORKER-PLAN.md` explicitly lists orchestrator integration tests as a success criterion.

## Recommended fix
Add dependency-injected tests for `runParallelDiscoveryStages()` (mock parallel tracks, assert selection + error handling). Add a worker-level fixture test with `DISCOVERY_ORCHESTRATOR=1`.

## References
- `packages/crawler/src/discover/orchestrator.test.ts`
- `docs/discovery/WORKER-PLAN.md` (Testing table)
EOF
)"

create_issue \
  "[Phase 1.3] Feature flag defaults off with no rollout or observability" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`DISCOVERY_ORCHESTRATOR` defaults to `"0"` in `.env.example` and production. The orchestrator path is opt-in with no metrics, shadow mode, or comparison logging against the linear path.

## Severity
**Medium**

## Impact
Phase 1.3 ships dead code in production until manually enabled. Selection regressions (seed fingerprint, pack rejection) may go unnoticed. No data to validate the “same or better success rate” success criterion.

## Recommended fix
Add shadow mode: run orchestrator selection logging without switching paths, or enable by default in staging with structured logs (`selected`, `staticScore`, `packConfidence`, timings). Track onboarding outcomes by path.

## References
- `.env.example` (`DISCOVERY_ORCHESTRATOR="0"`)
- `apps/worker/src/consumers/discover-config.ts` (line 93)
EOF
)"

create_issue \
  "[Phase 1.3] Worker orchestrator does not fix dashboard fast-path split (see #36)" \
  "discovery,phase-1.3-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Orchestrator runs only in `discover-config` when `DISCOVERY_ORCHESTRATOR=1`. The dashboard `processAddStoreByUrl()` still runs capped instant `discoverSite()` and promotes sitemap successes without platform packs or orchestrator selection.

## Severity
**Medium**

## Impact
Two onboarding paths remain divergent: dashboard fast-path vs worker orchestrator. Users who get instant promotion never benefit from parallel pack selection; users handed off to the worker may get different recipes for the same retailer class.

## Recommended fix
Extract shared `runDiscoveryPipeline()` used by dashboard handoff and worker. Related: #36.

## References
- `apps/dashboard/src/app/(app)/competitors/actions.ts`
- `apps/worker/src/consumers/discover-config.ts`
- Issue #36
EOF
)"

create_issue \
  "[Phase 1.3] Orchestrator selection not persisted in onboarding result" \
  "discovery,phase-1.3-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
`OrchestratorResult` includes `notes`, `staticDiscovery`, and `platformPackResult`, but `discover-config` only logs `orch.notes` and persists `toDiscoveryView(discovery)` without selection scores or rejected candidate summaries.

## Severity
**Low**

## Impact
Operators cannot inspect why platform pack vs static was chosen from the dashboard onboarding record. Debugging selection bugs requires log diving.

## Recommended fix
Attach orchestrator metadata to `store_onboarding.result` (selected path, staticScore, packConfidence, seed vs full timings) when flag enabled.

## References
- `apps/worker/src/consumers/discover-config.ts` (lines 109–113, 367–368)
- `packages/crawler/src/discover/orchestrator.ts` (`OrchestratorResult`)
EOF
)"

create_issue \
  "[Phase 1.3] Tie-breaker always prefers platform pack on equal confidence scores" \
  "discovery,phase-1.3-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
`selectDiscoveryCandidate()` uses `packConfidence >= staticScore`. When scores tie (e.g. both 0.72), platform pack wins even though sitemap paths may have lower operational risk and simpler crawl behavior.

## Severity
**Low**

## Impact
Borderline ties flip retailers to API discovery mode without strong evidence of superiority—minor catalog drift or extra API dependency.

## Recommended fix
On tie, prefer sitemap unless pack confidence **strictly exceeds** static score, or require pack margin ≥ ε (e.g. 0.05) to switch modes.

## References
- `packages/crawler/src/discover/orchestrator.ts` (line 63)
EOF
)"

echo "Done. Created Phase 1.3 red-team issues."
