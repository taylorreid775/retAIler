import { generateObject } from 'ai';
import { z } from 'zod';
import { db, schema, eq, and, sql, isNotNull } from '@retailer/db';
import { extractionModel, createLogger } from '@retailer/core';

const log = createLogger('pipeline:matching');

export interface MatchCandidate {
  productId: string;
  retailerProductId: string;
  title: string;
  brandId: string | null;
  /** Cosine distance (0 = identical). */
  distance: number;
}

/** Confidence thresholds for the matcher's decision tiers. */
const AUTO_MATCH_DISTANCE = 0.12; // very close embeddings → auto-match
const REVIEW_DISTANCE = 0.28; // borderline → LLM adjudication / review
const LLM_CONFIRM_THRESHOLD = 0.82;

const AdjudicationSchema = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

/** Find the nearest already-matched products by embedding cosine distance. */
export async function nearestCandidates(
  embedding: number[],
  brandId: string | null,
  limit = 5,
): Promise<MatchCandidate[]> {
  const vec = `[${embedding.join(',')}]`;
  const brandClause = brandId
    ? sql`AND p.brand_id = ${brandId}`
    : sql``;

  const rows = await db.execute<{
    product_id: string;
    retailer_product_id: string;
    canonical_title: string;
    brand_id: string | null;
    distance: number;
  }>(sql`
    SELECT p.id AS product_id,
           rp.id AS retailer_product_id,
           p.canonical_title,
           p.brand_id,
           (pe.embedding <=> ${vec}::vector) AS distance
    FROM product_embeddings pe
    JOIN retailer_products rp ON rp.id = pe.retailer_product_id
    JOIN products p ON p.id = rp.product_id
    WHERE rp.product_id IS NOT NULL ${brandClause}
    ORDER BY pe.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    productId: r.product_id,
    retailerProductId: r.retailer_product_id,
    title: r.canonical_title,
    brandId: r.brand_id,
    distance: Number(r.distance),
  }));
}

/** Hard-key match: same GTIN/MPN → same product. */
export async function hardKeyMatch(
  gtin: string | null,
  mpn: string | null,
): Promise<string | null> {
  if (gtin) {
    const [p] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.gtin, gtin));
    if (p) return p.id;
    const [rp] = await db
      .select({ productId: schema.retailerProducts.productId })
      .from(schema.retailerProducts)
      .where(and(eq(schema.retailerProducts.gtin, gtin), isNotNull(schema.retailerProducts.productId)));
    if (rp?.productId) return rp.productId;
  }
  if (mpn) {
    const [p] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.mpn, mpn));
    if (p) return p.id;
  }
  return null;
}

/** LLM adjudication for borderline candidates. */
async function adjudicate(
  current: { title: string; brand: string | null },
  candidate: { title: string },
): Promise<z.infer<typeof AdjudicationSchema>> {
  try {
    const { object } = await generateObject({
      model: extractionModel(),
      schema: AdjudicationSchema,
      system:
        'Decide whether two retail product listings refer to the SAME product ' +
        '(same model, ignoring size/color variants and retailer wording). ' +
        'Return confidence in [0,1].',
      prompt: `A: ${current.brand ?? ''} ${current.title}\nB: ${candidate.title}`,
    });
    return object;
  } catch (err) {
    log.warn('adjudication failed', { err: String(err) });
    return { same: false, confidence: 0, reason: 'adjudication error' };
  }
}

export type MatchDecision =
  | { kind: 'matched'; productId: string; confidence: number; status: 'auto_matched' | 'confirmed' }
  | { kind: 'review'; candidateProductId: string | null; confidence: number; reason: string }
  | { kind: 'new'; confidence: number };

/**
 * Decide how to match a retailer product given hard keys + nearest candidates.
 * Layered: hard key → embedding distance tiers → LLM adjudication → review/new.
 */
export async function decideMatch(params: {
  title: string;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  candidates: MatchCandidate[];
}): Promise<MatchDecision> {
  const hard = await hardKeyMatch(params.gtin, params.mpn);
  if (hard) return { kind: 'matched', productId: hard, confidence: 1, status: 'confirmed' };

  const best = params.candidates[0];
  if (!best) return { kind: 'new', confidence: 1 };

  if (best.distance <= AUTO_MATCH_DISTANCE) {
    return { kind: 'matched', productId: best.productId, confidence: 1 - best.distance, status: 'auto_matched' };
  }

  if (best.distance <= REVIEW_DISTANCE) {
    const verdict = await adjudicate(
      { title: params.title, brand: params.brand },
      { title: best.title },
    );
    if (verdict.same && verdict.confidence >= LLM_CONFIRM_THRESHOLD) {
      return { kind: 'matched', productId: best.productId, confidence: verdict.confidence, status: 'auto_matched' };
    }
    return {
      kind: 'review',
      candidateProductId: best.productId,
      confidence: verdict.confidence,
      reason: verdict.reason,
    };
  }

  return { kind: 'new', confidence: 1 - best.distance };
}
