import { queues } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq } from '@retailer/db';

const log = createLogger('worker:crawl-health-enqueue');

const TERMINAL_STATUSES = ['completed', 'failed'] as const;

/** Enqueue post-crawl health evaluation once a crawl run reaches a terminal state. */
export async function enqueueCrawlHealth(crawlRunId: string): Promise<void> {
  const [row] = await db
    .select({
      status: schema.crawlRuns.status,
      retailerKey: schema.retailers.key,
    })
    .from(schema.crawlRuns)
    .innerJoin(schema.retailers, eq(schema.crawlRuns.retailerId, schema.retailers.id))
    .where(eq(schema.crawlRuns.id, crawlRunId));

  if (!row || !TERMINAL_STATUSES.includes(row.status as (typeof TERMINAL_STATUSES)[number])) {
    return;
  }

  await queues.crawlHealth().add(
    'evaluate',
    { retailerKey: row.retailerKey, crawlRunId },
    { jobId: `health:${crawlRunId}` },
  );

  log.info('enqueued crawl health job', {
    crawlRunId,
    retailerKey: row.retailerKey,
    status: row.status,
  });
}
