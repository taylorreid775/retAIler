import 'dotenv/config';
import { queues } from '@retailer/jobs';
import { db, schema, eq } from '@retailer/db';
import { createLogger } from '@retailer/core';

const log = createLogger('worker:enqueue');

/**
 * CLI: kick off a crawl run for a retailer.
 *   pnpm --filter @retailer/worker enqueue sportchek [categoryFilter...]
 */
async function main() {
  const [retailerKey, ...categoryFilter] = process.argv.slice(2);
  if (!retailerKey) {
    // eslint-disable-next-line no-console
    console.error('usage: enqueue <retailerKey> [categoryFilter...]');
    process.exit(1);
  }

  const [retailer] = await db
    .select()
    .from(schema.retailers)
    .where(eq(schema.retailers.key, retailerKey));
  if (!retailer) throw new Error(`unknown retailer ${retailerKey} (did you run db:seed?)`);

  const [run] = await db
    .insert(schema.crawlRuns)
    .values({ retailerId: retailer.id, status: 'queued' })
    .returning({ id: schema.crawlRuns.id });
  if (!run) throw new Error('failed to create crawl run');

  await queues.discover().add('discover', {
    retailerKey,
    crawlRunId: run.id,
    categoryFilter: categoryFilter.length ? categoryFilter : undefined,
  });

  log.info('enqueued crawl run', { retailerKey, crawlRunId: run.id });
  process.exit(0);
}

main().catch((err) => {
  log.error('enqueue failed', { err: String(err) });
  process.exit(1);
});
