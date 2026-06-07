import { queues } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, and } from '@retailer/db';

const log = createLogger('worker:crawl-run');

/** True when no fetch/extract jobs remain for this crawl run. */
async function hasPendingPipelineJobs(crawlRunId: string): Promise<boolean> {
  const states = ['waiting', 'active', 'delayed'] as const;
  for (const state of states) {
    const fetchJobs = await queues.fetch().getJobs(state, 0, 500);
    if (fetchJobs.some((j) => j.data.crawlRunId === crawlRunId)) return true;
    const extractJobs = await queues.extract().getJobs(state, 0, 500);
    if (extractJobs.some((j) => j.data.crawlRunId === crawlRunId)) return true;
  }
  return false;
}

/**
 * Mark a URL-discovery crawl run completed once every enqueued fetch has
 * either extracted or exhausted retries. Safe to call after each fetch/extract.
 */
export async function tryFinalizeCrawlRun(crawlRunId: string): Promise<void> {
  const [run] = await db
    .select({
      status: schema.crawlRuns.status,
      urlsDiscovered: schema.crawlRuns.urlsDiscovered,
    })
    .from(schema.crawlRuns)
    .where(eq(schema.crawlRuns.id, crawlRunId));

  if (!run || run.status !== 'running' || run.urlsDiscovered === 0) return;
  if (await hasPendingPipelineJobs(crawlRunId)) return;

  await db
    .update(schema.crawlRuns)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(and(eq(schema.crawlRuns.id, crawlRunId), eq(schema.crawlRuns.status, 'running')));

  log.info('crawl run completed', { crawlRunId });
}
