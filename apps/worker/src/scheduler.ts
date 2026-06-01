import { db, schema, eq } from '@retailer/db';
import { queues } from '@retailer/jobs';
import { QueueName } from '@retailer/schema';
import { createLogger } from '@retailer/core';

const log = createLogger('worker:scheduler');

/**
 * Register repeatable jobs:
 *  - per-retailer scheduled crawls (cron from the retailer's crawl policy)
 *  - a daily analytics pass.
 * Idempotent: BullMQ dedupes repeatable jobs by name + pattern.
 */
export async function registerSchedules(): Promise<void> {
  const rows = await db.select().from(schema.retailers).where(eq(schema.retailers.enabled, true));

  for (const r of rows) {
    // The discover consumer creates a fresh crawl run when it sees the
    // sentinel id, so each scheduled fire starts a new run.
    await queues.discover().add(
      `scheduled:${r.key}`,
      { retailerKey: r.key, crawlRunId: SCHEDULED_RUN_SENTINEL },
      { repeat: { pattern: r.crawlSchedule }, jobId: `cron:${r.key}` },
    );
    log.info('scheduled crawl', { retailer: r.key, cron: r.crawlSchedule });
  }

  await queues.analytics().add(
    'daily',
    { windowDays: 1 },
    { repeat: { pattern: '0 7 * * *' }, jobId: 'cron:analytics' },
  );
  log.info('scheduled analytics', { queue: QueueName.Analytics });

  // Weekly report fan-out: Monday 08:00. The reports consumer resolves the
  // sentinel orgId into per-org jobs. periodStart/End are recomputed per fire.
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  await queues.reports().add(
    'weekly-fanout',
    {
      orgId: REPORTS_FANOUT_SENTINEL,
      periodStart: weekAgo,
      periodEnd: now,
    },
    { repeat: { pattern: '0 8 * * 1' }, jobId: 'cron:reports' },
  );
  log.info('scheduled weekly reports', { queue: QueueName.Reports });
}

export const REPORTS_FANOUT_SENTINEL = '00000000-0000-0000-0000-000000000000';

/** Sentinel crawlRunId meaning "create a fresh run on consume". */
export const SCHEDULED_RUN_SENTINEL = '00000000-0000-0000-0000-000000000000';
