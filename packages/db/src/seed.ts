import './load-env.js';
import { SPORTCHEK_CRAWL_RECIPE } from '@retailer/schema';
import { db, queryClient } from './client';
import { retailers } from './schema';
import { eq } from 'drizzle-orm';

/**
 * Seed the three independent Canadian sporting-goods retailers.
 * Canadian Tire (and its Atmosphere banner) are intentionally excluded
 * because Canadian Tire owns Sport Chek — they don't truly compete.
 */
const SEED_RETAILERS = [
  {
    key: 'sportchek',
    name: 'Sport Chek',
    domain: 'www.sportchek.ca',
    fetchStrategy: 'browser' as const,
    requestDelayMs: 2500,
  },
  {
    key: 'mec',
    name: 'MEC',
    domain: 'www.mec.ca',
    fetchStrategy: 'browser' as const,
    requestDelayMs: 2500,
  },
  {
    key: 'sportinglife',
    name: 'Sporting Life',
    domain: 'www.sportinglife.ca',
    fetchStrategy: 'browser' as const,
    requestDelayMs: 2000,
  },
  {
    key: 'decathlon',
    name: 'Decathlon',
    domain: 'www.decathlon.ca',
    fetchStrategy: 'static' as const,
    requestDelayMs: 2000,
  },
];

async function main() {
  // eslint-disable-next-line no-console
  console.log('[db] seeding retailers…');
  for (const r of SEED_RETAILERS) {
    await db
      .insert(retailers)
      .values({
        key: r.key,
        name: r.name,
        domain: r.domain,
        country: 'CA',
        fetchStrategy: r.fetchStrategy,
        requestDelayMs: r.requestDelayMs,
        maxConcurrency: 2,
        respectRobotsTxt: true,
        enabled: true,
      })
      .onConflictDoNothing({ target: retailers.key });
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${r.name}`);
  }
  await queryClient.end();
  await db
    .update(retailers)
    .set({ crawlRecipe: SPORTCHEK_CRAWL_RECIPE })
    .where(eq(retailers.key, 'sportchek'));
  // eslint-disable-next-line no-console
  console.log('  ✓ Sport Chek API crawl recipe');

  // eslint-disable-next-line no-console
  console.log('[db] seed complete');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
