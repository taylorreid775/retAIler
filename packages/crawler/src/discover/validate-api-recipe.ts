import { createLogger } from '@retailer/core';
import { CrawlRecipeSchema, type CrawlRecipe, type RawExtractedProduct } from '@retailer/schema';
import { type DiscoverContext } from '../adapters/types';
import { discoverProductsFromApiRecipe } from './api-recipe';

const log = createLogger('crawler:validate-api');

export interface ApiRecipeValidation {
  ok: boolean;
  count: number;
  samples: RawExtractedProduct[];
}

/** Probe a recipe by fetching a few products through the generic API discoverer. */
export async function validateApiRecipe(
  recipe: CrawlRecipe,
  retailerKey: string,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
  limit = 3,
): Promise<ApiRecipeValidation> {
  const parsed = CrawlRecipeSchema.safeParse(recipe);
  if (!parsed.success || parsed.data.discoveryMode !== 'api' || !parsed.data.api) {
    return { ok: false, count: 0, samples: [] };
  }

  const samples: RawExtractedProduct[] = [];
  try {
    for await (const raw of discoverProductsFromApiRecipe(parsed.data, retailerKey, {
      limit,
      fetchJson,
    })) {
      if (!raw.title || raw.price == null) continue;
      samples.push(raw);
      if (samples.length >= limit) break;
    }
  } catch (err) {
    log.warn('API recipe validation threw', { err: String(err) });
    return { ok: false, count: 0, samples: [] };
  }

  const ok = samples.length >= Math.min(2, limit);
  return { ok, count: samples.length, samples };
}
