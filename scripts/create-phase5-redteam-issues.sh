#!/usr/bin/env bash
# Creates GitHub issues from the Phase 5 polish red-team assessment.
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

# ── Category A: Must Fix Before Phase 6 ──

create_issue \
  "[Phase 5] Ops rollback UI has no authorization — any tenant can mutate global retailers" \
  "discovery,phase-5-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
`/status` exposes recipe version list + rollback when `ENABLE_OPS_UI=true`. `listRecipeVersions()` and `rollbackToRecipeVersion()` only check the env flag — not Clerk admin role, not org membership, not retailer scope.

Any authenticated dashboard user can rollback **shared** `retailers` rows that affect all orgs monitoring that domain.

## Why it matters
RetAIler uses a shared-retailer B2B model (Phase 4 dedup). A single mistaken rollback by one customer org corrupts crawl config for every org tracking that competitor. FAILURE-RECOVERY.md assumes ops-only manual rollback.

## Severity
**Critical**

## Likelihood
**Occasional** once ops UI is enabled in production — one misclick or curious user.

## Impact
Global catalog corruption; cross-tenant data integrity breach; incorrect pricing intelligence for all customers on that retailer.

## Recommended fix
Gate on internal admin role (Clerk org metadata or allowlist). Scope rollback to retailers the org tracks **only if** rollback should be tenant-scoped (probably not — use internal admin only). Audit log with actor user id.

## References
- `apps/dashboard/src/app/(app)/status/recipe-actions.ts`
- `apps/dashboard/src/lib/ops-flags.ts`
- `docs/discovery/FAILURE-RECOVERY.md` (Rollback)
EOF
)"

create_issue \
  "[Phase 5] Rediscovery always writes new recipe version without comparing to active config" \
  "discovery,phase-5-redteam,severity:critical" \
  "$(cat <<'EOF'
## Problem
In `discover-config.ts`, `recipeChanged` includes `|| isRediscover`, forcing promotion/version write on every rediscover completion that passes validation gates — even when the new config has **lower confidence** or fewer validated products than the current active recipe.

There is no diff gate, no "only promote if improvement" check, and no automatic rollback on regression.

## Why it matters
Weekly scheduler + 3× low-health escalation can automatically replace a partially-working API recipe with a worse sitemap/Jina fallback, permanently degrading catalog coverage for a shared retailer.

## Severity
**Critical**

## Likelihood
**Common** at scale — rediscovery triggers are automated and retailers change layouts frequently.

## Impact
Silent catalog regression; false recovery; increased repair/rediscover loops; customer-visible stale/wrong product counts.

## Recommended fix
Before promotion on rediscover: compare validation report confidence, estimated catalog size, and health baseline against current version. Only write new version if strictly better; otherwise log `discovery_runs` failure and enqueue repair instead.

## References
- `apps/worker/src/consumers/discover-config.ts` (`recipeChanged`, rediscover branch)
- `docs/discovery/FAILURE-RECOVERY.md`
EOF
)"

create_issue \
  "[Phase 5] preserveEndpoints flag is never consumed during rediscovery" \
  "discovery,phase-5-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`RediscoverJob` and `DiscoverConfigJob.rediscover` carry `preserveEndpoints: true` (BULLMQ-JOBS.md, FAILURE-RECOVERY.md), but `discover-config.ts` never reads it. Rediscovery does not seed platform packs or skip network sniff from `retailer_endpoints` / knowledge docs.

## Why it matters
Documented rediscovery path is supposed to reuse validated endpoints and latest HAR before full browser capture. Without it, every rediscover repeats expensive Playwright sniff + AI inference — and may rediscover **different** endpoints than the ones repair `endpoint_swap` relies on.

## Severity
**High**

## Likelihood
**Common** for every automated rediscovery at scale.

## Impact
Higher cost/latency; endpoint registry drift; repair strategies invalidated; false negatives on sites where original capture context is required for replay.

## Recommended fix
When `preserveEndpoints` is true: load `retailer_endpoints` + latest knowledge docs + Blob HAR; validate stored endpoints before network capture; pass alternates into repair/rediscover orchestration.

## References
- `apps/worker/src/consumers/discover-config.ts`
- `docs/discovery/FAILURE-RECOVERY.md` (Rediscovery Reads Before Acting)
- `packages/schema/src/jobs.ts`
EOF
)"

create_issue \
  "[Phase 5] Rediscovery path skips knowledge doc reader" \
  "discovery,phase-5-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`discover-repair.ts` calls `readKnowledgeDocs()` before repair. Rediscovery via `discover-config.ts` does **not** invoke the knowledge reader, despite FAILURE-RECOVERY.md and KNOWLEDGE-STORAGE.md requiring known-issues / endpoint-analysis reads before rediscovery.

## Why it matters
Known hard blocks, prior pagination breaks, and documented endpoint alternates are ignored — rediscovery repeats failed strategies and may promote configs that human/agent docs already marked bad.

## Severity
**High**

## Likelihood
**Occasional** per retailer with prior repair/rediscovery history.

## Impact
Rediscovery loops; wasted tokens/browser time; repeated false positives on blocked retailers.

## Recommended fix
Call `readKnowledgeDocs(retailerKey)` at start of rediscover branch; honor `known-issues.md` early exit; seed endpoint-analysis into validation.

## References
- `apps/worker/src/consumers/discover-repair.ts`
- `apps/worker/src/consumers/discover-config.ts`
- `docs/discovery/KNOWLEDGE-STORAGE.md`
EOF
)"

create_issue \
  "[Phase 5] Rollback does not sync retailer_endpoints or listing pages" \
  "discovery,phase-5-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
`rollbackRecipeVersion()` restores `retailers.crawlRecipe` via `writeRecipeVersion()` but does not update `retailer_endpoints`, `retailer_listing_pages`, or invalidate stale HAR references.

Repair `endpoint_swap` and pattern library aggregate from `retailer_endpoints` — which may still describe the **post-rollback-wrong** endpoint set.

## Why it matters
Ops rollback appears successful in UI while repair logic and endpoint registry continue targeting endpoints from the failed version.

## Severity
**High**

## Likelihood
**Occasional** whenever ops rolls back an API recipe change.

## Impact
Repair misfires; pattern library learns wrong shapes; crawl continues using mismatched endpoint metadata.

## Recommended fix
On rollback: upsert endpoints from rolled-back recipe API block; deactivate endpoints not present in target version; refresh listing pages for jina/listing modes inside same transaction.

## References
- `packages/db/src/rollback-recipe.ts`
- `packages/crawler/src/discover/endpoints-db.ts`
- `docs/discovery/FAILURE-RECOVERY.md`
EOF
)"

# ── Category B: Should Fix Soon ──

create_issue \
  "[Phase 5] Endpoint pattern library only logs hits — does not skip network sniff" \
  "discovery,phase-5-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
IMPLEMENTATION-ORDER Priority 5 and SCALING.md describe skipping network sniff when URL shape is known. Phase 5 loads patterns and logs `endpoint pattern library hit`, then always calls `tryNetworkApiDiscovery()` anyway.

`matchEndpointPattern()` is exported but unused in the worker path.

## Why it matters
At 1000+ retailers, repeated Playwright capture dominates onboarding latency and Blob cost. The deliverable is marked complete but behavior is telemetry-only.

## Severity
**High**

## Likelihood
**Common** for non-platform-pack API retailers once registry has ≥3 samples per platform.

## Impact
Linear discovery cost; unnecessary HAR storage; slower onboarding bursts.

## Recommended fix
On pattern hit: construct probe URL, run `validateApiRecipe()` deterministically; skip `captureNetworkRequests()` when validation passes. Fall through to sniff only on validation failure.

## References
- `apps/worker/src/consumers/discover-config.ts`
- `packages/crawler/src/discover/endpoint-patterns.ts`
- `docs/discovery/SCALING.md`
EOF
)"

create_issue \
  "[Phase 5] loadEndpointPatterns() full-table scan on every sniff candidate" \
  "discovery,phase-5-redteam,severity:high" \
  "$(cat <<'EOF'
## Problem
Each discovery job needing API sniff joins all active `retailer_endpoints` to `retailers`, aggregates patterns in memory, with no caching or materialized view.

## Why it matters
SCALING.md targets 1000+ retailers with 4–8 parallel discoveries. O(endpoints) work per sniff multiplies queue latency and Neon read load.

## Severity
**High**

## Likelihood
**Common** at target scale.

## Impact
Discovery worker CPU/DB saturation; p95 onboard time growth; Neon read replica pressure on dashboard + worker combined.

## Recommended fix
Materialized `endpoint_patterns` table refreshed nightly or on endpoint upsert; in-memory cache with TTL in worker; platform-scoped query instead of full join.

## References
- `packages/crawler/src/discover/endpoint-patterns.ts`
- `docs/discovery/SCALING.md`
EOF
)"

create_issue \
  "[Phase 5] discovery_runs has no retention or purge policy" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
SCALING.md specifies `discovery_runs` retain 90 days then aggregate/purge. Phase 5 adds the table and unbounded `stages_completed` jsonb append per run with no archival job.

## Why it matters
Each run stores stage checkpoints and optional HAR artifact URLs. At thousands of retailers × rediscoveries, Neon storage and dashboard poll queries grow without bound.

## Severity
**Medium**

## Likelihood
**Common** over 6–12 months at scale.

## Impact
DB bloat; slower `getOnboardingStatuses()` joins; higher Neon cost.

## Recommended fix
Weekly purge job for rows older than 90 days; aggregate cost/token stats to rollup table before delete; cap `stages_completed` array length.

## References
- `packages/db/drizzle/0009_discovery_runs.sql`
- `docs/discovery/SCALING.md`
EOF
)"

create_issue \
  "[Phase 5] Discovery cost tracking is incomplete and has no runtime alerts" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Token usage is captured only from `inferApiRecipeFromCaptures` and `discoverCategoryDirectory` — not platform-pack validation AI, pagination re-probes, or repair rediscovery paths. Cost uses flat `$0.15/1M` estimate, not AI Gateway billing.

COST-OPTIMIZATION.md rule #10 requires alerting when single discovery exceeds $0.10 — dashboard only **counts** over-budget runs historically; no worker alert or log escalation.

## Why it matters
Ops cost dashboard will under-report spend and miss budget violations until after the fact.

## Severity
**Medium**

## Likelihood
**Occasional** for network-sniff + Jina category paths.

## Impact
Surprise AI bills; false confidence in cost dashboard; no paging on runaway rediscovery loops.

## Recommended fix
Centralize AI usage accounting in `@retailer/core`; persist gateway usage when available; emit structured warning/log when run cost exceeds threshold at `completeDiscoveryRun()`.

## References
- `packages/db/src/discovery-runs.ts`
- `packages/analytics/src/discovery-cost.ts`
- `docs/discovery/COST-OPTIMIZATION.md`
EOF
)"

create_issue \
  "[Phase 5] Repair and rediscover can enqueue concurrently without coordination" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`crawl-health.ts` enqueues repair for scores 0.4–0.7 **and** rediscover when last 3 scores < 0.4 on the same crawl completion path (3rd low score still triggers repair band if API-repairable).

Separately, `discover-repair` exhaustion enqueues rediscover while weekly scheduler may also enqueue — same BullMQ `jobId` dedupes but drops needed work silently.

## Why it matters
Concurrent discover-config jobs for the same retailer (repair hint vs rediscover) can race on `writeRecipeVersion()` and browser pool, producing non-deterministic active config.

## Severity
**Medium**

## Likelihood
**Occasional** during health degradation windows.

## Impact
Version history thrash; flaky recipes; difficult ops debugging.

## Recommended fix
Single-flight lock per retailer key across repair/rediscover/discover-config; suppress repair enqueue when rediscover pending; use job dependencies in BullMQ.

## References
- `apps/worker/src/consumers/crawl-health.ts`
- `apps/worker/src/consumers/discover-repair.ts`
- `apps/worker/src/rediscovery-schedule.ts`
EOF
)"

create_issue \
  "[Phase 5] Weekly rediscovery lacks blocked-retailer and in-flight guards" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
`findRediscoveryCandidates()` selects all enabled retailers with `crawl_health_score < 0.5` and 7-day cooldown. No check for: hard-blocked domains (Incapsula), in-flight discover-config job, or retailers already queued for rediscover.

## Why it matters
FAILURE-RECOVERY.md says do not waste cycles on known blocks. Sunday fan-out can enqueue hundreds of doomed browser jobs.

## Severity
**Medium**

## Likelihood
**Common** once unhealthy retailer count grows.

## Impact
Wasted Fly compute; queue depth spikes; false `lastRediscoveryAt` updates if jobs no-op after skip.

## Recommended fix
Exclude blocked retailers; skip if discover-config/rediscover job active; require sustained low health (e.g. 7-day avg), not point-in-time score only.

## References
- `apps/worker/src/rediscovery-schedule.ts`
- `docs/discovery/FAILURE-RECOVERY.md` (Blocked Retailer Handling)
EOF
)"

create_issue \
  "[Phase 5] discovery_runs checkpointing cannot resume after worker crash" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
AGENT-ARCHITECTURE.md specifies checkpointing to enable resume after worker crash. Phase 5 appends stages but always restarts discover-config from Stage 0 on retry — no read of `stages_completed` or `outputArtifactUrl` to skip completed work.

## Why it matters
Long browser captures re-run from scratch on BullMQ retry, doubling Playwright/AI cost and extending queue time.

## Severity
**Medium**

## Likelihood
**Occasional** under Fly OOM/restart or browser crash.

## Impact
Cost multiplier; duplicate HAR blobs; user sees progress UI reset on retry.

## Recommended fix
On job start, load latest `discovery_runs` row; skip stages marked completed with fresh artifact URLs (<24h); implement idempotent stage handlers.

## References
- `packages/db/src/discovery-runs.ts`
- `docs/discovery/AGENT-ARCHITECTURE.md` (Checkpointing)
EOF
)"

create_issue \
  "[Phase 5] Progress UI polling joins discovery_runs without migration guard" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Dashboard fast-path promotion wraps `createDiscoveryRun()` in try/catch that **swallows** errors if migration 0009 not applied. Worker path throws if table missing. Users see binary onboarding card until worker runs; no degraded-mode message.

`getOnboardingStatuses()` queries `discovery_runs` for all active onboardings — will 500 if migration not deployed before dashboard deploy.

## Why it matters
Deploy ordering mismatch breaks competitors page polling for all orgs.

## Severity
**Medium**

## Likelihood
**Occasional** on first Phase 5 deploy if migration lags code.

## Impact
Onboarding UI errors; silent loss of progress telemetry on fast path.

## Recommended fix
Migration gate in deploy docs; dashboard query try/catch fallback; remove silent swallow — surface ops warning in logs/metrics.

## References
- `apps/dashboard/src/app/(app)/competitors/actions.ts`
- `packages/db/drizzle/0009_discovery_runs.sql`
EOF
)"

# ── Category C: Future Enhancement ──

create_issue \
  "[Phase 5] Add Clerk admin role gate for ops UI (replace env flag only)" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
Phase 5 uses `ENABLE_OPS_UI` env var as sole gate. Production now has the flag enabled on Vercel, but there is no per-user authorization model.

## Why it matters
Env flag is appropriate for dev/staging but insufficient for multi-tenant production long term.

## Severity
**Medium**

## Likelihood
**Common** in production with multiple dashboard users.

## Impact
Over-privileged customer users; audit gaps.

## Recommended fix
Replace or augment env flag with Clerk `publicMetadata.role === 'admin'` or internal org allowlist; separate `/ops` route outside customer app shell.

## References
- `apps/dashboard/src/lib/ops-flags.ts`
EOF
)"

create_issue \
  "[Phase 5] Materialize endpoint_patterns table and sampleFieldMap from registry" \
  "discovery,phase-5-redteam,severity:medium" \
  "$(cat <<'EOF'
## Problem
SCALING.md `EndpointPattern` includes `sampleFieldMap` for skipping inference. Phase 5 patterns omit field maps entirely — still requires AI field-map inference after sniff even if URL matches.

## Why it matters
Partial flywheel value; AI cost reduction plateau below platform-pack sites.

## Severity
**Medium**

## Likelihood
**Common** once registry is populated.

## Impact
Higher token spend than documented architecture target.

## Recommended fix
Store dominant fieldMap per pattern from successful recipes; apply on pattern match before any LLM call.

## References
- `docs/discovery/SCALING.md`
- `packages/crawler/src/discover/endpoint-patterns.ts`
EOF
)"

create_issue \
  "[Phase 5] Platform pack success rates not logged to discovery_runs" \
  "discovery,phase-5-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
PLATFORM-PACKS.md requires deprioritizing packs with <50% validation success. Phase 5 `discovery_runs.stages_completed` does not record platform pack probe outcomes per platform — no aggregate telemetry for gating pack execution.

## Why it matters
False-positive packs cannot be automatically deprioritized at scale.

## Severity
**Low**

## Likelihood
**Common** over aggregate onboarding volume.

## Impact
Wasted validation time; wrong platform routing at margin.

## Recommended fix
Checkpoint pack probe results in `stages_completed` metadata; nightly aggregate per platform; skip packs below threshold.

## References
- `docs/discovery/PLATFORM-PACKS.md`
- Phase 4 red-team issue (still open)
EOF
)"

create_issue \
  "[Phase 5] Add active_recipe_version pointer on retailers" \
  "discovery,phase-5-redteam,severity:low" \
  "$(cat <<'EOF'
## Problem
Rollback creates a new audit version via `writeRecipeVersion()` but UI shows "active" as highest version number. Ops cannot easily see which version was rolled back from without parsing `createdBy=manual` rows.

Phase 1 red-team noted missing `active_recipe_version` column.

## Why it matters
Version history grows; ops confusion between live config and latest audit entry.

## Severity
**Low**

## Likelihood
**Occasional** during ops interventions.

## Impact
Support overhead; rollback mistakes.

## Recommended fix
Add `retailers.active_recipe_version`; update atomically on promote/rollback; display in ops UI.

## References
- `packages/db/src/rollback-recipe.ts`
- Phase 1 red-team findings
EOF
)"

echo "Phase 5 red-team issues created."
