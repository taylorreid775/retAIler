# RetAIler MVP Plan — Get to “add site → crawl → public catalog” today

**Goal:** A store added in the dashboard is crawled, extracted accurately, matched, stored in Neon, and visible to anyone on the public consumer site (`apps/web`).

**Working doc:** Check items off as we go. Each task has an **Owner** — who is expected to do it with the tools available today.

| Owner | Meaning |
|-------|---------|
| **You** | Requires your account, billing, or a browser action I cannot perform |
| **Agent** | I can implement, configure, deploy, or verify with repo + MCP tools |
| **Together** | You do one step, I do the next (or we pair on verification) |

---

## Current state (2026-06-07)

### What’s working

- [x] Monorepo pipeline wired: discover → fetch → extract → match → DB
- [x] Dashboard add-store flow (`/competitors` → paste URL → enqueue crawl)
- [x] Public web app deployed (`retailer-web-xi.vercel.app`) — no auth, search + product pages
- [x] Neon Postgres + pgvector populated (Sport Chek ~893 products with images)
- [x] AI Gateway key configured locally; chat + embeddings succeed for single requests
- [x] Clerk org registration on dashboard (`/sign-up`)
- [x] Stripe billing UI scaffolded (`/billing` → checkout + portal)

### What’s blocking MVP

- [ ] **Worker not in production** — crawls only run while your laptop worker is on (`apps/worker/fly.toml` ready)
- [ ] **AI Gateway on Hobby free tier** — bulk embedding hits rate limits (`AI_RetryError`); retry/backoff added
- [ ] **AI Gateway shows “No Project”** — requests work but aren’t tied to a Vercel project (cosmetic; fix by linking deployments)
- [x] **MEC image extraction** — fixed (`urlOriginal` + `og:image` fallback); verified on crawl 2026-06-07
- [x] **False product matches** — blind auto-match removed; LLM adjudication + same-SKU guard added
- [ ] **MEC discovery behind Cloudflare** — fixed via browser sitemap fetch; 2/3 PDP fetches still flaky (retry/backoff)
- [ ] **Org on `trial` plan** — 1 competitor max; Stripe customer not created yet
- [ ] **BLOB_READ_WRITE_TOKEN** missing locally — snapshots skipped (re-extract harder)
- [ ] **Crawl runs never mark `completed`** — status page shows perpetual `running` (URL-discovery path stays `running` until fetch drain)
- [ ] **Unmatched / `needs_review` products invisible** on public web (by design today)
- [x] **`llms.txt` / crawl recipe** — `crawl_recipe` jsonb + agent manifest parsing on promote/discover

### Your accounts (reference)

| System | Account | Tier / status |
|--------|---------|---------------|
| Vercel | `taylorreid775` | Hobby · AI Gateway $5.00 free credit · 56 requests (12h) |
| Dashboard | Clerk org `org_3ElmOgH14dA2YlgMWQgNRmfmlo4` | `trial` plan · 1 competitor max |
| Neon | `retAIler` project | Active |
| Stripe | Not linked to org yet | `stripe_customer_id` is null |

---

## Two different “upgrades” (don’t confuse them)

### 1. Vercel AI Gateway credits (infrastructure)

**Powers:** product embeddings, LLM extraction fallback, match adjudication.

**Not** the same as dashboard billing. Required for reliable crawls at scale.

- [ ] **You:** Vercel → AI Gateway → add paid credits / top up (click **$5.00 Free Credit** or Billing in AI Gateway settings)
- [ ] **Agent:** Add embedding retry + backoff on 429 in `packages/pipeline/src/embeddings.ts`
- [ ] **Agent:** Fail loud at worker startup if `AI_GATEWAY_API_KEY` is missing

### 2. Stripe plan upgrade (corp / B2B dashboard)

**Powers:** competitor limits, seats, weekly reports — via Clerk-registered org on `apps/dashboard`.

Flow already built:

1. Sign up / sign in (Clerk) → `/sign-up`
2. Dashboard → **Billing** → **Upgrade** on Starter / Growth / Scale
3. Stripe Checkout → webhook updates `orgs.plan` in Neon

| Plan | Competitors | Price |
|------|-------------|-------|
| trial | 1 | free |
| starter | 3 | $500/mo |
| growth | 10 | $1,200/mo |
| scale | 50 | custom |

- [ ] **You:** Confirm Stripe products + price IDs exist in [Stripe Dashboard](https://dashboard.stripe.com)
- [ ] **You:** Ensure Vercel dashboard project has `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PRICE_*` env vars
- [ ] **You:** Stripe webhook → `https://<dashboard-domain>/api/webhooks/stripe` (events: `checkout.session.completed`, `customer.subscription.*`)
- [ ] **Together:** Complete a test checkout on `/billing` and verify `orgs.plan` updates in Neon
- [ ] **Agent (MVP shortcut):** Manually set your org to `growth` in Neon for today's testing if Stripe isn't ready — tell me when to run this

---

## Phase 0 — Unblock the pipeline (do first)

> Without this phase, nothing after add-store will run reliably.

| # | Task | Owner | Done |
|---|------|-------|------|
| 0.1 | Add AI Gateway paid credits on Vercel (Hobby → top up) | **You** | [ ] |
| 0.2 | Confirm `AI_GATEWAY_API_KEY` on worker env (prod + local `.env`) | **Together** | [ ] |
| 0.3 | Confirm `REDIS_URL` is identical on dashboard Vercel project + worker | **Agent** can verify Upstash; **You** confirm Vercel env UI | [ ] |
| 0.4 | Deploy `apps/worker` to Fly.io or Railway (Dockerfile + `fly.toml` ready) | **Agent** can prepare config; **You** may need to create account / approve deploy | [ ] |
| 0.5 | Set worker prod env: `DATABASE_URL`, `REDIS_URL`, `AI_GATEWAY_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRAWLER_USER_AGENT` | **Together** | [ ] |
| 0.6 | Verify worker health: `GET /health` and `GET /metrics` | **Agent** | [ ] |
| 0.7 | Manual crawl smoke test: `DISCOVER_LIMIT=20 pnpm --filter @retailer/worker enqueue sportchek` | **Agent** | [ ] |
| 0.8 | Confirm new rows in `retailer_products` + products on public web search | **Together** | [ ] |

**Exit criteria:** Worker runs 24/7 in prod; a manual enqueue results in products searchable on `retailer-web-xi.vercel.app` within ~30 minutes.

---

## Phase 1 — Extraction accuracy & reliability

> Target: seeded retailers trustworthy; generic user-added stores good when sitemap + JSON-LD exist.

| # | Task | Owner | Files / notes | Done |
|---|------|-------|---------------|------|
| 1.1 | Fix MEC image extraction (0/23 today) | **Agent** | `packages/crawler/src/adapters/mec.ts` — inspect real `__NEXT_DATA__`, add `og:image` fallback | [x] |
| 1.2 | Backfill `products.image_url` when canonical is null | **Agent** | `packages/pipeline/src/match.ts` `backfillProduct()` | [x] |
| 1.3 | Include `categoryPath` in embedding text | **Agent** | `packages/pipeline/src/embeddings.ts` | [x] |
| 1.4 | Tighten matching: require LLM adjudication before auto-match | **Agent** | `packages/pipeline/src/matching.ts` — lower blind auto-match tier | [x] |
| 1.5 | Same-retailer guard: different SKU → don't auto-merge | **Agent** | `packages/pipeline/src/matching.ts` | [x] |
| 1.6 | Fix known bad match: unlink Vuori bra from tank canonical product | **Agent** | Neon SQL + re-enqueue match job | [x] |
| 1.7 | Embedding retry with exponential backoff on 429 | **Agent** | `packages/pipeline/src/embeddings.ts` | [x] |
| 1.8 | Bot-wall detection in crawl discover path | **Agent** | `apps/worker/src/discover-fetch.ts` (browser fallback for sitemaps + HTML) | [x] |
| 1.9 | Re-crawl MEC after fixes; verify images + no false pairs | **Together** | 1/3 PDPs extracted with image on 2026-06-07 crawl; 2 fetches still retrying | [~] |

**Exit criteria:** MEC products have images; tank/bra-style false merges stop; embedding rate-limit warnings rare during 50-product crawl.

---

## Phase 2 — Add-store → public catalog (end-to-end)

> The user-facing MVP loop.

| # | Task | Owner | Done |
|---|------|-------|------|
| 2.1 | Upgrade org plan (Stripe `/billing` **or** agent DB bump for testing) | **You** / **Agent** | [ ] |
| 2.2 | Dashboard → Competitors → add store URL (e.g. `decathlon.ca`) | **You** | [ ] |
| 2.3 | Worker processes `discover-config` or `discover` job | **Agent** monitors logs / metrics | [ ] |
| 2.4 | Products extracted + matched (`retailer_products.product_id` set) | **Agent** queries Neon | [ ] |
| 2.5 | Product appears on public web `/search?q=...` | **Together** | [ ] |
| 2.6 | Finalize crawl runs (`status: completed`) | **Agent** | `apps/worker/src/consumers/discover.ts` + fetch completion tracking | [ ] |
| 2.7 | Set `BLOB_READ_WRITE_TOKEN` on prod worker | **Together** | [ ] |

**Exit criteria:** You add a new store in the dashboard; within one session, its products are browsable on the public site by anyone.

---

## Phase 3 — Corp registration & billing (Stripe + Clerk)

> “Upgrade through the registration provider” = Clerk account + Stripe checkout on the corp dashboard.

| # | Task | Owner | Done |
|---|------|-------|------|
| 3.1 | Clerk production instance keys on Vercel dashboard | **You** (Clerk dashboard) | [ ] |
| 3.2 | Stripe products: Starter / Growth / Scale with recurring prices | **You** (Stripe dashboard) | [ ] |
| 3.3 | Copy price IDs → `NEXT_PUBLIC_STRIPE_PRICE_*` on Vercel | **You** | [ ] |
| 3.4 | Stripe webhook secret → `STRIPE_WEBHOOK_SECRET` | **You** | [ ] |
| 3.5 | Test full upgrade: trial → starter via `/billing` | **You** | [ ] |
| 3.6 | Agent verifies webhook updated `orgs.plan` in Neon | **Agent** | [ ] |

**Note:** This upgrades **dashboard entitlements** (more competitors). It does **not** replace Vercel AI Gateway credits for crawling.

---

## Phase 4 — Polish (after MVP demo)

| # | Task | Owner | Done |
|---|------|-------|------|
| 4.1 | Match review UI (confirm / reject queue) | **Agent** | [ ] |
| 4.2 | `markStaleInactive()` at end of crawl runs | **Agent** | [ ] |
| 4.3 | Link AI Gateway usage to Vercel project (fix “No Project”) | **You** | [ ] |
| 4.4 | Auto-enqueue crawl after `db:seed` | **Agent** | [ ] |
| 4.5 | Public “suggest a store” form on `apps/web` (optional) | **Agent** | [ ] |
| 4.6 | Compliance gate before `enabled: true` on user stores | **Together** | `docs/COMPLIANCE.md` |

---

## Suggested order for today

```
Morning (you, ~20 min)
  → 0.1  Top up Vercel AI Gateway credits
  → 0.3  Confirm Redis + env vars on Vercel dashboard project
  → 3.1–3.4  Stripe setup (if not done) OR ask agent to bump plan in DB

Morning (agent, parallel)
  → 1.1–1.7  Extraction + matching fixes
  → 0.4–0.6  Worker deploy prep / config

Midday (together)
  → 0.7–0.8  Smoke test crawl
  → 1.9       Re-crawl MEC, verify images
  → 2.1–2.5   Full add-store → public web test

Afternoon
  → 2.6–2.7  Pipeline polish
  → 3.5–3.6  Stripe upgrade test (if configured)
```

---

## What I can do right now (pick any to start)

1. **Implement Phase 1 code fixes** (MEC images, matching guardrails, embedding retry)
2. **Fix the Vuori bad match** in Neon and re-run match
3. **Prepare worker Fly.io / Railway config** (`fly.toml` or railway.json + deploy instructions)
4. **Bump your org to `growth` in Neon** for today's testing (bypass Stripe until webhook is ready)
5. **Verify env vars** across Vercel projects via MCP
6. **Query Neon** after each crawl to confirm products are matching and appearing

## What only you can do

1. **Vercel AI Gateway top-up** (billing on `taylorreid775` account)
2. **Create / approve Fly.io or Railway account** for worker hosting
3. **Stripe Dashboard** — products, prices, webhook endpoint
4. **Clerk Dashboard** — production keys if not already on Vercel
5. **Click through** add-store + billing flows in the browser

---

## Key env vars checklist

### Vercel — `retailer-dashboard`

```
DATABASE_URL
REDIS_URL
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PRICE_STARTER
NEXT_PUBLIC_STRIPE_PRICE_GROWTH
NEXT_PUBLIC_STRIPE_PRICE_SCALE
NEXT_PUBLIC_WEB_URL
```

### Vercel — `retailer-web`

```
DATABASE_URL
NEXT_PUBLIC_DASHBOARD_URL
NEXT_PUBLIC_WEB_URL
```

### Worker (Fly / Railway)

```
DATABASE_URL
REDIS_URL
AI_GATEWAY_API_KEY
BLOB_READ_WRITE_TOKEN
CRAWLER_USER_AGENT
CRAWLER_MAX_CONCURRENCY=2
REGISTER_SCHEDULES=true
```

---

## Success definition for today

- [ ] Worker running in production (not just local `pnpm dev`)
- [ ] AI Gateway paid credits — no embedding rate-limit errors during a 50-product crawl
- [ ] Add store in dashboard → crawl completes → matched products on public web
- [ ] MEC products show images; no obvious false merges on sportswear spot-check
- [ ] Org can add 3+ competitors (Stripe upgrade **or** temporary DB plan bump)

---

*Last updated: 2026-06-07 · update checkboxes as we complete items*
