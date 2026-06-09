import { generateObject } from 'ai';
import { extractionModel, createLogger } from '@retailer/core';
import {
  ApiCategoryParamSchema,
  ApiPaginationSchema,
  ApiRecipeSchema,
  type ApiRecipe,
  type CrawlRecipe,
} from '@retailer/schema';
import { z } from 'zod';
import { type CapturedJsonResponse } from './network-types';

const log = createLogger('crawler:infer-api');

const InferredApiRecipeSchema = z.object({
  baseUrl: z.string().describe('Catalog/search API URL without query string'),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).describe('Required headers; never include Cookie or Authorization'),
  staticQuery: z.record(z.string()).default({}),
  categoryParam: ApiCategoryParamSchema.optional(),
  pagination: ApiPaginationSchema.optional(),
  productsPath: z.string().describe('Dot path to the products array, e.g. products or data.items'),
  fieldMap: z.record(z.union([z.string(), z.array(z.string())])),
  urlPrefix: z.string().optional(),
  productUrlPattern: z.string().optional().describe('Regex substring for product detail URLs'),
});

const SAFE_HEADER_DENY = /^(cookie|authorization|set-cookie)$/i;

/**
 * Use AI Gateway to turn captured network traffic into a replayable ApiRecipe.
 * Returns null when inference fails or the result does not validate.
 */
export async function inferApiRecipeFromCaptures(
  captures: CapturedJsonResponse[],
  ctx: { domain: string; homepageUrl: string },
): Promise<{ api: ApiRecipe; productUrlPattern: string | null } | null> {
  const ranked = captures
    .filter((c) => c.productLikeScore >= 0.4)
    .sort((a, b) => b.productLikeScore - a.productLikeScore)
    .slice(0, 5);
  if (!ranked.length) return null;

  const prompt = ranked
    .map(
      (c, i) =>
        `### Capture ${i + 1} (score ${c.productLikeScore.toFixed(2)})\n` +
        `Page: ${c.pageUrl}\n` +
        `Request: ${c.method} ${c.requestUrl}\n` +
        `Headers: ${JSON.stringify(c.requestHeaders, null, 0)}\n` +
        `Response preview:\n${c.bodyPreview}\n`,
    )
    .join('\n');

  try {
    const { object } = await generateObject({
      model: extractionModel(),
      schema: InferredApiRecipeSchema,
      system:
        'You reverse-engineer retail catalog/search APIs from captured browser network traffic. ' +
        'Output a recipe to paginate and map products. Use {ENV_NAME} placeholders for store-specific ' +
        'query values when needed. Strip cookies and secrets from headers. ' +
        'fieldMap keys: title, url, sku, price, listPrice, image, brand, description.',
      prompt: `Retailer domain: ${ctx.domain}\nHomepage: ${ctx.homepageUrl}\n\n${prompt}`,
    });

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(object.headers)) {
      if (!SAFE_HEADER_DENY.test(k)) headers[k] = v;
    }

    let baseUrl = object.baseUrl;
    try {
      const u = new URL(baseUrl);
      baseUrl = `${u.origin}${u.pathname}`;
    } catch {
      // keep as-is
    }

    const apiParsed = ApiRecipeSchema.safeParse({
      ...object,
      baseUrl,
      headers,
      currency: 'CAD',
    });
    if (!apiParsed.success) {
      log.warn('inferred API recipe failed schema validation', {
        issues: apiParsed.error.issues.map((i) => i.message),
      });
      return null;
    }

    return {
      api: apiParsed.data,
      productUrlPattern: object.productUrlPattern ?? null,
    };
  } catch (err) {
    log.warn('API recipe inference failed', { err: String(err) });
    return null;
  }
}

type ApiMergeDiscovery = {
  confidence: number;
  productUrlPattern: string | null;
  sampleProductUrls: string[];
  crawlRecipe: CrawlRecipe;
  notes: string;
  fetchStrategy: 'static' | 'browser' | 'jina_reader';
};

/** Merge an inferred API block into a site discovery result. */
export function mergeApiIntoDiscovery<T extends ApiMergeDiscovery>(
  discovery: T,
  api: ApiRecipe,
  productUrlPattern: string | null,
  sampleUrls: string[],
): T {
  const pattern = productUrlPattern ?? discovery.productUrlPattern;
  const samples = sampleUrls.length ? sampleUrls : discovery.sampleProductUrls;
  const confidence = Math.max(discovery.confidence, samples.length >= 3 ? 0.85 : 0.6);

  return {
    ...discovery,
    confidence,
    productUrlPattern: pattern,
    sampleProductUrls: samples.slice(0, 8),
    fetchStrategy: 'browser',
    notes: `${discovery.notes}; API catalog endpoint confirmed via network capture`,
    crawlRecipe: {
      ...discovery.crawlRecipe,
      discoveryMode: 'api',
      api,
      productUrlPattern: pattern,
      sampleProductUrls: samples.slice(0, 8),
      fetchStrategy: 'browser',
      confidence,
      sources: [...new Set([...discovery.crawlRecipe.sources, 'network_sniff' as const])],
      notes: [...discovery.crawlRecipe.notes, 'network_sniff: catalog API inferred from XHR/fetch'],
    },
  };
}
