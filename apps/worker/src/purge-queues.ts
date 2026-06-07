/**
 * Wipe all BullMQ queues (waiting, active, delayed, completed, failed, repeatable).
 * Run with workers stopped: pnpm --filter @retailer/worker purge-queues
 */
import './load-env.js';
import { QueueName } from '@retailer/schema';
import { getQueue, redisConnection } from '@retailer/jobs';

const ALL_QUEUES = Object.values(QueueName);

async function main(): Promise<void> {
  const redis = redisConnection();

  for (const name of ALL_QUEUES) {
    const queue = getQueue(name);
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'paused',
      'completed',
      'failed',
      'prioritized',
    );
    await queue.obliterate({ force: true });
    console.log(`obliterated ${name}`, counts);
    await queue.close();
  }

  // Repeatable job schedulers live under bull: meta keys too
  const repeatKeys = await redis.keys('bull:*:repeat*');
  if (repeatKeys.length) {
    await redis.del(...repeatKeys);
    console.log(`deleted ${repeatKeys.length} repeat meta key(s)`);
  }

  await redis.quit();
  console.log('all queues purged');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
