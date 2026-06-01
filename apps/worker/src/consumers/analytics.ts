import { Worker, type Job, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { runAnalytics } from '@retailer/analytics';
import { QueueName, type AnalyticsJob } from '@retailer/schema';

const log = createLogger('worker:analytics');

/** Runs the signal computations for a window (typically scheduled daily). */
export function startAnalyticsWorker(): Worker<AnalyticsJob> {
  return new Worker<AnalyticsJob>(
    QueueName.Analytics,
    async (job: Job<AnalyticsJob>) => {
      const summary = await runAnalytics(job.data.windowDays);
      log.info('analytics job done', summary);
    },
    { connection: redisConnection(), concurrency: 1 },
  );
}
