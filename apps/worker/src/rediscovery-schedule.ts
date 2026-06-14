import { db, schema, eq, and, lt, or, isNull } from '@retailer/db';
import { queues } from '@retailer/jobs';
import { createLogger } from '@retailer/core';

const log = createLogger('worker:rediscovery-schedule');

const UNHEALTHY_SCORE = 0.5;
const REDISCOVER_COOLDOWN_DAYS = 7;

/** Deterministic jitter 0–3599 seconds from retailer key. */
export function rediscoverJitterSeconds(retailerKey: string): number {
  let hash = 0;
  for (let i = 0; i < retailerKey.length; i++) {
    hash = (hash * 31 + retailerKey.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 3600;
}

/** Retailers eligible for scheduled rediscovery. */
export async function findRediscoveryCandidates(): Promise<
  Array<{ key: string; crawlHealthScore: number | null }>
> {
  const cutoff = new Date(Date.now() - REDISCOVER_COOLDOWN_DAYS * 86_400_000);
  const rows = await db
    .select({
      key: schema.retailers.key,
      crawlHealthScore: schema.retailers.crawlHealthScore,
    })
    .from(schema.retailers)
    .where(
      and(
        eq(schema.retailers.enabled, true),
        lt(schema.retailers.crawlHealthScore, UNHEALTHY_SCORE),
        or(
          isNull(schema.retailers.lastRediscoveryAt),
          lt(schema.retailers.lastRediscoveryAt, cutoff),
        ),
      ),
    );
  return rows;
}

/** Enqueue weekly rediscovery jobs with staggered delays. */
export async function enqueueWeeklyRediscovery(): Promise<number> {
  const candidates = await findRediscoveryCandidates();
  let enqueued = 0;

  for (const retailer of candidates) {
    const delayMs = rediscoverJitterSeconds(retailer.key) * 1000;
    await queues.rediscover().add(
      'rediscover',
      {
        retailerKey: retailer.key,
        reason: 'weekly_unhealthy_schedule',
        preserveEndpoints: true,
      },
      {
        jobId: `rediscover:${retailer.key}`,
        delay: delayMs,
      },
    );
    enqueued++;
  }

  log.info('weekly rediscovery fan-out', { candidates: candidates.length, enqueued });
  return enqueued;
}
