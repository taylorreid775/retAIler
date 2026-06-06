import { db, sql } from '@retailer/db';
import { fromMinor, formatMoney } from '@retailer/schema';
import { writeSignal } from './signals';

interface PriceChangeRow extends Record<string, unknown> {
  retailer_product_id: string;
  retailer_id: string;
  product_id: string | null;
  raw_title: string;
  currency: 'CAD' | 'USD';
  prev_amount: number;
  curr_amount: number;
  changed_at: Date;
}

/**
 * Detect price changes within the window by comparing each product's two most
 * recent observations. Emits price_drop / price_increase signals with the
 * delta; severity scales with the magnitude of the change.
 */
export async function computePriceChanges(windowDays: number): Promise<number> {
  const rows = await db.execute<PriceChangeRow>(sql`
    WITH ranked AS (
      SELECT po.retailer_product_id,
             po.amount_minor,
             po.currency,
             po.captured_at,
             ROW_NUMBER() OVER (PARTITION BY po.retailer_product_id ORDER BY po.captured_at DESC) AS rn
      FROM price_observations po
      WHERE po.captured_at > now() - (${windowDays} || ' days')::interval
    )
    SELECT r1.retailer_product_id,
           rp.retailer_id,
           rp.product_id,
           rp.raw_title,
           r1.currency,
           r2.amount_minor AS prev_amount,
           r1.amount_minor AS curr_amount,
           r1.captured_at AS changed_at
    FROM ranked r1
    JOIN ranked r2 ON r2.retailer_product_id = r1.retailer_product_id AND r2.rn = 2
    JOIN retailer_products rp ON rp.id = r1.retailer_product_id
    WHERE r1.rn = 1 AND r1.amount_minor <> r2.amount_minor
  `);

  let count = 0;
  for (const r of rows) {
    const pct = (r.curr_amount - r.prev_amount) / r.prev_amount;
    const isDrop = r.curr_amount < r.prev_amount;
    const magnitude = Math.abs(pct);
    const severity = magnitude >= 0.15 ? 'critical' : magnitude >= 0.05 ? 'notable' : 'info';

    await writeSignal({
      type: isDrop ? 'price_drop' : 'price_increase',
      severity,
      retailerId: r.retailer_id,
      retailerProductId: r.retailer_product_id,
      productId: r.product_id,
      title: `${r.raw_title} ${isDrop ? 'dropped' : 'rose'} ${(magnitude * 100).toFixed(0)}% to ${formatMoney(
        { amountMinor: r.curr_amount, currency: r.currency },
      )}`,
      data: {
        prevPrice: fromMinor(r.prev_amount),
        currPrice: fromMinor(r.curr_amount),
        pctChange: Number((pct * 100).toFixed(2)),
        currency: r.currency,
      },
      occurredAt: r.changed_at,
    });
    count += 1;
  }
  return count;
}
