# Deployment

## Topology

| Component | Where | Notes |
| --- | --- | --- |
| `apps/dashboard` | Vercel | B2B app. Set Clerk, Stripe, DATABASE_URL, REDIS_URL env. |
| `apps/web` | Vercel | Consumer site. Needs DATABASE_URL (read), NEXT_PUBLIC_* URLs. |
| `apps/worker` | Fly.io / Railway (container) | Long-running Playwright crawl fleet + schedulers. Not Vercel. |
| Postgres + pgvector | Neon (Vercel Marketplace) | Run `pnpm db:migrate` once provisioned. |
| Redis | Upstash | BullMQ queue + repeatable schedules. |
| Blob | Vercel Blob | Raw HTML snapshots. |

## First-time setup

```bash
cp .env.example .env            # fill in all secrets
pnpm install
pnpm db:migrate                 # creates pgvector ext + schema + HNSW index
pnpm db:seed                    # Sport Chek, MEC, Sporting Life
```

## Worker (container)

```bash
docker build -f apps/worker/Dockerfile -t retailer-worker .
docker run --env-file .env -p 8080:8080 retailer-worker
# Or split pools locally:
# tsx apps/worker/src/index.ts --workers=crawl
# tsx apps/worker/src/index.ts --workers=discovery
```

On Fly.io, use separate process groups (`crawl` and `discovery`) defined in
`apps/worker/fly.toml`. Discovery machines run Playwright onboarding;
crawl machines consume fetch/extract/match queues and register schedules.
Set `BROWSER_POOL_SIZE` and `DISCOVERY_CONCURRENCY` on discovery machines.
`DISCOVERY_CONCURRENCY` is capped to `BROWSER_POOL_SIZE` so each concurrent job
gets an exclusive Playwright context (session reset between jobs).
Health/metrics: `GET :8080/health`, `GET :8080/metrics`.

## Stripe webhook

Point a Stripe webhook at `https://<dashboard>/api/webhooks/stripe` for
`checkout.session.completed` and `customer.subscription.*` events, and set
`STRIPE_WEBHOOK_SECRET`.

## Manual crawl

```bash
DISCOVER_LIMIT=50 pnpm --filter @retailer/worker enqueue sportchek
```
