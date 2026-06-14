'use server';

import { revalidatePath } from 'next/cache';
import { db, schema, eq, desc, rollbackRecipeVersion } from '@retailer/db';
import { assertOpsAccess } from '@/lib/ops-auth';

export interface RecipeVersionRow {
  version: number;
  confidence: number;
  primaryEndpoint: string;
  createdBy: string;
  createdAt: string;
}

export async function listRecipeVersions(
  retailerId: string,
): Promise<{ error?: string; versions?: RecipeVersionRow[] }> {
  const access = await assertOpsAccess();
  if ('error' in access) return { error: access.error };

  const rows = await db
    .select({
      version: schema.retailerRecipeVersions.version,
      confidence: schema.retailerRecipeVersions.confidence,
      primaryEndpoint: schema.retailerRecipeVersions.primaryEndpoint,
      createdBy: schema.retailerRecipeVersions.createdBy,
      createdAt: schema.retailerRecipeVersions.createdAt,
    })
    .from(schema.retailerRecipeVersions)
    .where(eq(schema.retailerRecipeVersions.retailerId, retailerId))
    .orderBy(desc(schema.retailerRecipeVersions.version))
    .limit(10);

  return {
    versions: rows.map((r) => ({
      version: r.version,
      confidence: r.confidence,
      primaryEndpoint: r.primaryEndpoint,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function rollbackToRecipeVersion(
  retailerId: string,
  targetVersion: number,
): Promise<{ error?: string; newVersion?: number }> {
  const access = await assertOpsAccess();
  if ('error' in access) return { error: access.error };

  try {
    const result = await rollbackRecipeVersion({ retailerId, targetVersion });
    revalidatePath('/status');
    return { newVersion: result.newVersion };
  } catch (err) {
    return { error: String(err) };
  }
}
