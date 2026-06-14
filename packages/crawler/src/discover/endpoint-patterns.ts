import type { Platform } from '@retailer/schema';
import { db, schema, eq, and, sql } from '@retailer/db';

export interface EndpointPattern {
  platform: Platform | 'unknown';
  urlRegex: string;
  method: string;
  endpointType: string;
  successRate: number;
  retailerCount: number;
  sampleFieldMap?: Record<string, string>;
}

export interface EndpointPatternRow {
  platform: string | null;
  url: string;
  method: string;
  endpointType: string;
  reliabilityScore: number | null;
  failureCount: number;
  retailerId: string;
}

/** Minimum distinct retailers before a pattern is promoted. */
export const PATTERN_MIN_RETAILERS = 3;

/** Minimum rolling success rate to consult a pattern. */
export const PATTERN_MIN_SUCCESS_RATE = 0.8;

/**
 * Derive a reusable URL regex from a concrete endpoint URL.
 * Host is wildcarded so patterns aggregate across retailers on the same platform.
 */
export function deriveUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        if (/^\d+$/.test(seg)) return '\\d+';
        if (/^[0-9a-f-]{36}$/i.test(seg)) return '[0-9a-f-]+';
        if (/^[A-Z0-9_-]{8,}$/i.test(seg) && /\d/.test(seg)) return '[^/]+';
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      });
    const path = segments.length ? `/${segments.join('/')}` : '/';
    return `https?://[^/]+${path}`;
  } catch {
    return url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

function successRate(reliability: number | null, failureCount: number): number {
  const base = reliability ?? 0.85;
  const penalty = Math.min(failureCount * 0.05, 0.4);
  return Math.max(0, base - penalty);
}

/** Aggregate endpoint rows into cross-retailer patterns. */
export function aggregateEndpointPatterns(rows: EndpointPatternRow[]): EndpointPattern[] {
  const groups = new Map<
    string,
    {
      platform: Platform | 'unknown';
      urlRegex: string;
      method: string;
      endpointType: string;
      retailers: Set<string>;
      scores: number[];
    }
  >();

  for (const row of rows) {
    if (!row.url || row.failureCount > 5) continue;
    const urlRegex = deriveUrlPattern(row.url);
    const platform = (row.platform as Platform | null) ?? 'unknown';
    const key = `${platform}|${row.method}|${row.endpointType}|${urlRegex}`;
    const existing = groups.get(key);
    const score = successRate(row.reliabilityScore, row.failureCount);
    if (existing) {
      existing.retailers.add(row.retailerId);
      existing.scores.push(score);
    } else {
      groups.set(key, {
        platform,
        urlRegex,
        method: row.method,
        endpointType: row.endpointType,
        retailers: new Set([row.retailerId]),
        scores: [score],
      });
    }
  }

  const patterns: EndpointPattern[] = [];
  for (const group of groups.values()) {
    if (group.retailers.size < PATTERN_MIN_RETAILERS) continue;
    const avgScore = group.scores.reduce((a, b) => a + b, 0) / group.scores.length;
    if (avgScore < PATTERN_MIN_SUCCESS_RATE) continue;
    patterns.push({
      platform: group.platform,
      urlRegex: group.urlRegex,
      method: group.method,
      endpointType: group.endpointType,
      successRate: avgScore,
      retailerCount: group.retailers.size,
    });
  }

  return patterns.sort((a, b) => b.successRate - a.successRate || b.retailerCount - a.retailerCount);
}

/** Match a candidate URL against known endpoint patterns. */
export function matchEndpointPattern(
  url: string,
  platform: Platform | 'unknown',
  patterns: EndpointPattern[],
): EndpointPattern | null {
  for (const pattern of patterns) {
    if (pattern.platform !== 'unknown' && pattern.platform !== platform) continue;
    try {
      const re = new RegExp(`^${pattern.urlRegex}`, 'i');
      if (re.test(url)) return pattern;
    } catch {
      continue;
    }
  }
  return null;
}

/** Load active endpoint patterns from the retailer registry. */
export async function loadEndpointPatterns(
  platform?: import('@retailer/schema').Platform | 'unknown',
): Promise<EndpointPattern[]> {
  const rows = await db
    .select({
      url: schema.retailerEndpoints.url,
      method: schema.retailerEndpoints.method,
      endpointType: schema.retailerEndpoints.endpointType,
      reliabilityScore: schema.retailerEndpoints.reliabilityScore,
      failureCount: schema.retailerEndpoints.failureCount,
      retailerId: schema.retailerEndpoints.retailerId,
      fingerprint: schema.retailers.fingerprint,
    })
    .from(schema.retailerEndpoints)
    .innerJoin(schema.retailers, eq(schema.retailerEndpoints.retailerId, schema.retailers.id))
    .where(
      platform && platform !== 'unknown'
        ? and(
            eq(schema.retailerEndpoints.active, true),
            sql`${schema.retailers.fingerprint}->>'platform' = ${platform}`,
          )
        : eq(schema.retailerEndpoints.active, true),
    );

  const mapped: EndpointPatternRow[] = rows.map((row) => ({
    platform: row.fingerprint?.platform ?? null,
    url: row.url,
    method: row.method,
    endpointType: row.endpointType,
    reliabilityScore: row.reliabilityScore,
    failureCount: row.failureCount,
    retailerId: row.retailerId,
  }));

  return aggregateEndpointPatterns(mapped);
}
