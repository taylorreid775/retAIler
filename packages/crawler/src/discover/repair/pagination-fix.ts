import type { CrawlRecipe } from '@retailer/schema';
import { buildApiPageUrl, getAtPath } from '../api-recipe.js';
import type { DiscoverContext } from '../../adapters/types.js';

const PAGE_PARAM_CANDIDATES = ['page', 'p', 'pageNumber', 'page_no', 'pg'];
const OFFSET_PARAM_CANDIDATES = ['offset', 'start', 'from', 'skip'];

function extractProductCount(
  api: NonNullable<CrawlRecipe['api']>,
  data: unknown,
): number {
  const raw = getAtPath(data, api.productsPath);
  return Array.isArray(raw) ? raw.length : 0;
}

function pageUrlsOverlap(page1: unknown, page2: unknown, api: NonNullable<CrawlRecipe['api']>): boolean {
  const r1 = getAtPath(page1, api.productsPath);
  const r2 = getAtPath(page2, api.productsPath);
  if (!Array.isArray(r1) || !Array.isArray(r2) || !r1.length || !r2.length) return true;
  const idPath = api.fieldMap.sku ?? api.fieldMap.url ?? 'id';
  const path = (Array.isArray(idPath) ? idPath[0] : idPath) ?? 'id';
  const ids1 = new Set(
    r1.map((item) => (item && typeof item === 'object' ? String(getAtPath(item, path) ?? '') : '')),
  );
  const overlap = r2.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    return ids1.has(String(getAtPath(item, path) ?? ''));
  }).length;
  return overlap / Math.max(r2.length, 1) > 0.8;
}

/**
 * Re-probe page 1/2 and try alternate pagination param names when overlap is high.
 */
export async function tryFixPagination(
  recipe: CrawlRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
): Promise<CrawlRecipe | null> {
  if (recipe.discoveryMode !== 'api' || !recipe.api) return null;

  const api = recipe.api;
  const page1Url = buildApiPageUrl(api, 1);
  const page1 = await fetchJson(page1Url, api.headers);
  if (!page1 || extractProductCount(api, page1) === 0) return null;

  const page2Url = buildApiPageUrl(api, 2);
  const page2 = await fetchJson(page2Url, api.headers);
  if (!page2 || pageUrlsOverlap(page1, page2, api)) {
    const candidates =
      api.pagination.style === 'offset' ? OFFSET_PARAM_CANDIDATES : PAGE_PARAM_CANDIDATES;

    for (const param of candidates) {
      if (param === api.pagination.pageParam) continue;
      const trial = {
        ...recipe,
        api: {
          ...api,
          pagination: { ...api.pagination, pageParam: param },
        },
      };
      const trialApi = trial.api!;
      const t1 = await fetchJson(buildApiPageUrl(trialApi, 1), trialApi.headers);
      const t2 = await fetchJson(buildApiPageUrl(trialApi, 2), trialApi.headers);
      if (t1 && t2 && !pageUrlsOverlap(t1, t2, trialApi)) {
        return trial;
      }
    }

    if (api.pagination.style === 'page') {
      const offsetTrial = {
        ...recipe,
        api: {
          ...api,
          pagination: {
            ...api.pagination,
            style: 'offset' as const,
            pageParam: 'offset',
          },
        },
      };
      const trialApi = offsetTrial.api!;
      const t1 = await fetchJson(buildApiPageUrl(trialApi, 1), trialApi.headers);
      const t2 = await fetchJson(buildApiPageUrl(trialApi, 2), trialApi.headers);
      if (t1 && t2 && !pageUrlsOverlap(t1, t2, trialApi)) {
        return offsetTrial;
      }
    }
  }

  return null;
}
