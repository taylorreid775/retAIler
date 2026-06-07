import { Worker, type Job, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { matchRetailerProduct } from '@retailer/pipeline';
import { QueueName, type MatchJob } from '@retailer/schema';

const log = createLogger('worker:match');

/**
 * Match a freshly ingested retailer product to a canonical product (or seed a
 * new one / queue for review). Low concurrency: each match may call the LLM.
 */
export function startMatchWorker(): Worker<MatchJob> {
  return new Worker<MatchJob>(
    QueueName.Match,
    async (job: Job<MatchJob>) => {
      const outcome = await matchRetailerProduct(job.data.retailerProductId);
      log.debug('match outcome', outcome);
    },
    { connection: redisConnection(), concurrency: 4 },
  );
}
