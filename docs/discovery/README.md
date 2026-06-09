# RetAIler Discovery System

Architecture reference for coding agents building retailer discovery and competitive pricing intelligence.

## Philosophy

Design as a **deterministic system first, AI second**. AI is used only where heuristics, pattern matching, or rule-based systems cannot reliably solve the problem.

Goals:

- Minimize token usage
- Minimize repeated discovery work
- Maximize reuse of retailer knowledge
- Prefer deterministic workflows whenever possible

Primary catalog acquisition strategy (in order):

1. Product APIs
2. Search APIs
3. Category APIs
4. Inventory / pricing / variant / availability APIs
5. GraphQL APIs
6. HTML extraction (fallback only)

## Document Index

| Document | Purpose |
|----------|---------|
| [RISKS.md](./RISKS.md) | Critical assessment, bottlenecks, operational risks |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, package placement, retailer resolution |
| [AGENT-ARCHITECTURE.md](./AGENT-ARCHITECTURE.md) | Orchestrator design, state machine, AI gates |
| [TOOLS.md](./TOOLS.md) | Tool definitions for discovery stages |
| [WORKFLOW.md](./WORKFLOW.md) | Five-stage discovery workflow (fingerprint → config) |
| [PLATFORM-PACKS.md](./PLATFORM-PACKS.md) | Deterministic platform-specific endpoint probes |
| [KNOWLEDGE-STORAGE.md](./KNOWLEDGE-STORAGE.md) | DB + docs + Blob artifact storage |
| [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md) | New tables and columns |
| [WORKER-PLAN.md](./WORKER-PLAN.md) | Phased worker implementation plan |
| [BULLMQ-JOBS.md](./BULLMQ-JOBS.md) | Queue design, job schemas, retry policy |
| [COST-OPTIMIZATION.md](./COST-OPTIMIZATION.md) | Token budgets and cost controls |
| [AI-STRATEGY.md](./AI-STRATEGY.md) | Where AI is and is not used |
| [FAILURE-RECOVERY.md](./FAILURE-RECOVERY.md) | Health monitoring, repair, rediscovery |
| [SCALING.md](./SCALING.md) | Scaling to thousands of retailers |
| [EXISTING-CODE-MAP.md](./EXISTING-CODE-MAP.md) | Mapping design to current codebase |
| [IMPLEMENTATION-ORDER.md](./IMPLEMENTATION-ORDER.md) | Recommended build sequence |

## Per-Retailer Knowledge

After discovery completes, generate retailer-specific docs under:

```
docs/discovery/retailers/{retailer-key}/
  retailer-profile.md
  endpoint-analysis.md
  crawl-strategy.md
  validation-report.md
  known-issues.md
  CHANGELOG.md
```

Templates: [templates/](./templates/)

## Related Existing Docs

- [ADD_RETAILER.md](../ADD_RETAILER.md) — Current onboarding paths
- [COMPLIANCE.md](../COMPLIANCE.md) — Crawl compliance checklist
- [MVP_PLAN.md](../MVP_PLAN.md) — Product rollout status

## Key Code Paths (Today)

| Area | Path |
|------|------|
| Site discovery | `packages/crawler/src/discovery.ts` |
| Platform hints | `packages/crawler/src/agent-manifest.ts` |
| API inference | `packages/crawler/src/discover/infer-api-recipe.ts` |
| Jina categories | `packages/crawler/src/discover/category-directory.ts` |
| Crawl recipe schema | `packages/schema/src/crawl-recipe.ts` |
| Onboarding worker | `apps/worker/src/consumers/discover-config.ts` |
| Crawl worker | `apps/worker/src/consumers/discover.ts` |
| Job queues | `packages/jobs/src/queues.ts` |
| DB schema | `packages/db/src/schema.ts` |
