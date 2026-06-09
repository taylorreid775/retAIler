import { type ListingPagination } from '@retailer/schema';
import { db, schema, eq, and } from '@retailer/db';
import type { CategoryDirectory as DiscoveredDirectory } from './category-directory';

export interface ListingPageRow {
  id: string;
  retailerId: string;
  url: string;
  label: string;
  parentId: string | null;
  pagination: ListingPagination | null;
  productUrlPattern: string | null;
  active: boolean;
}

/** Upsert category listing pages from AI discovery output. */
export async function saveListingPages(
  retailerId: string,
  directory: DiscoveredDirectory,
): Promise<void> {
  const nameToId = new Map<string, string>();
  const now = new Date();

  // First pass: upsert all rows without parent links
  for (const cat of directory.categories) {
    const [row] = await db
      .insert(schema.retailerListingPages)
      .values({
        retailerId,
        url: cat.url,
        label: cat.name,
        pagination: directory.pagination,
        productUrlPattern: directory.productUrlPattern,
        discoveredAt: now,
        active: true,
      })
      .onConflictDoUpdate({
        target: [schema.retailerListingPages.retailerId, schema.retailerListingPages.url],
        set: {
          label: cat.name,
          pagination: directory.pagination,
          productUrlPattern: directory.productUrlPattern,
          active: true,
        },
      })
      .returning({ id: schema.retailerListingPages.id });

    if (row) nameToId.set(cat.name, row.id);
  }

  // Second pass: wire parentId from parentName
  for (const cat of directory.categories) {
    if (!cat.parentName) continue;
    const childId = nameToId.get(cat.name);
    const parentId = nameToId.get(cat.parentName);
    if (!childId || !parentId) continue;
    await db
      .update(schema.retailerListingPages)
      .set({ parentId })
      .where(eq(schema.retailerListingPages.id, childId));
  }
}

/** Load active listing pages for a retailer. */
export async function loadListingPages(retailerId: string): Promise<ListingPageRow[]> {
  const rows = await db
    .select({
      id: schema.retailerListingPages.id,
      retailerId: schema.retailerListingPages.retailerId,
      url: schema.retailerListingPages.url,
      label: schema.retailerListingPages.label,
      parentId: schema.retailerListingPages.parentId,
      pagination: schema.retailerListingPages.pagination,
      productUrlPattern: schema.retailerListingPages.productUrlPattern,
      active: schema.retailerListingPages.active,
    })
    .from(schema.retailerListingPages)
    .where(
      and(
        eq(schema.retailerListingPages.retailerId, retailerId),
        eq(schema.retailerListingPages.active, true),
      ),
    );

  return rows;
}

/** Mark a listing page inactive after repeated empty crawls. */
export async function deactivateListingPage(listingPageId: string): Promise<void> {
  await db
    .update(schema.retailerListingPages)
    .set({ active: false })
    .where(eq(schema.retailerListingPages.id, listingPageId));
}

/** Touch lastCrawledAt for a listing page. */
export async function touchListingPageCrawled(listingPageId: string): Promise<void> {
  await db
    .update(schema.retailerListingPages)
    .set({ lastCrawledAt: new Date() })
    .where(eq(schema.retailerListingPages.id, listingPageId));
}

/** Build category breadcrumb path from parent chain. */
export function buildCategoryPath(
  page: ListingPageRow,
  byId: Map<string, ListingPageRow>,
): string[] {
  const path: string[] = [];
  let cur: ListingPageRow | undefined = page;
  const guard = new Set<string>();
  while (cur) {
    if (guard.has(cur.id)) break;
    guard.add(cur.id);
    path.unshift(cur.label);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

export type { DiscoveredDirectory as CategoryDirectory };
