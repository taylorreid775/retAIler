import { db, sql } from '@retailer/db';
import { writeSignal } from './signals';

interface NewProductRow extends Record<string, unknown> {
  id: string;
  retailer_id: string;
  product_id: string | null;
  raw_title: string;
  first_seen_at: Date;
}

interface AssortmentRow extends Record<string, unknown> {
  retailer_id: string;
  category_path: string | null;
  cnt: number;
}

/**
 * Emit new_product signals for listings first seen within the window, plus
 * assortment_expansion summaries per retailer + category (e.g. "27 new running
 * shoes added this week").
 */
export async function computeNewProducts(windowDays: number): Promise<number> {
  const rows = await db.execute<NewProductRow>(sql`
    SELECT rp.id, rp.retailer_id, rp.product_id, rp.raw_title, rp.first_seen_at
    FROM retailer_products rp
    WHERE rp.first_seen_at > now() - (${windowDays} || ' days')::interval
  `);

  let count = 0;
  for (const r of rows) {
    await writeSignal({
      type: 'new_product',
      severity: 'info',
      retailerId: r.retailer_id,
      retailerProductId: r.id,
      productId: r.product_id,
      title: `New product: ${r.raw_title}`,
      data: { firstSeenAt: r.first_seen_at },
      occurredAt: r.first_seen_at,
    });
    count += 1;
  }

  // Assortment expansion rollups by leaf category.
  const rollups = await db.execute<AssortmentRow>(sql`
    SELECT rp.retailer_id,
           c.path AS category_path,
           COUNT(*)::int AS cnt
    FROM retailer_products rp
    LEFT JOIN products p ON p.id = rp.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE rp.first_seen_at > now() - (${windowDays} || ' days')::interval
    GROUP BY rp.retailer_id, c.path
    HAVING COUNT(*) >= 5
  `);

  for (const r of rollups) {
    await writeSignal({
      type: 'assortment_expansion',
      severity: r.cnt >= 25 ? 'notable' : 'info',
      retailerId: r.retailer_id,
      title: `${r.cnt} new products added in ${r.category_path ?? 'uncategorized'} this period`,
      data: { categoryPath: r.category_path, count: r.cnt, windowDays },
    });
    count += 1;
  }

  return count;
}
