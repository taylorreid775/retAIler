import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq } from '@retailer/db';
import {
  createGenericAdapter,
  createRecipeAdapter,
  getAdapter,
  isAllowed,
  registerAdapter,
  type RetailerAdapter,
} from '@retailer/crawler';
import { ingestExtractedProduct } from '@retailer/pipeline';
import { CrawlRecipeSchema, QueueName, type DiscoverJob } from '@retailer/schema';
import { getRetailer, type RetailerRow } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { BrowserFetcher } from '../browser-fetcher.js';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { SCHEDULED_RUN_SENTINEL } from '../scheduler.js';

const log = createLogger('worker:discover');

/**
 * Resolve the adapter for a retailer. Prefer a saved crawl recipe (API or
 * sitemap); fall back to hand-written seeded adapters, then generic sitemap
 * config from DB columns.
 */
function resolveAdapter(retailer: RetailerRow): RetailerAdapter | undefined {
  const parsed = retailer.crawlRecipe
    ? CrawlRecipeSchema.safeParse(retailer.crawlRecipe)
    : null;
  if (parsed?.success && parsed.data.discoveryMode === 'api' && parsed.data.api) {
    const adapter = createRecipeAdapter({
      key: retailer.key,
      name: retailer.name,
      domain: retailer.domain,
      recipe: parsed.data,
    });
    log.info('using API crawl recipe', { retailerKey: retailer.key });
    return adapter;
  }

  const existing = getAdapter(retailer.key);
  if (existing) return existing;

  if (retailer.sitemapUrl && retailer.productUrlPattern) {
    // sitemapUrl may hold several newline-separated product sitemaps.
    const sitemapUrls = retailer.sitemapUrl
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const adapter = createGenericAdapter({
      key: retailer.key,
      name: retailer.name,
      domain: retailer.domain,
      sitemapUrl: sitemapUrls.length > 1 ? sitemapUrls : sitemapUrls[0],
      productUrlPattern: retailer.productUrlPattern,
    });
    registerAdapter(adapter);
    log.info('registered generic adapter from db config', {
      retailerKey: retailer.key,
      sitemapUrl: retailer.sitemapUrl,
      productUrlPattern: retailer.productUrlPattern,
    });
    return adapter;
  }

  return undefined;
}

/**
 * Discover product URLs for a retailer and fan out fetch jobs. Bounded in dev
 * via DISCOVER_LIMIT to avoid hammering a site during testing.
 */
export function startDiscoverWorker(): Worker<DiscoverJob> {
  const limit = process.env.DISCOVER_LIMIT ? Number(process.env.DISCOVER_LIMIT) : undefined;

  const worker = new Worker<DiscoverJob>(
    QueueName.Discover,
    async (job: Job<DiscoverJob>) => {
      const { retailerKey, categoryFilter } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);
      const adapter = resolveAdapter(retailer);
      if (!adapter) {
        throw new Error(
          `no adapter for ${retailerKey} (missing sitemapUrl/productUrlPattern for generic crawl)`,
        );
      }
      if (!retailer.enabled) {
        log.warn('retailer disabled, skipping', { retailerKey });
        const skipRunId = job.data.crawlRunId;
        if (skipRunId && skipRunId !== SCHEDULED_RUN_SENTINEL) {
          await db
            .update(schema.crawlRuns)
            .set({ status: 'failed', finishedAt: new Date() })
            .where(eq(schema.crawlRuns.id, skipRunId));
        }
        return;
      }

      // Scheduled fires carry a sentinel; create a fresh crawl run for them.
      let crawlRunId = job.data.crawlRunId;
      if (crawlRunId === SCHEDULED_RUN_SENTINEL) {
        const [run] = await db
          .insert(schema.crawlRuns)
          .values({ retailerId: retailer.id, status: 'running' })
          .returning({ id: schema.crawlRuns.id });
        if (!run) throw new Error('failed to create scheduled crawl run');
        crawlRunId = run.id;
      } else {
        await db
          .update(schema.crawlRuns)
          .set({ status: 'running' })
          .where(eq(schema.crawlRuns.id, crawlRunId));
      }

      let discovered = 0;
      const browserFetcher =
        retailer.fetchStrategy === 'browser' ? (fetcherFor('browser') as BrowserFetcher) : null;
      const fetchText = createDiscoverFetchText({
        fetchStrategy: retailer.fetchStrategy,
        log,
      });

      // Catalog/search JSON APIs use plain fetch — no Playwright (faster, no browser binary lock-in).
      const fetchJson = async (
        url: string,
        headers: Record<string, string> = {},
      ): Promise<unknown | null> => {
        try {
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
          if (!res.ok) {
            log.warn('API JSON fetch failed', { url, status: res.status });
            return null;
          }
          return (await res.json()) as unknown;
        } catch (err) {
          log.warn('API JSON fetch error', { url, err: String(err) });
          return null;
        }
      };

      const discoverCtx = { categoryFilter, limit, fetchText, fetchJson };

      if (adapter.discoverProducts) {
        for await (const raw of adapter.discoverProducts(discoverCtx)) {
          const { retailerProductId } = await ingestExtractedProduct(retailer.id, raw);
          void queues.match().add('match', { retailerProductId });
          discovered += 1;
          if (discovered % 50 === 0) {
            await db
              .update(schema.crawlRuns)
              .set({ urlsDiscovered: discovered, productsExtracted: discovered })
              .where(eq(schema.crawlRuns.id, crawlRunId));
            log.info('API discovery progress', { retailerKey, discovered });
          }
        }

        await db
          .update(schema.crawlRuns)
          .set({
            urlsDiscovered: discovered,
            productsExtracted: discovered,
            status: 'completed',
            finishedAt: new Date(),
          })
          .where(eq(schema.crawlRuns.id, crawlRunId));
        log.info('API discovery complete', { retailerKey, discovered });
        return;
      }

      for await (const url of adapter.discoverProductUrls(discoverCtx)) {
        if (retailer.respectRobotsTxt && !(await isAllowed(url))) continue;
        await queues.fetch().add('fetch', { retailerKey, url, crawlRunId });
        discovered += 1;
      }

      await db
        .update(schema.crawlRuns)
        .set({
          urlsDiscovered: discovered,
          status: discovered > 0 ? 'running' : 'completed',
          finishedAt: discovered > 0 ? null : new Date(),
        })
        .where(eq(schema.crawlRuns.id, crawlRunId));
      if (discovered === 0) {
        log.warn('discovery found no URLs — sitemap may be blocked or empty', { retailerKey });
      }
      log.info('discovery complete', { retailerKey, discovered });
    },
    {
      connection: redisConnection(),
      concurrency: 1,
      // Full-catalog API crawls can run 30–60+ minutes.
      lockDuration: 3_600_000,
    },
  );

  worker.on('failed', async (job, err) => {
    const crawlRunId = job?.data.crawlRunId;
    if (!crawlRunId || crawlRunId === SCHEDULED_RUN_SENTINEL) return;
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade < maxAttempts) return;
    await db
      .update(schema.crawlRuns)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(schema.crawlRuns.id, crawlRunId));
    log.error('discover job failed', {
      retailerKey: job.data.retailerKey,
      crawlRunId,
      err: String(err),
    });
  });

  return worker;
}
