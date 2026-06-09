# Onboarding a new retailer

> **Architecture reference:** See [docs/discovery/](./discovery/README.md) for the full
> discovery system design, implementation order, and agent instructions.

Three paths, in order of preference.

## 0. Self-serve — add a store by URL (no code, no ops)

Commercial users can add a store straight from the dashboard **Competitors**
page ("Add a store"). Paste the store's homepage URL and the platform:

1. Auto-discovers crawl config via `discoverSite()` (`packages/crawler/src/discovery.ts`):
   reads `robots.txt` `Sitemap:` directives + crawl-delay, probes `llms.txt` /
   agent files, resolves a sitemap (or falls back to a shallow homepage crawl),
   then **confirms products by page content** (JSON-LD / microdata / `og:type`)
   and derives the product-URL pattern + fetch strategy from the confirmed pages.
2. Inserts a global `retailers` row with `source = 'user'` and the discovered
   config (`homepage_url`, `sitemap_url`, `product_url_pattern`, `llms_txt_url`).
3. Tracks the store for the org (counts against the plan's competitor limit) and
   enqueues an immediate `crawl-discover` job.

The worker's discover consumer builds a generic adapter from the row on the fly
(`resolveAdapter()` in `apps/worker/src/consumers/discover.ts`) — no code or
redeploy needed. The crawl only runs once a worker is consuming the queue.

If discovery can't confirm any product pages (e.g. a fully JS-rendered site,
since the dashboard has no browser fetcher), the store is **not** created and the
UI reports what was/wasn't found. Use path 1 or 2 below for those.

## 1. Fast path — generic sitemap adapter (no code)

Most retailers expose a sitemap and schema.org Product JSON-LD on their PDPs.
For these, no retailer-specific parser is needed — generic JSON-LD + the LLM
fallback handle extraction.

1. Complete the [compliance checklist](./COMPLIANCE.md) and get sign-off.
2. Insert the retailer row (see `packages/db/src/seed.ts` for the shape), choosing
   `fetch_strategy` = `static` (server-rendered) or `browser` (JS-rendered).
3. Register a generic adapter at worker startup:

```ts
import { registerAdapter, createGenericAdapter } from '@retailer/crawler';

registerAdapter(
  createGenericAdapter({
    key: 'altitude',
    name: 'Altitude Sports',
    domain: 'www.altitude-sports.com',
    productUrlPattern: '/products/',
  }),
);
```

4. Kick off a bounded test crawl: `DISCOVER_LIMIT=50 pnpm --filter @retailer/worker enqueue altitude`.
5. Review extraction quality + the match review queue, then raise limits.

## 2. Custom adapter (when the fast path is insufficient)

If a retailer hides prices behind APIs, lacks JSON-LD, or has an unusual sitemap:

1. Add `packages/crawler/src/adapters/<key>.ts` implementing `RetailerAdapter`.
2. Provide `discoverProductUrls` (sitemap walk or category crawl) and, if needed,
   a `parseProduct` for retailer-specific structured extraction (tried before the
   generic JSON-LD / LLM path).
3. Add it to the registry in `packages/crawler/src/adapters/index.ts`.
4. Test as above.

## Notes

- Start every new retailer with `DISCOVER_LIMIT` set to sample, and a generous
  `requestDelayMs`.
- Watch `GET /metrics` on the worker for crawl health + data freshness.
