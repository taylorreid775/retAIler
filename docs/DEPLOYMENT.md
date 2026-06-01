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
```

The worker registers repeatable schedules on boot (daily crawls per retailer +
daily analytics + weekly reports). Disable with `REGISTER_SCHEDULES=false`.
Health/metrics: `GET :8080/health`, `GET :8080/metrics`.

## Stripe webhook

Point a Stripe webhook at `https://<dashboard>/api/webhooks/stripe` for
`checkout.session.completed` and `customer.subscription.*` events, and set
`STRIPE_WEBHOOK_SECRET`.

## Manual crawl

```bash
DISCOVER_LIMIT=50 pnpm --filter @retailer/worker enqueue sportchek
```
