import { db, schema, eq } from '@retailer/db';
import { createLogger } from '@retailer/core';
import { canonicalizeBrand, canonicalizeCategory } from './normalize';
import { embeddingText, upsertEmbedding } from './embeddings';
import { decideMatch, nearestCandidates } from './matching';

const log = createLogger('pipeline:match');

export interface MatchOutcome {
  retailerProductId: string;
  productId: string | null;
  status: 'auto_matched' | 'confirmed' | 'needs_review';
}

/**
 * Full match flow for one retailer product:
 * normalize brand/category → embed → find candidates → decide → persist.
 */
export async function matchRetailerProduct(retailerProductId: string): Promise<MatchOutcome> {
  const [rp] = await db
    .select()
    .from(schema.retailerProducts)
    .where(eq(schema.retailerProducts.id, retailerProductId));
  if (!rp) throw new Error(`retailer product ${retailerProductId} not found`);

  const brandId = await canonicalizeBrand(rp.brandRaw);
  const categoryId = await canonicalizeCategory(rp.retailerId, rp.categoryPathRaw);

  const text = embeddingText({
    rawTitle: rp.rawTitle,
    brandRaw: rp.brandRaw,
    attributes: rp.attributes,
  });
  const embedding = await upsertEmbedding(retailerProductId, text);

  const candidates = embedding ? await nearestCandidates(embedding, brandId) : [];
  const decision = await decideMatch({
    title: rp.rawTitle,
    brand: rp.brandRaw,
    gtin: rp.gtin,
    mpn: rp.mpn,
    candidates,
  });

  if (decision.kind === 'matched') {
    await linkToProduct(retailerProductId, decision.productId, decision.status, decision.confidence);
    await backfillProduct(decision.productId, { brandId, categoryId, gtin: rp.gtin, mpn: rp.mpn });
    log.debug('matched', { retailerProductId, productId: decision.productId, status: decision.status });
    return { retailerProductId, productId: decision.productId, status: decision.status };
  }

  if (decision.kind === 'review') {
    await db
      .update(schema.retailerProducts)
      .set({ matchStatus: 'needs_review', matchConfidence: decision.confidence })
      .where(eq(schema.retailerProducts.id, retailerProductId));
    await db.insert(schema.matchReviewQueue).values({
      retailerProductId,
      candidateProductId: decision.candidateProductId,
      confidence: decision.confidence,
      reason: decision.reason,
    });
    log.info('queued for review', { retailerProductId, confidence: decision.confidence });
    return { retailerProductId, productId: null, status: 'needs_review' };
  }

  // New canonical product seeded from this listing.
  const [product] = await db
    .insert(schema.products)
    .values({
      canonicalTitle: rp.rawTitle,
      brandId,
      categoryId,
      gtin: rp.gtin,
      mpn: rp.mpn,
      imageUrl: rp.imageUrl,
    })
    .returning({ id: schema.products.id });
  if (!product) throw new Error('failed to create canonical product');

  await linkToProduct(retailerProductId, product.id, 'auto_matched', 1);
  log.debug('created new canonical product', { retailerProductId, productId: product.id });
  return { retailerProductId, productId: product.id, status: 'auto_matched' };
}

async function linkToProduct(
  retailerProductId: string,
  productId: string,
  status: 'auto_matched' | 'confirmed',
  confidence: number,
): Promise<void> {
  await db
    .update(schema.retailerProducts)
    .set({ productId, matchStatus: status, matchConfidence: confidence })
    .where(eq(schema.retailerProducts.id, retailerProductId));
}

/** Fill in canonical product fields that were previously unknown. */
async function backfillProduct(
  productId: string,
  fields: { brandId: string | null; categoryId: string | null; gtin: string | null; mpn: string | null },
): Promise<void> {
  const [p] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!p) return;
  await db
    .update(schema.products)
    .set({
      brandId: p.brandId ?? fields.brandId,
      categoryId: p.categoryId ?? fields.categoryId,
      gtin: p.gtin ?? fields.gtin,
      mpn: p.mpn ?? fields.mpn,
      updatedAt: new Date(),
    })
    .where(eq(schema.products.id, productId));
}
