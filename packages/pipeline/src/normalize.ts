import { db, schema, eq, sql } from '@retailer/db';
import { slug } from '@retailer/schema';

/**
 * Resolve a raw brand string to a canonical brand id, creating the brand (and
 * recording the raw alias) on first sight. Alias table absorbs spelling/casing
 * variants across retailers ("The North Face" vs "North Face").
 */
export async function canonicalizeBrand(rawBrand: string | null): Promise<string | null> {
  if (!rawBrand) return null;
  const name = rawBrand.trim();
  if (!name) return null;
  const aliasKey = slug(name);

  const [existingAlias] = await db
    .select({ brandId: schema.brandAliases.brandId })
    .from(schema.brandAliases)
    .where(eq(schema.brandAliases.alias, aliasKey));
  if (existingAlias) return existingAlias.brandId;

  const brandSlug = slug(name);
  const [brand] = await db
    .insert(schema.brands)
    .values({ name, slug: brandSlug })
    .onConflictDoUpdate({ target: schema.brands.slug, set: { name } })
    .returning({ id: schema.brands.id });
  if (!brand) return null;

  await db
    .insert(schema.brandAliases)
    .values({ brandId: brand.id, alias: aliasKey })
    .onConflictDoNothing({ target: schema.brandAliases.alias });

  return brand.id;
}

/**
 * Map a raw breadcrumb path to a canonical category, creating the leaf (and any
 * missing ancestors implicitly via the materialized path). We also record the
 * retailer-specific raw → canonical mapping for assortment analytics.
 */
export async function canonicalizeCategory(
  retailerId: string,
  categoryPath: string[],
): Promise<string | null> {
  const cleaned = categoryPath.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const rawPath = cleaned.join(' / ');
  const [existingMap] = await db
    .select({ categoryId: schema.retailerCategories.categoryId })
    .from(schema.retailerCategories)
    .where(
      sql`${schema.retailerCategories.retailerId} = ${retailerId} AND ${schema.retailerCategories.rawPath} = ${rawPath}`,
    );
  if (existingMap?.categoryId) return existingMap.categoryId;

  // Build canonical category by materialized slug path.
  let parentId: string | null = null;
  let pathAcc = '';
  let leafId: string | null = null;
  for (let depth = 0; depth < cleaned.length; depth += 1) {
    const name = cleaned[depth]!;
    const seg = slug(name);
    pathAcc = pathAcc ? `${pathAcc}/${seg}` : seg;
    const [cat] = await db
      .insert(schema.categories)
      .values({ name, slug: seg, parentId, path: pathAcc, depth })
      .onConflictDoUpdate({ target: schema.categories.path, set: { name } })
      .returning({ id: schema.categories.id });
    if (!cat) break;
    parentId = cat.id;
    leafId = cat.id;
  }

  if (leafId) {
    await db
      .insert(schema.retailerCategories)
      .values({ retailerId, rawPath, categoryId: leafId })
      .onConflictDoNothing();
  }

  return leafId;
}
