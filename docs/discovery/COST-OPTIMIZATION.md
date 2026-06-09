# Cost Optimization Strategy

Discovery must scale to thousands of retailers without proportional AI spend.

## Token Budget Per Retailer

| Path | Est. tokens | Est. cost | % of sites | Frequency |
|------|-------------|-----------|------------|-----------|
| Platform pack (Shopify/SFCC) | 0 | $0 | ~40% | Once at onboard |
| Sitemap + JSON-LD | 0 | $0 | ~25% | Once at onboard |
| API field-map inference | 2–4k | $0.002–0.01 | ~20% | Once at onboard |
| Jina category inference | 1–3k | $0.001–0.005 | ~10% | Once at onboard |
| Full rediscovery | 5–10k | $0.01–0.05 | <5%/year/retailer | Rare |
| PDP LLM extraction (crawl) | 1–2k/product | varies | Only on fallback | Every crawl |

Models (from `@retailer/core`):

- Extraction / inference: `openai/gpt-4o-mini` (default via `AI_EXTRACTION_MODEL`)
- Embeddings: `openai/text-embedding-3-small` (matching pipeline — separate from discovery)

---

## Rules

### 1. Never LLM for Routing

Platform detection, strategy selection, and job routing are regex + headers + bundle analysis. Zero tokens.

### 2. Platform Packs Before Network Sniff

A single `GET /products.json` costs nothing. Playwright network capture costs compute + potential AI. Always probe platform packs first.

### 3. Cache Captures

If `retailer_endpoints.last_validated_at` < 24h, skip network stage on repair. Reuse stored HAR from Vercel Blob.

### 4. Shared Retailer Dedup

One discovery per domain, not per org. Multiple businesses monitoring Sport Chek share one `retailers` row and one `crawlRecipe`.

### 5. Recipe Version Immutability

Repair creates a new version in `retailer_recipe_versions` — never mutate in place. Enables rollback without re-inference.

### 6. Jina Budget

Maximum per discovery:

- 1 homepage fetch
- 3 category spot-checks
- 0 full listing crawls during discovery (probe only)

Jina has no direct token cost but has rate limits and latency. Do not use as catalog source of truth.

### 7. Probe, Don't Crawl

Discovery validates with ≤50 products. Full catalog enumeration happens in `crawl-discover`, not discovery orchestrator.

### 8. Batch Platform Pack Probes

Shopify `products.json` is one HTTP GET. Run all platform probes in parallel with 5s total timeout.

### 9. Structured Output Only

All AI calls use `generateObject` with Zod schemas. Reject outputs with `confidence < 0.7` without retry loops.

### 10. Track Spend Per Run

Write `token_usage` and `cost_usd` to `discovery_runs`. Alert if single discovery exceeds $0.10.

---

## Projected Cost at Scale

### 1,000 Retailers (Initial Onboarding)

| Path | Count | Cost each | Total |
|------|-------|-----------|-------|
| Platform pack / sitemap | 650 | $0 | $0 |
| API inference | 200 | ~$0.005 | ~$1 |
| Jina + AI categories | 100 | ~$0.003 | ~$0.30 |
| Full rediscovery | 50 | ~$0.03 | ~$1.50 |
| **Total discovery** | | | **~$3–5** |

### Monthly Ongoing

| Activity | Est. cost |
|----------|-----------|
| Rediscovery (5% of retailers/month) | $1–3 |
| Repair (no AI in 70% of cases) | $0.50 |
| Crawl LLM extraction fallback | Dominant — keep structured-first |
| Embeddings (matching) | Separate pipeline budget |

---

## Compute Cost (Non-AI)

| Resource | Cost driver | Optimization |
|----------|-------------|--------------|
| Playwright browser | ~60s per network capture | Fingerprint routing skips 60%+ |
| Fly.io workers | Always-on crawl workers | Separate discovery pool; scale to zero on schedule |
| Jina Reader | Rate limits, latency | Navigation only, not full catalog |
| Vercel Blob | HAR storage | 90-day retention; compress HAR |
| Neon Postgres | Health reports growth | Partition `crawl_health_reports` by month |

---

## AI Gate Implementation

```typescript
const AI_BUDGET = {
  maxTokensPerDiscovery: 10_000,
  maxCostUsdPerDiscovery: 0.10,
  requireConfidence: 0.7,
};

async function inferWithBudget(ctx: DiscoveryContext, captures: CapturedRequest[]) {
  if (ctx.tokenUsage >= AI_BUDGET.maxTokensPerDiscovery) {
    throw new BudgetExceededError('discovery token budget');
  }

  const result = await inferApiRecipeFromCaptures(captures);

  ctx.tokenUsage += result.usage.totalTokens;
  ctx.costUsd += estimateCost(result.usage);

  if (result.object.confidence < AI_BUDGET.requireConfidence) {
    return null; // fall through to next strategy, do not retry LLM
  }

  return result.object;
}
```

---

## Cost vs Quality Tradeoffs

| Decision | Cheaper | Better coverage |
|----------|---------|-----------------|
| Platform pack vs network sniff | Platform pack | Network sniff |
| API mode vs sitemap + PDP | API mode | Sitemap (sometimes more complete) |
| Jina nav vs browser crawl | Jina nav | Browser (more accurate structure) |
| Repair vs rediscovery | Repair | Rediscovery |
| LLM extraction vs JSON-LD | JSON-LD | LLM (edge cases) |

Default to cheaper path when confidence ≥ threshold. See thresholds in [WORKFLOW.md](./WORKFLOW.md) and [FAILURE-RECOVERY.md](./FAILURE-RECOVERY.md).
