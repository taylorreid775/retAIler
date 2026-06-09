# AI Usage Strategy

AI is a **fallback layer** in the discovery system. The orchestrator is deterministic TypeScript.

## Summary

| Use AI | Never use AI |
|--------|--------------|
| API field-map inference | Platform detection |
| Category tree from markdown | URL pattern derivation |
| PDP extraction fallback (crawl time) | Pagination param detection |
| Match adjudication (pipeline) | Endpoint reliability scoring |
| | Request header identification |
| | Recipe version management |
| | Health score computation |
| | Job routing / orchestration |

---

## AI Calls in Discovery (Only Two)

### 1. `inferApiRecipe` — Field-Map Inference

**When:** Network capture scored ≥ 0.5 but deterministic field mapping failed.

**File:** `packages/crawler/src/discover/infer-api-recipe.ts`

**Input:**

- Top 1–3 `CapturedRequest` objects with JSON bodies
- Truncated response samples
- Optional platform hint from fingerprint

**Output:** `ApiRecipe` with `fieldMap`, `productsPath`, `pagination` hints

**Model:** `extractionModel()` → `openai/gpt-4o-mini` via AI Gateway

**Schema:** Zod `ApiRecipeSchema` subset via `generateObject`

**Required response fields:**

```typescript
{
  confidence: number;  // 0-1; reject if < 0.7
  reasoning: string;   // for debugging, stored in discovery_runs
  // ... ApiRecipe fields
}
```

### 2. `discoverCategoryDirectory` — Category Tree

**When:** Jina homepage markdown available AND heuristic category extraction finds <3 categories.

**File:** `packages/crawler/src/discover/category-directory.ts`

**Input:**

- Jina markdown of homepage
- Domain and homepage URL

**Output:** `CategoryDirectory` with URLs, labels, pagination, product URL pattern

**Model:** `extractionModel()` via `generateObject`

---

## AI Calls in Crawl Pipeline (Not Discovery)

These exist today and are unchanged by discovery architecture:

| Call | File | When |
|------|------|------|
| PDP LLM extraction | `packages/crawler/src/extract/llm.ts` | JSON-LD, recipe, and adapter all fail |
| Match adjudication | `packages/pipeline/src/matching.ts` | pgvector candidate within distance threshold |
| Embeddings | `packages/pipeline/src/embeddings.ts` | After ingest, before match |

Extraction order (existing — keep):

```
custom adapter → JSON-LD → recipe hints → LLM last
```

LLM extraction gated by `allowLlm` when a custom adapter exists.

---

## Client Configuration

All AI through `@retailer/core`:

```typescript
// packages/core/src/ai.ts
aiGateway()           // Vercel AI Gateway OpenAI-compatible client
extractionModel()     // AI_EXTRACTION_MODEL, default openai/gpt-4o-mini
embeddingModel()      // AI_EMBEDDING_MODEL, default openai/text-embedding-3-small
```

Environment:

```
AI_GATEWAY_API_KEY=...
AI_EXTRACTION_MODEL=openai/gpt-4o-mini
AI_EMBEDDING_MODEL=openai/text-embedding-3-small
```

---

## Structured Output Contract

All discovery AI calls must:

1. Use `generateObject` (not `generateText`)
2. Validate output against Zod schema
3. Include `confidence` field in schema
4. Include `reasoning` field for observability
5. Reject and fall through on `confidence < 0.7` — **no retry loops**
6. Record `token_usage` on `discovery_runs`

Example pattern (from existing `infer-api-recipe.ts`):

```typescript
import { generateObject } from 'ai';
import { aiGateway, extractionModel } from '@retailer/core';

const { object, usage } = await generateObject({
  model: extractionModel(),
  schema: InferredApiRecipeSchema,
  prompt: buildPrompt(captures),
});

if (object.confidence < 0.7) return null;
```

---

## What Replaces AI in Discovery

| Task | Deterministic replacement |
|------|--------------------------|
| Platform detection | `fingerprintSite()` — regex, headers, bundles |
| Endpoint discovery | Platform packs + network capture scoring |
| Pagination detection | Probe page 1 vs page 2, compare item IDs |
| Header requirements | Diff success/fail request captures |
| URL patterns | `deriveProductPattern()` from confirmed PDPs |
| Product confirmation | JSON-LD / microdata / `og:type` content checks |
| Config generation | `generateCrawlRecipe()` — pure merge logic |
| Knowledge docs | Template filling — no generation |

---

## Anti-Patterns (Do Not Implement)

- LLM orchestrator loop with open-ended tool calling
- LLM for robots.txt or sitemap parsing
- LLM to classify every network request (use `scoreJsonForProducts`)
- LLM on full HTML pages during discovery (condense first; only at extract time)
- Retry LLM on low confidence (fall through to next strategy instead)
- Chat-based discovery agent exposed to users

---

## Observability

Log per discovery run:

```typescript
{
  discoveryRunId: string;
  aiCalls: Array<{
    tool: 'inferApiRecipe' | 'discoverCategoryDirectory';
    model: string;
    inputTokens: number;
    outputTokens: number;
    confidence: number;
    accepted: boolean;
  }>;
  totalTokens: number;
  estimatedCostUsd: number;
}
```

Store in `discovery_runs.token_usage` and `discovery_runs.cost_usd`.
