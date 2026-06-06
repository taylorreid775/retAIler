import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq } from '@retailer/db';
import {
  createGenericAdapter,
  getAdapter,
  isAllowed,
  registerAdapter,
  SPORTCHEK_API_HEADERS,
  type RetailerAdapter,
} from '@retailer/crawler';
import { ingestExtractedProduct } from '@retailer/pipeline';
import { QueueName, type DiscoverJob } from '@retailer/schema';
import { getRetailer, type RetailerRow } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { BrowserFetcher } from '../browser-fetcher.js';
import { SCHEDULED_RUN_SENTINEL } from '../scheduler.js';

const log = createLogger('worker:discover');

/**
 * Resolve the adapter for a retailer. Seeded retailers ship a hand-written
 * adapter; self-serve (user-onboarded) retailers have none, so we build a
 * generic sitemap adapter from their auto-discovered crawl config and register
 * it once — no worker redeploy required.
 */
function resolveAdapter(retailer: RetailerRow): RetailerAdapter | undefined {
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

  return new Worker<DiscoverJob>(
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
      const staticFetcher = fetcherFor('static');
      const browserFetcher =
        retailer.fetchStrategy === 'browser' ? (fetcherFor('browser') as BrowserFetcher) : null;
      const fetchText = async (url: string) => {
        const staticRes = await staticFetcher.fetch(url);
        if (staticRes.status >= 200 && staticRes.status < 300) return staticRes.html;
        if (browserFetcher) {
          const browserRes = await browserFetcher.fetch(url);
          return browserRes.status >= 200 && browserRes.status < 300 ? browserRes.html : null;
        }
        return null;
      };

      const fetchJson = async (url: string): Promise<unknown | null> => {
        if (retailerKey === 'sportchek' && browserFetcher) {
          const res = await browserFetcher.fetchJson(url, SPORTCHEK_API_HEADERS);
          if (res.status < 200 || res.status >= 300) {
            log.warn('sportchek API fetch failed', { url, status: res.status });
            return null;
          }
          try {
            return JSON.parse(res.text) as unknown;
          } catch {
            log.warn('sportchek API returned non-JSON', { url });
            return null;
          }
        }
        const res = await fetch(url, { headers: SPORTCHEK_API_HEADERS });
        if (!res.ok) return null;
        return res.json() as Promise<unknown>;
      };

      const discoverCtx = { categoryFilter, limit, fetchText, fetchJson };

      if (adapter.discoverProducts) {
        for await (const raw of adapter.discoverProducts(discoverCtx)) {
          const { retailerProductId } = await ingestExtractedProduct(retailer.id, raw);
          await queues.match().add('match', { retailerProductId });
          discovered += 1;
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
    { connection: redisConnection(), concurrency: 1 },
  );
}
