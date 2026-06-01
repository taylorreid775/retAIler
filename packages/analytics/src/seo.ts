import { db, sql } from '@retailer/db';

export interface KeywordGap {
  term: string;
  competitorRetailerId: string;
  competitorRank: number;
}

/**
 * Keyword gaps: terms where at least one competitor ranks in the top positions
 * but the org's own retailer does not rank at all. Reads from serp_observations
 * (most recent rank per keyword+retailer).
 */
export async function keywordGaps(
  ownRetailerId: string,
  competitorRetailerIds: string[],
  topN = 20,
): Promise<KeywordGap[]> {
  if (competitorRetailerIds.length === 0) return [];

  const rows = await db.execute<{
    term: string;
    retailer_id: string;
    rank: number;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (so.keyword_id, so.retailer_id)
             so.keyword_id, so.retailer_id, so.rank
      FROM serp_observations so
      ORDER BY so.keyword_id, so.retailer_id, so.captured_at DESC
    )
    SELECT k.term, l.retailer_id, l.rank
    FROM latest l
    JOIN keywords k ON k.id = l.keyword_id
    WHERE l.rank <= ${topN}
      AND l.retailer_id = ANY(${sql`ARRAY[${sql.join(
        competitorRetailerIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]`})
      AND NOT EXISTS (
        SELECT 1 FROM latest own
        WHERE own.keyword_id = l.keyword_id AND own.retailer_id = ${ownRetailerId}
      )
    ORDER BY l.rank ASC
  `);

  return rows.map((r) => ({
    term: r.term,
    competitorRetailerId: r.retailer_id,
    competitorRank: r.rank,
  }));
}
