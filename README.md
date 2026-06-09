# RetAIler — Canadian Retail Intelligence Platform

A competitive-intelligence platform for Canadian retail. A polite crawler fleet
feeds a normalization + cross-retailer product-matching pipeline into a Postgres
warehouse. An analytics layer derives price / inventory / assortment / SEO
signals, consumed by two surfaces:

- **B2B dashboard** (`apps/dashboard`) — the paid product. Retailers pick
  competitors and get price-change feeds, new-product alerts, low-stock signals,
  assortment trends, and SEO keyword-gap reports, plus weekly email digests.
- **Consumer site** (`apps/web`) — public price comparison + affiliate link-out.
  Doubles as the data flywheel that grows the product database.

## Architecture

```
Vercel Cron ─enqueue→ BullMQ (Upstash Redis) ─→ Playwright workers (apps/worker)
   workers ─raw HTML→ Vercel Blob
   workers ─→ pipeline: extract (AI Gateway) → normalize → match (pgvector + LLM)
   pipeline ─→ Postgres (Neon)
   analytics ─→ signals → dashboard + weekly Resend reports
```

## Monorepo layout

| Path | Description |
| --- | --- |
| `packages/schema` | Zod schemas + shared TS types (the contract) |
| `packages/core` | env validation, logger, AI Gateway client |
| `packages/db` | Drizzle ORM schema, migrations, client |
| `packages/ui` | shared shadcn-style component library |
| `packages/crawler` | retailer adapter framework + extractors |
| `packages/pipeline` | normalize + cross-retailer product matching |
| `packages/analytics` | signal computation jobs |
| `packages/jobs` | BullMQ queue + schedule definitions |
| `apps/worker` | long-running Playwright crawl-worker service |
| `apps/dashboard` | B2B Next.js dashboard (Clerk + Stripe) |
| `apps/web` | consumer Next.js price-comparison site |

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env   # fill in DATABASE_URL etc.

# Database (needs Postgres with the pgvector extension)
pnpm db:generate       # generate SQL migrations from the Drizzle schema
pnpm db:migrate        # apply migrations (creates the vector extension too)
pnpm db:seed           # seed Sport Chek, MEC, Sporting Life

# Dev
pnpm dev               # runs all apps via turbo
```

### Seed retailers

Sport Chek, MEC, and Sporting Life. Canadian Tire (and its Atmosphere banner)
are intentionally excluded because Canadian Tire owns Sport Chek — they don't
truly compete.

## Documentation

| Doc | Description |
| --- | --- |
| [docs/discovery/](./docs/discovery/README.md) | Retailer discovery architecture (agent reference) |
| [docs/ADD_RETAILER.md](./docs/ADD_RETAILER.md) | Onboarding paths for new retailers |
| [docs/COMPLIANCE.md](./docs/COMPLIANCE.md) | Crawl compliance checklist |

## Compliance note

Crawling respects `robots.txt` by default, throttles per-retailer, identifies a
bot user-agent, and snapshots raw HTML for provenance. Review each target's
Terms of Service before enabling it in production (see Phase 7).
