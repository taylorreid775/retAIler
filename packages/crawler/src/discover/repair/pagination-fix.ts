import type { CrawlRecipe } from '@retailer/schema';
import type { DiscoverContext } from '../../adapters/types.js';
import { applyDetectedPagination, detectPaginationStyle } from '../detect-pagination.js';

/**
 * Re-probe page 1/2 and try alternate pagination styles via shared detection.
 */
export async function tryFixPagination(
  recipe: CrawlRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
): Promise<CrawlRecipe | null> {
  if (recipe.discoveryMode !== 'api' || !recipe.api) return null;

  const detected = await detectPaginationStyle(recipe.api, fetchJson);
  if (!detected || detected.style === 'none') return null;

  const patchedApi = applyDetectedPagination(recipe.api, detected);
  const unchanged =
    patchedApi.pagination.style === recipe.api.pagination.style &&
    patchedApi.pagination.pageParam === recipe.api.pagination.pageParam &&
    patchedApi.pagination.cursorPath === recipe.api.pagination.cursorPath &&
    patchedApi.pagination.nextUrlPath === recipe.api.pagination.nextUrlPath;

  if (unchanged) return null;

  return { ...recipe, api: patchedApi };
}
