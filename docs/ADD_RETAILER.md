# Onboarding a new retailer

Two paths, depending on how cleanly the site exposes products.

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
