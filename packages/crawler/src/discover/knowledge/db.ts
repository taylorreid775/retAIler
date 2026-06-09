import { db, schema, eq, and, desc } from '@retailer/db';

/** Markdown knowledge docs keyed by filename (machine-readable DB storage). */
export type KnowledgeDocMap = Record<string, string>;

const KNOWLEDGE_DOC_KEYS = [
  'retailer-profile.md',
  'endpoint-analysis.md',
  'crawl-strategy.md',
  'validation-report.md',
  'known-issues.md',
  'CHANGELOG.md',
] as const;

export function knowledgeDocsFromValidationReport(
  validationReport: unknown,
): KnowledgeDocMap | null {
  if (!validationReport || typeof validationReport !== 'object') return null;
  const docs = (validationReport as { knowledgeDocs?: KnowledgeDocMap }).knowledgeDocs;
  if (!docs || typeof docs !== 'object') return null;
  const hasContent = KNOWLEDGE_DOC_KEYS.some((key) => typeof docs[key] === 'string' && docs[key].length > 0);
  return hasContent ? docs : null;
}

/** Merge knowledge docs into an existing validation_report JSON blob. */
export function mergeKnowledgeIntoValidationReport(
  validationReport: unknown,
  knowledgeDocs: KnowledgeDocMap,
): Record<string, unknown> {
  const base =
    validationReport && typeof validationReport === 'object'
      ? { ...(validationReport as Record<string, unknown>) }
      : {};
  return { ...base, knowledgeDocs };
}

/** Persist knowledge docs on the matching recipe version row (Postgres source of truth). */
export async function persistKnowledgeDocs(
  retailerId: string,
  recipeVersion: number,
  knowledgeDocs: KnowledgeDocMap,
): Promise<void> {
  const [row] = await db
    .select({ validationReport: schema.retailerRecipeVersions.validationReport })
    .from(schema.retailerRecipeVersions)
    .where(
      and(
        eq(schema.retailerRecipeVersions.retailerId, retailerId),
        eq(schema.retailerRecipeVersions.version, recipeVersion),
      ),
    );

  const merged = mergeKnowledgeIntoValidationReport(row?.validationReport ?? null, knowledgeDocs);

  await db
    .update(schema.retailerRecipeVersions)
    .set({ validationReport: merged })
    .where(
      and(
        eq(schema.retailerRecipeVersions.retailerId, retailerId),
        eq(schema.retailerRecipeVersions.version, recipeVersion),
      ),
    );
}

/** Load knowledge docs from the latest recipe version for a retailer key. */
export async function loadKnowledgeDocsFromDb(
  retailerKey: string,
): Promise<{ exists: boolean; docs: KnowledgeDocMap }> {
  const [row] = await db
    .select({
      validationReport: schema.retailerRecipeVersions.validationReport,
    })
    .from(schema.retailerRecipeVersions)
    .innerJoin(schema.retailers, eq(schema.retailerRecipeVersions.retailerId, schema.retailers.id))
    .where(eq(schema.retailers.key, retailerKey))
    .orderBy(desc(schema.retailerRecipeVersions.version))
    .limit(1);

  const docs = knowledgeDocsFromValidationReport(row?.validationReport ?? null);
  if (!docs) return { exists: false, docs: {} };
  return { exists: true, docs };
}
