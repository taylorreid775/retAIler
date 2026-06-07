import { db, sql } from '@retailer/db';

export interface ProductSummary {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  minPriceMinor: number | null;
  currency: string;
  offerCount: number;
}

type ProductRow = {
  id: string;
  canonical_title: string;
  brand_name: string | null;
  image_url: string | null;
  min_price: number | null;
  currency: string | null;
  offer_count: number;
};

function mapProductRows(rows: ProductRow[]): ProductSummary[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.canonical_title,
    brand: r.brand_name,
    imageUrl: r.image_url,
    minPriceMinor: r.min_price,
    currency: r.currency ?? 'CAD',
    offerCount: r.offer_count,
  }));
}

/** Each whitespace-separated token must appear in the title or brand (order-independent). */
function tokenMatchClause(query: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const parts = tokens.map((token) => {
    const pattern = `%${token}%`;
    return sql`(p.canonical_title ILIKE ${pattern} OR COALESCE(b.name, '') ILIKE ${pattern})`;
  });
  return sql.join(parts, sql` AND `);
}

async function queryProductSummaries(where: ReturnType<typeof sql> | null, limit: number) {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.canonical_title, b.name AS brand_name, p.image_url,
           MIN(lp.amount_minor) AS min_price,
           MIN(lp.currency) AS currency,
           COUNT(DISTINCT rp.id)::int AS offer_count
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    JOIN retailer_products rp ON rp.product_id = p.id AND rp.active = true
    LEFT JOIN LATERAL (
      SELECT po.amount_minor, po.currency
      FROM price_observations po
      WHERE po.retailer_product_id = rp.id
      ORDER BY po.captured_at DESC
      LIMIT 1
    ) lp ON true
    ${where ? sql`WHERE ${where}` : sql``}
    GROUP BY p.id, p.canonical_title, b.name, p.image_url
    ORDER BY offer_count DESC, min_price ASC NULLS LAST
    LIMIT ${limit}
  `);
  return mapProductRows(rows);
}

/** Product search — token-based match with the cheapest current price per product. */
export async function searchProducts(query: string, limit = 24): Promise<ProductSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return listPopularProducts(limit);
  const where = tokenMatchClause(trimmed);
  if (!where) return [];
  return queryProductSummaries(where, limit);
}

/** Homepage / empty-query browse — products with the most retailer offers. */
export async function listPopularProducts(limit = 24): Promise<ProductSummary[]> {
  return queryProductSummaries(null, limit);
}

export interface ProductOffer {
  retailerProductId: string;
  retailerName: string;
  url: string;
  priceMinor: number | null;
  currency: string;
  availability: string;
}

export interface ProductDetail {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  offers: ProductOffer[];
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const [head] = await db.execute<{
    id: string;
    canonical_title: string;
    brand_name: string | null;
    image_url: string | null;
  }>(sql`
    SELECT p.id, p.canonical_title, b.name AS brand_name, p.image_url
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.id = ${id}
  `);
  if (!head) return null;

  const offers = await db.execute<{
    retailer_product_id: string;
    retailer_name: string;
    url: string;
    price_minor: number | null;
    currency: string | null;
    availability: string;
  }>(sql`
    SELECT rp.id AS retailer_product_id, r.name AS retailer_name, rp.url,
           lp.amount_minor AS price_minor, lp.currency,
           COALESCE(ls.availability, 'unknown') AS availability
    FROM retailer_products rp
    JOIN retailers r ON r.id = rp.retailer_id
    LEFT JOIN LATERAL (
      SELECT amount_minor, currency FROM price_observations
      WHERE retailer_product_id = rp.id ORDER BY captured_at DESC LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT availability FROM stock_observations
      WHERE retailer_product_id = rp.id ORDER BY captured_at DESC LIMIT 1
    ) ls ON true
    WHERE rp.product_id = ${id} AND rp.active = true
    ORDER BY lp.amount_minor ASC NULLS LAST
  `);

  return {
    id: head.id,
    title: head.canonical_title,
    brand: head.brand_name,
    imageUrl: head.image_url,
    offers: offers.map((o) => ({
      retailerProductId: o.retailer_product_id,
      retailerName: o.retailer_name,
      url: o.url,
      priceMinor: o.price_minor,
      currency: o.currency ?? 'CAD',
      availability: o.availability,
    })),
  };
}

export interface PricePoint {
  day: string;
  minPriceMinor: number;
}

/** Daily minimum price across all retailers for a product (for the chart). */
export async function priceHistory(id: string, days = 90): Promise<PricePoint[]> {
  const rows = await db.execute<{ day: string; min_price: number }>(sql`
    SELECT to_char(date_trunc('day', po.captured_at), 'YYYY-MM-DD') AS day,
           MIN(po.amount_minor) AS min_price
    FROM price_observations po
    JOIN retailer_products rp ON rp.id = po.retailer_product_id
    WHERE rp.product_id = ${id}
      AND po.captured_at > now() - (${days} || ' days')::interval
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return rows.map((r) => ({ day: r.day, minPriceMinor: Number(r.min_price) }));
}

export async function popularProducts(limit = 12): Promise<ProductSummary[]> {
  return listPopularProducts(limit);
}
