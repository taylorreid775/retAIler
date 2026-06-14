import { db, sql } from '@retailer/db';

export interface DiscoveryCostSummary {
  totalCostUsd30d: number;
  totalTokens30d: number;
  runCount30d: number;
  overBudgetCount30d: number;
  avgCostPerRun: number;
}

export interface DiscoveryCostWeeklyRow {
  weekStart: string;
  totalCostUsd: number;
  runCount: number;
  totalTokens: number;
}

const BUDGET_USD = 0.1;

/** Aggregate discovery spend for the ops cost dashboard. */
export async function discoveryCostSummary(): Promise<DiscoveryCostSummary> {
  const [row] = await db.execute<{
    total_cost: number;
    total_tokens: number;
    run_count: number;
    over_budget: number;
  }>(sql`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total_cost,
           COALESCE(SUM(token_usage), 0)::int AS total_tokens,
           COUNT(*)::int AS run_count,
           COUNT(*) FILTER (WHERE cost_usd > ${BUDGET_USD})::int AS over_budget
    FROM discovery_runs
    WHERE completed_at > now() - interval '30 days'
      AND status = 'completed'
  `);

  const runCount = row?.run_count ?? 0;
  const totalCost = Number(row?.total_cost ?? 0);

  return {
    totalCostUsd30d: totalCost,
    totalTokens30d: row?.total_tokens ?? 0,
    runCount30d: runCount,
    overBudgetCount30d: row?.over_budget ?? 0,
    avgCostPerRun: runCount > 0 ? Number((totalCost / runCount).toFixed(4)) : 0,
  };
}

/** Weekly discovery cost trend (last 8 weeks). */
export async function discoveryCostWeekly(): Promise<DiscoveryCostWeeklyRow[]> {
  const rows = await db.execute<{
    week_start: string;
    total_cost: number;
    run_count: number;
    total_tokens: number;
  }>(sql`
    SELECT date_trunc('week', completed_at)::date::text AS week_start,
           COALESCE(SUM(cost_usd), 0)::float AS total_cost,
           COUNT(*)::int AS run_count,
           COALESCE(SUM(token_usage), 0)::int AS total_tokens
    FROM discovery_runs
    WHERE completed_at > now() - interval '56 days'
      AND status = 'completed'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 8
  `);

  return rows.map((r) => ({
    weekStart: r.week_start,
    totalCostUsd: Number(r.total_cost),
    runCount: r.run_count,
    totalTokens: r.total_tokens,
  }));
}
