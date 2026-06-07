import { SPORTCHEK_CRAWL_RECIPE } from '@retailer/schema';

/** @deprecated Use SPORTCHEK_CRAWL_RECIPE.api — kept for backward-compatible imports. */
export const SPORTCHEK_SEARCH_API = SPORTCHEK_CRAWL_RECIPE.api!.baseUrl;

/** @deprecated Use SPORTCHEK_CRAWL_RECIPE.api.headers */
export const SPORTCHEK_API_HEADERS = SPORTCHEK_CRAWL_RECIPE.api!.headers;

export { SPORTCHEK_CRAWL_RECIPE };
