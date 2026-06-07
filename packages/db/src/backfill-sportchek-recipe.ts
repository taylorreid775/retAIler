import './load-env.js';
import { SPORTCHEK_CRAWL_RECIPE } from '@retailer/schema';
import { db, queryClient } from './client';
import { retailers } from './schema';
import { eq } from 'drizzle-orm';

await db
  .update(retailers)
  .set({ crawlRecipe: SPORTCHEK_CRAWL_RECIPE })
  .where(eq(retailers.key, 'sportchek'));

// eslint-disable-next-line no-console
console.log('backfilled sportchek crawl_recipe');
await queryClient.end();
