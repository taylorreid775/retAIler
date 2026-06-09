# Knowledge Storage Design

Dual storage: **DB for machine consumption**, **markdown docs for human and agent reference**, **Blob for raw artifacts**.

## Per-Retailer Documentation

```
docs/discovery/retailers/{retailer-key}/
  retailer-profile.md      # platform, domain, fingerprint summary
  endpoint-analysis.md     # all candidates, scores, why winner was chosen
  crawl-strategy.md        # primary mode, pagination, rate limits
  validation-report.md     # coverage, sample products, confidence
  known-issues.md          # bot walls, missing fields, repair history
  CHANGELOG.md             # config version history
```

Templates: [templates/](./templates/)

### Generation

`writeKnowledgeDocs()` runs at end of Stage 5. Templates are filled from structured stage outputs — **no LLM**.

Location: `packages/crawler/src/discover/knowledge/writer.ts`

### Consumption

Before rediscovery or repair:

1. Load `retailers.crawl_recipe` from DB (active version)
2. Load `retailer_recipe_versions` history
3. Read `docs/discovery/retailers/{key}/known-issues.md`
4. Read `docs/discovery/retailers/{key}/endpoint-analysis.md`
5. Load latest HAR from Blob if network stage needs replay

Location: `packages/crawler/src/discover/knowledge/reader.ts`

### Objective

Prevent future rediscovery work. Agents and engineers should read existing knowledge before performing discovery.

---

## Database (Machine Knowledge)

### Active Config

| Table / Column | Purpose |
|----------------|---------|
| `retailers.crawl_recipe` | Active crawl configuration |
| `retailers.fingerprint` | Denormalized platform fingerprint |
| `retailers.discovery_confidence` | Last known confidence |
| `retailers.crawl_health_score` | Composite health 0–1 |
| `retailers.discovery_notes` | Short human summary (existing) |
| `retailer_listing_pages` | Category/listing URLs with pagination |

### Versioned History

| Table | Purpose |
|-------|---------|
| `retailer_recipe_versions` | Immutable recipe snapshots |
| `retailer_endpoints` | Queryable endpoint registry with reliability scores |
| `discovery_runs` | Multi-stage discovery job tracking |
| `discovery_repairs` | Repair attempt log |
| `crawl_health_reports` | Per-crawl health metrics |

See [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md) for full DDL.

---

## Vercel Blob Artifacts

| Path | Content | Retention |
|------|---------|-----------|
| `discovery/{retailerKey}/network/{ts}.har` | Full network capture | 90 days |
| `discovery/{retailerKey}/bundles/{hash}.js` | Analyzed JS bundles | 30 days |
| `discovery/{retailerKey}/probes/{ts}.json` | Validation probe results | 90 days |
| `discovery/{retailerKey}/fingerprint/{ts}.json` | Fingerprint snapshot | Permanent |

Artifacts are referenced by URL in `discovery_runs` checkpoints.

---

## Existing Machine Knowledge (Today)

| Storage | Schema | Notes |
|---------|--------|-------|
| `retailers.crawl_recipe` | `CrawlRecipeSchema` | Single mutable blob — migrate to versioned |
| `store_onboarding.result` | JSON snapshot | UI display only |
| `CrawlRecipe.sources` | enum array | Tracks signal provenance |
| Agent manifest hints | parsed at runtime | Not persisted separately today |
| Test fixtures | `packages/crawler/src/discover/fixtures/` | e.g. `sportchek-running-shoes.md` |

---

## Knowledge Doc Templates

### retailer-profile.md

- Retailer name, domain, homepage URL
- Detected platform and confidence
- Framework and bot protection
- First discovered / last validated dates
- Org access count (how many businesses monitor this retailer)

### endpoint-analysis.md

- Table of all candidate endpoints with scores
- Winner selection rationale
- Required headers and cookies
- Dependency chain (which requests must precede others)
- GraphQL operation names (if applicable)

### crawl-strategy.md

- `discoveryMode` and `primaryEndpoint`
- Pagination strategy and limits
- `fetchStrategy` and proxy requirements
- Rate limit settings
- Extraction strategy for PDP fallback

### validation-report.md

- Estimated catalog size
- Sample products (3–5 anonymized)
- Field presence percentages
- Reliability test results
- Promotion confidence score

### known-issues.md

- Active issues and workarounds
- Bot protection notes
- Missing fields
- Repair history with dates
- Blocked status (if applicable)

### CHANGELOG.md

- Recipe version transitions
- `created_by`: discovery | repair | manual
- Summary of what changed per version

---

## Read-Before-Discover Protocol

Coding agents and discovery workers must:

```
1. SELECT * FROM retailers WHERE domain = ?
2. IF exists AND crawl_health_score >= 0.7:
     → skip discovery, grant access
3. IF exists AND crawl_health_score < 0.7:
     → read known-issues.md
     → enqueue DiscoverRepairJob (not full rediscovery)
4. IF not exists:
     → read platform pack docs for detected platform
     → run orchestrator
     → write all knowledge docs on completion
```
