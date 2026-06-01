import { RawExtractedProductSchema, type RawExtractedProduct } from '@retailer/schema';
import { createLogger } from '@retailer/core';
import { extractFromJsonLd } from './structured.js';
import { extractWithLlm } from './llm.js';

const log = createLogger('crawler:extract');

export interface ExtractOptions {
  /** Allow the LLM fallback (costs tokens). Default true. */
  allowLlm?: boolean;
  /** Adapter-specific structured parser tried before JSON-LD. */
  custom?: (html: string, url: string, retailerKey: string) => RawExtractedProduct | null;
}

/**
 * Structured-first, LLM-fallback extraction. Returns a validated
 * RawExtractedProduct or null if nothing usable could be parsed.
 */
export async function extractProduct(
  html: string,
  url: string,
  retailerKey: string,
  opts: ExtractOptions = {},
): Promise<RawExtractedProduct | null> {
  const { allowLlm = true, custom } = opts;

  let result = custom?.(html, url, retailerKey) ?? null;
  if (!result || !hasPrice(result)) {
    const jsonLd = extractFromJsonLd(html, url, retailerKey);
    result = mergePreferred(result, jsonLd);
  }
  if ((!result || !hasPrice(result)) && allowLlm) {
    const llm = await extractWithLlm(html, url, retailerKey);
    result = mergePreferred(result, llm);
  }

  if (!result) return null;
  const parsed = RawExtractedProductSchema.safeParse(result);
  if (!parsed.success) {
    log.warn('extracted product failed validation', { url, issues: parsed.error.issues.length });
    return null;
  }
  return parsed.data;
}

function hasPrice(p: RawExtractedProduct | null): boolean {
  return !!p && p.price != null;
}

/** Prefer `primary` fields, fill gaps from `fallback`. */
function mergePreferred(
  primary: RawExtractedProduct | null,
  fallback: RawExtractedProduct | null,
): RawExtractedProduct | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...stripNulls(primary),
    attributes: { ...fallback.attributes, ...primary.attributes },
    categoryPath: primary.categoryPath.length ? primary.categoryPath : fallback.categoryPath,
  };
}

function stripNulls(p: RawExtractedProduct): Partial<RawExtractedProduct> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out as Partial<RawExtractedProduct>;
}

export { extractFromJsonLd } from './structured.js';
export { extractWithLlm } from './llm.js';
