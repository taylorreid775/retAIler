import type { CrawlRecipe, RetailerFingerprint } from '@retailer/schema';
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import * as schema from './schema';

function primaryEndpointFromRecipe(recipe: CrawlRecipe): string {
  if (recipe.api?.baseUrl) return recipe.api.baseUrl;
  if (recipe.sitemapUrls[0]) return recipe.sitemapUrls[0];
  if (recipe.sampleProductUrls[0]) return recipe.sampleProductUrls[0];
  return 'unknown';
}

export interface WriteRecipeVersionParams {
  retailerId: string;
  crawlRecipe: CrawlRecipe;
  fingerprint?: RetailerFingerprint | null;
  confidence: number;
  createdBy: 'discovery' | 'repair' | 'manual';
  validationReport?: unknown;
}

/** Insert an immutable recipe version and update denormalized retailer columns. */
export async function writeRecipeVersion(params: WriteRecipeVersionParams): Promise<number> {
  const [{ maxVersion } = { maxVersion: 0 }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${schema.retailerRecipeVersions.version}), 0)` })
    .from(schema.retailerRecipeVersions)
    .where(eq(schema.retailerRecipeVersions.retailerId, params.retailerId));

  const version = (maxVersion ?? 0) + 1;
  const primaryEndpoint = primaryEndpointFromRecipe(params.crawlRecipe);

  await db.insert(schema.retailerRecipeVersions).values({
    retailerId: params.retailerId,
    version,
    crawlRecipe: params.crawlRecipe,
    fingerprint: params.fingerprint ?? null,
    validationReport: params.validationReport ?? null,
    confidence: params.confidence,
    primaryEndpoint,
    createdBy: params.createdBy,
  });

  await db
    .update(schema.retailers)
    .set({
      fingerprint: params.fingerprint ?? null,
      discoveryConfidence: params.confidence,
      crawlHealthScore: 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.retailers.id, params.retailerId));

  return version;
}
