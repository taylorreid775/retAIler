/**
 * Stop a retailer crawl: remove pending fetch/extract/match jobs and close the run.
 * usage: cancel-crawl.ts <retailerKey> [crawlRunId]
 */
import '../load-env.js';
import { getQueue, redisConnection } from '@retailer/jobs';
import { QueueName } from '@retailer/schema';
import { db, schema, eq, and, desc } from '@retailer/db';

const retailerKey = process.argv[2];
const crawlRunIdArg = process.argv[3];

if (!retailerKey) {
  console.error('usage: cancel-crawl.ts <retailerKey> [crawlRunId]');
  process.exit(1);
}

const JOB_QUEUES = [QueueName.Fetch, QueueName.Extract, QueueName.Match] as const;

async function removeMatchingJobs(
  queueName: (typeof JOB_QUEUES)[number],
  crawlRunId: string | null,
): Promise<number> {
  const queue = getQueue(queueName);
  let removed = 0;
  for (const state of ['waiting', 'delayed', 'paused', 'prioritized'] as const) {
    const jobs = await queue.getJobs(state, 0, 5000);
    for (const job of jobs) {
      const data = job.data as { retailerKey?: string; crawlRunId?: string };
      const matchRun = crawlRunId && data.crawlRunId === crawlRunId;
      const matchKey = data.retailerKey === retailerKey;
      if (!matchRun && !matchKey) continue;
      if (crawlRunId && data.crawlRunId && data.crawlRunId !== crawlRunId) continue;
      try {
        await job.remove();
        removed += 1;
      } catch {
        // active jobs may refuse removal
      }
    }
  }
  await queue.close();
  return removed;
}

async function main(): Promise<void> {
  const [retailer] = await db
    .select()
    .from(schema.retailers)
    .where(eq(schema.retailers.key, retailerKey));
  if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);

  let crawlRunId = crawlRunIdArg;
  if (!crawlRunId) {
    const [run] = await db
      .select({ id: schema.crawlRuns.id })
      .from(schema.crawlRuns)
      .where(
        and(
          eq(schema.crawlRuns.retailerId, retailer.id),
          eq(schema.crawlRuns.status, 'running'),
        ),
      )
      .orderBy(desc(schema.crawlRuns.startedAt))
      .limit(1);
    crawlRunId = run?.id;
  }

  let totalRemoved = 0;
  for (const name of JOB_QUEUES) {
    const n = await removeMatchingJobs(name, crawlRunId ?? null);
    console.log(`removed ${n} from ${name}`);
    totalRemoved += n;
  }

  if (crawlRunId) {
    await db
      .update(schema.crawlRuns)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(schema.crawlRuns.id, crawlRunId));
    console.log('marked crawl run failed', crawlRunId);
  }

  await redisConnection().quit();
  console.log('done', { retailerKey, crawlRunId, totalRemoved });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
