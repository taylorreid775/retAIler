import { db, sql } from '@retailer/db';

export interface CrawlHealthRow {
  retailerId: string;
  retailerName: string;
  lastStatus: string | null;
  lastFinishedAt: Date | null;
  lastProductsExtracted: number | null;
  lastErrorCount: number | null;
  activeProducts: number;
}

/** Per-retailer crawl health: last run outcome + active product count. */
export async function crawlHealth(): Promise<CrawlHealthRow[]> {
  const rows = await db.execute<{
    retailer_id: string;
    retailer_name: string;
    last_status: string | null;
    last_finished_at: Date | null;
    last_products: number | null;
    last_errors: number | null;
    active_products: number;
  }>(sql`
    SELECT r.id AS retailer_id,
           r.name AS retailer_name,
           cr.status AS last_status,
           cr.finished_at AS last_finished_at,
           cr.products_extracted AS last_products,
           cr.error_count AS last_errors,
           COALESCE(ap.cnt, 0)::int AS active_products
    FROM retailers r
    LEFT JOIN LATERAL (
      SELECT status, finished_at, products_extracted, error_count
      FROM crawl_runs WHERE retailer_id = r.id ORDER BY started_at DESC LIMIT 1
    ) cr ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM retailer_products
      WHERE retailer_id = r.id AND active = true
    ) ap ON true
    ORDER BY r.name
  `);

  return rows.map((r) => ({
    retailerId: r.retailer_id,
    retailerName: r.retailer_name,
    lastStatus: r.last_status,
    lastFinishedAt: r.last_finished_at,
    lastProductsExtracted: r.last_products,
    lastErrorCount: r.last_errors,
    activeProducts: r.active_products,
  }));
}

export interface FreshnessRow {
  retailerId: string;
  retailerName: string;
  lastPriceObservationAt: Date | null;
  staleHours: number | null;
}

/** Data freshness: hours since the most recent price observation per retailer. */
export async function dataFreshness(): Promise<FreshnessRow[]> {
  const rows = await db.execute<{
    retailer_id: string;
    retailer_name: string;
    last_obs: Date | null;
    stale_hours: number | null;
  }>(sql`
    SELECT r.id AS retailer_id,
           r.name AS retailer_name,
           MAX(po.captured_at) AS last_obs,
           EXTRACT(EPOCH FROM (now() - MAX(po.captured_at))) / 3600 AS stale_hours
    FROM retailers r
    LEFT JOIN retailer_products rp ON rp.retailer_id = r.id
    LEFT JOIN price_observations po ON po.retailer_product_id = rp.id
    GROUP BY r.id, r.name
    ORDER BY r.name
  `);

  return rows.map((r) => ({
    retailerId: r.retailer_id,
    retailerName: r.retailer_name,
    lastPriceObservationAt: r.last_obs,
    staleHours: r.stale_hours != null ? Number(Number(r.stale_hours).toFixed(1)) : null,
  }));
}

export interface ReviewBacklog {
  pending: number;
}

/** Count of low-confidence matches awaiting human review. */
export async function reviewBacklog(): Promise<ReviewBacklog> {
  const [row] = await db.execute<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM match_review_queue WHERE resolved_at IS NULL
  `);
  return { pending: row?.cnt ?? 0 };
}
