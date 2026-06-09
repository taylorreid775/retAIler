# Critical Assessment & Risks

Read this before implementing discovery features. These are the primary weaknesses, bottlenecks, and operational risks in the current approach and the proposed architecture.

## Risk Matrix

| Risk | Why it hurts | Mitigation |
|------|--------------|------------|
| **Playwright as discovery bottleneck** | One browser, concurrency 1, ~30–120s per site | Separate discovery pool; fingerprint-first routing skips browser for 60%+ of sites |
| **AI inference on network captures** | Expensive, non-deterministic, hard to debug | Deterministic platform packs first; AI only for field-map inference on validated endpoints |
| **Jina as primary path** | Third-party dependency, blocks some retailers, markdown ≠ structured catalog | Jina for fingerprinting/navigation only; never as catalog source of truth |
| **Sitemap-first bias** | Many modern stores have thin/stale sitemaps | API discovery must run in parallel with sitemap, not as fallback |
| **Single `crawlRecipe` blob** | No versioning, no drift history, hard incremental repair | Versioned recipes + health metrics + repair jobs |
| **No rediscovery loop** | Config rots silently | Health scoring on every crawl triggers repair before full rediscovery |
| **Catalog completeness is unverifiable** | Cannot confirm 100% coverage without ground truth | Coverage heuristics (sitemap count vs API count, category sum vs total) + confidence decay |
| **Legal/compliance at scale** | Thousands of retailers = thousands of ToS surfaces | Per-retailer compliance flags, rate limits, robots enforcement baked into config |
| **Token cost explosion** | Full agentic discovery per site could cost $1–5+ | Stage-gated AI: only invoke LLM when deterministic stages score below threshold |

## Current Codebase Gaps

These gaps exist today and motivate the architecture:

| Gap | Detail |
|-----|--------|
| `listing_pages` discovery mode | Declared in `CrawlRecipeSchema` but no runtime adapter — only `jina_categories` uses listing pages |
| Dashboard parity | Fast path runs static `discoverSite` only; Jina and API sniff run only in `discover-config` worker |
| `jina_reader` fetch strategy | Enum exists; not fully wired in `createDiscoverFetchText()` |
| Platform → adapter routing | `platform` stored on recipe but doesn't auto-select discovery strategy |
| Listing page refresh | Categories discovered once at onboarding; no drift handling |
| Hand-written adapters | MEC, Sporting Life, Decathlon still bespoke; Sport Chek uses hardcoded recipe |
| Hard blocks | Sports Experts (Incapsula) rejected; some retailers block Jina |

## Design Principles (Derived from Risks)

1. **Parallel, not sequential fallback** — Run platform pack, sitemap, and bundle analysis concurrently.
2. **Validate before promote** — No retailer promotion without endpoint validation or path evidence.
3. **Version everything** — Recipes, fingerprints, and validation reports are immutable versions.
4. **Repair before rediscover** — Incremental header/pagination/endpoint fixes are cheaper than full rediscovery.
5. **Measure health every crawl** — Confidence decay is data-driven, not calendar-driven.
6. **Shared retailer model** — One discovery per domain serves all orgs; avoid duplicate work.

## Operational Targets

| Metric | Target |
|--------|--------|
| Auto-discovery success rate | ≥80% without human intervention |
| Mean time to first catalog | <5 min (API), <30 min (sitemap) |
| Repair success rate | ≥70% without full rediscovery |
| Human intervention rate | <5% of retailers/quarter |
| Discovery cost per retailer | <$0.05 |
