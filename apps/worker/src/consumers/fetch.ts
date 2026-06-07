import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger, serverEnv } from '@retailer/core';
import { db, schema, eq, sql } from '@retailer/db';
import { RateLimiter, RetryAfterError, isAllowed, storeSnapshot } from '@retailer/crawler';
import { recordSnapshot } from '@retailer/pipeline';
import { QueueName, type FetchJob } from '@retailer/schema';
import { getRetailer } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { storeLocalSnapshot } from '../local-snapshots.js';
import { tryFinalizeCrawlRun } from '../crawl-run.js';

const log = createLogger('worker:fetch');

/**
 * Fetch a single product URL (respecting robots + per-host throttle), snapshot
 * the HTML to Blob, and enqueue an extract job.
 */
export function startFetchWorker(): Worker<FetchJob> {
  const limiters = new Map<string, RateLimiter>();

  const worker = new Worker<FetchJob>(
    QueueName.Fetch,
    async (job: Job<FetchJob>) => {
      const { retailerKey, url, crawlRunId } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);

      if (retailer.respectRobotsTxt && !(await isAllowed(url))) {
        log.warn('blocked by robots.txt', { url });
        return;
      }

      let limiter = limiters.get(retailerKey);
      if (!limiter) {
        limiter = new RateLimiter(retailer.requestDelayMs);
        limiters.set(retailerKey, limiter);
      }
      await limiter.wait(new URL(url).host);

      const fetcher = fetcherFor(retailer.fetchStrategy);
      const result = await fetcher.fetch(url);

      // Rate-limited: back off harder than the default retry, then retry.
      if (result.status === 429) {
        log.warn('rate limited (429), backing off', { url });
        throw new RetryAfterError(`429 for ${url}`, Math.max(retailer.requestDelayMs * 10, 30_000));
      }

      if (result.status >= 400 || result.html.length < 200) {
        await db
          .update(schema.crawlRuns)
          .set({ errorCount: sql`${schema.crawlRuns.errorCount} + 1` })
          .where(eq(schema.crawlRuns.id, crawlRunId));
        throw new Error(`fetch failed ${result.status} for ${url}`);
      }

      const snapshot = await storeSnapshot(retailerKey, result.html);
      if (!snapshot.url) {
        await storeLocalSnapshot(snapshot.blobKey, result.html);
      }
      await recordSnapshot({
        retailerId: retailer.id,
        url,
        blobKey: snapshot.blobKey,
        contentHash: snapshot.contentHash,
        httpStatus: result.status,
      });

      await db
        .update(schema.crawlRuns)
        .set({ urlsFetched: sql`${schema.crawlRuns.urlsFetched} + 1` })
        .where(eq(schema.crawlRuns.id, crawlRunId));

      await queues.extract().add('extract', {
        retailerKey,
        url,
        snapshotKey: snapshot.blobKey,
        snapshotUrl: snapshot.url,
        crawlRunId,
      });
    },
    {
      connection: redisConnection(),
      concurrency: serverEnv().CRAWLER_MAX_CONCURRENCY,
    },
  );

  worker.on('failed', async (job) => {
    const crawlRunId = job?.data.crawlRunId;
    if (!crawlRunId) return;
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      await tryFinalizeCrawlRun(crawlRunId);
    }
  });

  return worker;
}
