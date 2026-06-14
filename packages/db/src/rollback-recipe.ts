import type { CrawlRecipe, RetailerFingerprint } from '@retailer/schema';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { writeRecipeVersion } from './recipe-versions';
import * as schema from './schema';

export interface RollbackRecipeVersionParams {
  retailerId: string;
  targetVersion: number;
}

export interface RollbackRecipeVersionResult {
  newVersion: number;
  crawlRecipe: CrawlRecipe;
  fingerprint: RetailerFingerprint | null;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function endpointTypeFromRecipe(recipe: CrawlRecipe): string {
  if (recipe.api?.baseUrl.includes('/search')) return 'search';
  return 'catalog';
}

async function syncRetailerEndpointsFromRecipeTx(
  tx: DbTx,
  retailerId: string,
  recipe: CrawlRecipe,
  validationReport: unknown,
): Promise<void> {
  await tx
    .update(schema.retailerEndpoints)
    .set({ active: false })
    .where(eq(schema.retailerEndpoints.retailerId, retailerId));

  const api = recipe.api;
  if (!api) return;

  const reliability =
    validationReport &&
    typeof validationReport === 'object' &&
    'reliability' in validationReport &&
    typeof (validationReport as { reliability?: unknown }).reliability === 'number'
      ? ((validationReport as { reliability: number }).reliability as number)
      : null;

  const now = new Date();
  await tx
    .insert(schema.retailerEndpoints)
    .values({
      retailerId,
      endpointType: endpointTypeFromRecipe(recipe),
      url: api.baseUrl,
      method: api.method,
      headers: api.headers ?? {},
      paginationStyle: api.pagination.style,
      reliabilityScore: reliability,
      lastValidatedAt: now,
      lastSuccessAt: now,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.retailerEndpoints.retailerId,
        schema.retailerEndpoints.url,
        schema.retailerEndpoints.method,
      ],
      set: {
        endpointType: endpointTypeFromRecipe(recipe),
        headers: api.headers ?? {},
        paginationStyle: api.pagination.style,
        reliabilityScore: reliability,
        lastValidatedAt: now,
        lastSuccessAt: now,
        active: true,
      },
    });
}

/**
 * Restore a prior recipe version as the active retailer config.
 * Creates a new immutable version row for audit (does not mutate history).
 */
export async function rollbackRecipeVersion(
  params: RollbackRecipeVersionParams,
): Promise<RollbackRecipeVersionResult> {
  const [target] = await db
    .select()
    .from(schema.retailerRecipeVersions)
    .where(
      and(
        eq(schema.retailerRecipeVersions.retailerId, params.retailerId),
        eq(schema.retailerRecipeVersions.version, params.targetVersion),
      ),
    );
  if (!target) {
    throw new Error(`recipe version ${params.targetVersion} not found for retailer`);
  }

  const newVersion = await db.transaction(async (tx) => {
    const version = await writeRecipeVersion(
      {
        retailerId: params.retailerId,
        crawlRecipe: target.crawlRecipe,
        fingerprint: target.fingerprint,
        confidence: target.confidence,
        validationReport: target.validationReport,
        createdBy: 'manual',
      },
      tx,
    );

    await tx
      .update(schema.retailers)
      .set({
        crawlRecipe: target.crawlRecipe,
        fingerprint: target.fingerprint,
        discoveryConfidence: target.confidence,
        updatedAt: new Date(),
      })
      .where(eq(schema.retailers.id, params.retailerId));

    await syncRetailerEndpointsFromRecipeTx(
      tx,
      params.retailerId,
      target.crawlRecipe,
      target.validationReport,
    );

    return version;
  });

  return {
    newVersion,
    crawlRecipe: target.crawlRecipe,
    fingerprint: target.fingerprint ?? null,
  };
}
