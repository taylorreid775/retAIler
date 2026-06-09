import './load-env.js';
import { db, queryClient } from './client';
import { retailers, retailerRecipeVersions } from './schema';
import { sql, eq } from 'drizzle-orm';

const rows = await db
  .select({
    id: retailers.id,
    crawlRecipe: retailers.crawlRecipe,
    discoveryConfidence: retailers.discoveryConfidence,
  })
  .from(retailers)
  .where(sql`${retailers.crawlRecipe} IS NOT NULL`);

let inserted = 0;
for (const row of rows) {
  if (!row.crawlRecipe) continue;

  const [existing] = await db
    .select({ id: retailerRecipeVersions.id })
    .from(retailerRecipeVersions)
    .where(eq(retailerRecipeVersions.retailerId, row.id))
    .limit(1);
  if (existing) continue;

  const confidence = row.discoveryConfidence ?? row.crawlRecipe.confidence ?? 0;
  const primaryEndpoint =
    row.crawlRecipe.api?.baseUrl ??
    row.crawlRecipe.sitemapUrls[0] ??
    row.crawlRecipe.sampleProductUrls[0] ??
    'unknown';

  await db.insert(retailerRecipeVersions).values({
    retailerId: row.id,
    version: 1,
    crawlRecipe: row.crawlRecipe,
    fingerprint: null,
    validationReport: null,
    confidence,
    primaryEndpoint,
    createdBy: 'discovery',
  });
  inserted++;
}

// eslint-disable-next-line no-console
console.log(`backfilled ${inserted} retailer_recipe_versions row(s)`);
await queryClient.end();
