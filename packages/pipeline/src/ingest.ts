import { db, schema, eq, sql } from '@retailer/db';
import { createLogger } from '@retailer/core';
import { toMinor, type RawExtractedProduct } from '@retailer/schema';

const log = createLogger('pipeline:ingest');

export interface IngestResult {
  retailerProductId: string;
  isNew: boolean;
}

/**
 * Upsert a freshly extracted product into the raw retailer_products table and
 * append price/stock time-series observations. Matching to a canonical product
 * happens later (see matching.ts) and is enqueued separately.
 */
export async function ingestExtractedProduct(
  retailerId: string,
  raw: RawExtractedProduct,
): Promise<IngestResult> {
  const now = new Date();

  const [row] = await db
    .insert(schema.retailerProducts)
    .values({
      retailerId,
      url: raw.sourceUrl,
      retailerSku: raw.retailerSku,
      rawTitle: raw.title,
      brandRaw: raw.brand,
      categoryPathRaw: raw.categoryPath,
      gtin: raw.gtin,
      mpn: raw.mpn,
      imageUrl: raw.imageUrl,
      attributes: raw.attributes,
      firstSeenAt: now,
      lastSeenAt: now,
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.retailerProducts.url,
      set: {
        rawTitle: raw.title,
        brandRaw: raw.brand,
        categoryPathRaw: raw.categoryPath,
        gtin: raw.gtin,
        mpn: raw.mpn,
        imageUrl: raw.imageUrl,
        attributes: raw.attributes,
        lastSeenAt: now,
        active: true,
      },
    })
    .returning({
      id: schema.retailerProducts.id,
      firstSeenAt: schema.retailerProducts.firstSeenAt,
    });

  if (!row) throw new Error('ingest upsert returned no row');
  const retailerProductId = row.id;
  const isNew = row.firstSeenAt.getTime() === now.getTime();

  if (raw.price != null) {
    await db.insert(schema.priceObservations).values({
      retailerProductId,
      amountMinor: toMinor(raw.price),
      listAmountMinor: raw.listPrice != null ? toMinor(raw.listPrice) : null,
      currency: raw.currency,
      capturedAt: raw.capturedAt,
    });
  }

  await db.insert(schema.stockObservations).values({
    retailerProductId,
    availability: raw.availability,
    qty: raw.stockQty,
    capturedAt: raw.capturedAt,
  });

  log.debug('ingested product', { retailerProductId, isNew, url: raw.sourceUrl });
  return { retailerProductId, isNew };
}

/** Record a raw HTML snapshot row for provenance. */
export async function recordSnapshot(params: {
  retailerId: string;
  url: string;
  blobKey: string;
  contentHash: string;
  httpStatus: number;
}): Promise<void> {
  await db.insert(schema.pageSnapshots).values(params);
}

/** Mark retailer products not seen since `cutoff` as inactive (delisted). */
export async function markStaleInactive(retailerId: string, cutoff: Date): Promise<number> {
  const res = await db
    .update(schema.retailerProducts)
    .set({ active: false })
    .where(
      sql`${schema.retailerProducts.retailerId} = ${retailerId} AND ${schema.retailerProducts.lastSeenAt} < ${cutoff} AND ${schema.retailerProducts.active} = true`,
    );
  return res.count ?? 0;
}

export { eq };
