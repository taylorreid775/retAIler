import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { QueueName, type RediscoverJob } from '@retailer/schema';
import { getRetailer } from '../retailers.js';
import { enqueueWeeklyRediscovery } from '../rediscovery-schedule.js';

const log = createLogger('worker:discover-rediscover');

export const REDISCOVER_FANOUT_SENTINEL = '__fanout__';

export function startDiscoverRediscoverWorker(): Worker<RediscoverJob> {
  return new Worker<RediscoverJob>(
    QueueName.Rediscover,
    async (job: Job<RediscoverJob>) => {
      if (job.data.retailerKey === REDISCOVER_FANOUT_SENTINEL) {
        const count = await enqueueWeeklyRediscovery();
        log.info('weekly rediscovery fan-out complete', { enqueued: count });
        return;
      }

      const { retailerKey, reason, preserveEndpoints } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);
      if (!retailer.enabled) {
        log.info('skipping rediscover for disabled retailer', { retailerKey });
        return;
      }

      await queues.discoverConfig().add(
        'rediscover',
        {
          rediscover: { retailerKey, reason, preserveEndpoints },
        },
        { jobId: `rediscover-config:${retailerKey}` },
      );

      log.info('enqueued rediscover via discover-config', { retailerKey, reason });
    },
    { connection: redisConnection(), concurrency: 1 },
  );
}
