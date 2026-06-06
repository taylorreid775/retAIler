import { db, sql } from '@retailer/db';

/** Read helpers used by the dashboard. All scoped to a set of competitor retailers. */

export interface BrandGrowthRow {
  brandId: string;
  brandName: string;
  newProducts: number;
  totalProducts: number;
  growthPct: number;
}

export async function brandGrowth(
  retailerIds: string[],
  windowDays: number,
): Promise<BrandGrowthRow[]> {
  if (retailerIds.length === 0) return [];
  const ids = sql.join(
    retailerIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{
    brand_id: string;
    brand_name: string;
    new_products: number;
    total_products: number;
  }>(sql`
    SELECT b.id AS brand_id,
           b.name AS brand_name,
           COUNT(*) FILTER (WHERE rp.first_seen_at > now() - (${windowDays} || ' days')::interval)::int AS new_products,
           COUNT(*)::int AS total_products
    FROM retailer_products rp
    JOIN products p ON p.id = rp.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE rp.retailer_id = ANY(ARRAY[${ids}]) AND rp.active = true
    GROUP BY b.id, b.name
    HAVING COUNT(*) FILTER (WHERE rp.first_seen_at > now() - (${windowDays} || ' days')::interval) > 0
    ORDER BY new_products DESC
    LIMIT 25
  `);

  return rows.map((r) => ({
    brandId: r.brand_id,
    brandName: r.brand_name,
    newProducts: r.new_products,
    totalProducts: r.total_products,
    growthPct:
      r.total_products > 0 ? Number(((r.new_products / r.total_products) * 100).toFixed(1)) : 0,
  }));
}

export interface RecentSignalRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  retailerId: string;
  retailerName: string;
  data: Record<string, unknown>;
  occurredAt: Date;
}

export async function recentSignals(
  retailerIds: string[],
  opts: { types?: string[]; limit?: number } = {},
): Promise<RecentSignalRow[]> {
  if (retailerIds.length === 0) return [];
  const ids = sql.join(
    retailerIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const typeClause =
    opts.types && opts.types.length
      ? sql`AND s.type = ANY(ARRAY[${sql.join(
          opts.types.map((t) => sql`${t}::signal_type`),
          sql`, `,
        )}]::signal_type[])`
      : sql``;

  const rows = await db.execute<{
    id: string;
    type: string;
    severity: string;
    title: string;
    retailer_id: string;
    retailer_name: string;
    data: Record<string, unknown>;
    occurred_at: Date;
  }>(sql`
    SELECT s.id, s.type, s.severity, s.title, s.retailer_id,
           r.name AS retailer_name, s.data, s.occurred_at
    FROM signals s
    JOIN retailers r ON r.id = s.retailer_id
    WHERE s.retailer_id = ANY(ARRAY[${ids}]) ${typeClause}
    ORDER BY s.occurred_at DESC
    LIMIT ${opts.limit ?? 100}
  `);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    title: r.title,
    retailerId: r.retailer_id,
    retailerName: r.retailer_name,
    data: r.data,
    occurredAt: r.occurred_at,
  }));
}
