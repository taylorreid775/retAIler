import '../load-env.js';
import { getQueue, redisConnection } from '@retailer/jobs';
import { QueueName } from '@retailer/schema';

async function main(): Promise<void> {
  const q = getQueue(QueueName.Discover);
  const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  console.log('discover counts', counts);
  for (const j of await q.getFailed(0, 10)) {
    console.log('failed', j.id, j.data, j.failedReason?.slice(0, 300));
  }
  for (const j of await q.getActive(0, 10)) {
    console.log('active', j.id, j.data, 'processedOn', j.processedOn, 'attempts', j.attemptsMade);
  }
  for (const j of await q.getWaiting(0, 10)) {
    console.log('waiting', j.id, j.data);
  }
  await q.close();
  await redisConnection().quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
