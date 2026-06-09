import type { CrawlRecipe, RetailerFingerprint } from '@retailer/schema';
import { eq, sql } from 'drizzle-orm';
import { db, type Database } from './client';
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

type DbExecutor = Pick<Database, 'insert' | 'update' | 'select'>;

/** Insert an immutable recipe version and update denormalized retailer columns. */
export async function writeRecipeVersion(
  params: WriteRecipeVersionParams,
  tx: DbExecutor = db,
): Promise<number> {
  const [{ maxVersion } = { maxVersion: 0 }] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${schema.retailerRecipeVersions.version}), 0)` })
    .from(schema.retailerRecipeVersions)
    .where(eq(schema.retailerRecipeVersions.retailerId, params.retailerId));

  const version = (maxVersion ?? 0) + 1;
  const primaryEndpoint = primaryEndpointFromRecipe(params.crawlRecipe);
  const isFirstVersion = version === 1;

  await tx.insert(schema.retailerRecipeVersions).values({
    retailerId: params.retailerId,
    version,
    crawlRecipe: params.crawlRecipe,
    fingerprint: params.fingerprint ?? null,
    validationReport: params.validationReport ?? null,
    confidence: params.confidence,
    primaryEndpoint,
    createdBy: params.createdBy,
  });

  await tx
    .update(schema.retailers)
    .set({
      crawlRecipe: params.crawlRecipe,
      fingerprint: params.fingerprint ?? null,
      discoveryConfidence: params.confidence,
      ...(isFirstVersion ? { crawlHealthScore: 1 } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.retailers.id, params.retailerId));

  return version;
}

export interface PromoteRetailerRecipeParams extends WriteRecipeVersionParams {
  /** When set, updates an existing retailer row inside the same transaction. */
  retailerUpdate?: {
    fetchStrategy?: (typeof schema.retailers.$inferSelect)['fetchStrategy'];
    productUrlPattern?: string | null;
    discoveryNotes?: string | null;
  };
}

/** Atomically persist retailer recipe fields and an immutable version row. */
export async function promoteRetailerRecipe(params: PromoteRetailerRecipeParams): Promise<number> {
  return db.transaction(async (tx) => {
    if (params.retailerUpdate) {
      await tx
        .update(schema.retailers)
        .set({
          ...params.retailerUpdate,
          updatedAt: new Date(),
        })
        .where(eq(schema.retailers.id, params.retailerId));
    }
    return writeRecipeVersion(params, tx);
  });
}
