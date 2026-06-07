/**
 * Obliterate fetch/extract/match queues (drops all pending product jobs).
 * Discover queues and cron schedules are left intact.
 */
import '../load-env.js';
import { getQueue, redisConnection } from '@retailer/jobs';
import { QueueName } from '@retailer/schema';

const PIPELINE = [QueueName.Fetch, QueueName.Extract, QueueName.Match] as const;

async function main(): Promise<void> {
  for (const name of PIPELINE) {
    const queue = getQueue(name);
    const counts = await queue.getJobCounts();
    await queue.obliterate({ force: true });
    console.log(`obliterated ${name}`, counts);
    await queue.close();
  }
  await redisConnection().quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
