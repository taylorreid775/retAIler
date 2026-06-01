import { db, sql } from '@retailer/db';
import { writeSignal } from './signals.js';

interface StockChangeRow {
  retailer_product_id: string;
  retailer_id: string;
  product_id: string | null;
  raw_title: string;
  curr_availability: string;
  prev_availability: string | null;
  curr_qty: number | null;
  changed_at: Date;
}

const LOW_STOCK_THRESHOLD = 5;

/**
 * Detect inventory transitions in the window: out_of_stock, back_in_stock, and
 * low_stock (qty below threshold). Compares the two most recent observations.
 */
export async function computeInventorySignals(windowDays: number): Promise<number> {
  const rows = await db.execute<StockChangeRow>(sql`
    WITH ranked AS (
      SELECT so.retailer_product_id,
             so.availability,
             so.qty,
             so.captured_at,
             ROW_NUMBER() OVER (PARTITION BY so.retailer_product_id ORDER BY so.captured_at DESC) AS rn
      FROM stock_observations so
      WHERE so.captured_at > now() - (${windowDays} || ' days')::interval
    )
    SELECT r1.retailer_product_id,
           rp.retailer_id,
           rp.product_id,
           rp.raw_title,
           r1.availability AS curr_availability,
           r2.availability AS prev_availability,
           r1.qty AS curr_qty,
           r1.captured_at AS changed_at
    FROM ranked r1
    LEFT JOIN ranked r2 ON r2.retailer_product_id = r1.retailer_product_id AND r2.rn = 2
    JOIN retailer_products rp ON rp.id = r1.retailer_product_id
    WHERE r1.rn = 1
  `);

  let count = 0;
  for (const r of rows) {
    const transitioned = r.prev_availability && r.prev_availability !== r.curr_availability;

    if (transitioned && r.curr_availability === 'out_of_stock') {
      await writeSignal({
        type: 'out_of_stock',
        severity: 'notable',
        retailerId: r.retailer_id,
        retailerProductId: r.retailer_product_id,
        productId: r.product_id,
        title: `Out of stock: ${r.raw_title}`,
        occurredAt: r.changed_at,
      });
      count += 1;
    } else if (
      transitioned &&
      r.curr_availability === 'in_stock' &&
      r.prev_availability === 'out_of_stock'
    ) {
      await writeSignal({
        type: 'back_in_stock',
        severity: 'info',
        retailerId: r.retailer_id,
        retailerProductId: r.retailer_product_id,
        productId: r.product_id,
        title: `Back in stock: ${r.raw_title}`,
        occurredAt: r.changed_at,
      });
      count += 1;
    }

    if (r.curr_qty != null && r.curr_qty > 0 && r.curr_qty < LOW_STOCK_THRESHOLD) {
      await writeSignal({
        type: 'low_stock',
        severity: 'notable',
        retailerId: r.retailer_id,
        retailerProductId: r.retailer_product_id,
        productId: r.product_id,
        title: `Low stock (${r.curr_qty} left): ${r.raw_title}`,
        data: { qty: r.curr_qty },
        occurredAt: r.changed_at,
      });
      count += 1;
    }
  }
  return count;
}
