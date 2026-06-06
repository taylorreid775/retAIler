import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq } from '@retailer/db';
import { getAdapter, isAllowed } from '@retailer/crawler';
import { QueueName, type DiscoverJob } from '@retailer/schema';
import { getRetailer } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { SCHEDULED_RUN_SENTINEL } from '../scheduler.js';

const log = createLogger('worker:discover');

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
      const adapter = getAdapter(retailerKey);
      const retailer = await getRetailer(retailerKey);
      if (!adapter || !retailer) throw new Error(`unknown retailer ${retailerKey}`);
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
        retailer.fetchStrategy === 'browser' ? fetcherFor('browser') : null;
      const fetchText = async (url: string) => {
        const staticRes = await staticFetcher.fetch(url);
        if (staticRes.status >= 200 && staticRes.status < 300) return staticRes.html;
        if (browserFetcher) {
          const browserRes = await browserFetcher.fetch(url);
          return browserRes.status >= 200 && browserRes.status < 300 ? browserRes.html : null;
        }
        return null;
      };

      for await (const url of adapter.discoverProductUrls({
        categoryFilter,
        limit,
        fetchText,
      })) {
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
      log.info('discovery complete', { retailerKey, discovered });
    },
    { connection: redisConnection(), concurrency: 1 },
  );
}
