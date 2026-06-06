import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, sql } from '@retailer/db';
import { extractProduct, getAdapter, loadSnapshot } from '@retailer/crawler';
import { ingestExtractedProduct } from '@retailer/pipeline';
import { QueueName, type ExtractJob } from '@retailer/schema';
import { getRetailer } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { loadLocalSnapshot } from '../local-snapshots.js';

const log = createLogger('worker:extract');

/**
 * Extract structured product data from a stored snapshot (re-fetching live as a
 * fallback when Blob is unconfigured), ingest it, then enqueue a match job.
 */
export function startExtractWorker(): Worker<ExtractJob> {
  return new Worker<ExtractJob>(
    QueueName.Extract,
    async (job: Job<ExtractJob>) => {
      const { retailerKey, url, snapshotUrl, crawlRunId } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);
      const adapter = getAdapter(retailerKey);

      let html: string;
      if (snapshotUrl) {
        html = await loadSnapshot(snapshotUrl);
      } else {
        const { snapshotKey } = job.data;
        const local = await loadLocalSnapshot(snapshotKey);
        html = local ?? (await fetcherFor(retailer.fetchStrategy).fetch(url)).html;
      }

      const raw = await extractProduct(html, url, retailerKey, {
        custom: adapter?.parseProduct?.bind(adapter),
        // Adapter parsers are authoritative — skip rate-limited LLM fallback.
        allowLlm: !adapter?.parseProduct,
      });
      if (!raw) {
        log.warn('no product extracted', { url });
        return;
      }

      const { retailerProductId } = await ingestExtractedProduct(retailer.id, raw);

      await db
        .update(schema.crawlRuns)
        .set({ productsExtracted: sql`${schema.crawlRuns.productsExtracted} + 1` })
        .where(eq(schema.crawlRuns.id, crawlRunId));

      await queues.match().add('match', { retailerProductId });
    },
    { connection: redisConnection(), concurrency: 4 },
  );
}
