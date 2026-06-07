import { type CrawlRecipe } from '@retailer/schema';
import { discoverProductsFromApiRecipe } from '../discover/api-recipe';
import { type DiscoverContext, type RetailerAdapter } from './types';

export interface RecipeAdapterConfig {
  key: string;
  name: string;
  domain: string;
  recipe: CrawlRecipe;
}

/** Build a runtime adapter from a persisted crawl recipe (no per-site TS file). */
export function createRecipeAdapter(config: RecipeAdapterConfig): RetailerAdapter {
  const pattern = config.recipe.productUrlPattern
    ? new RegExp(config.recipe.productUrlPattern, 'i')
    : /./;

  return {
    key: config.key,
    name: config.name,
    domain: config.domain,

    isProductUrl(url: string): boolean {
      return pattern.test(url) && url.includes(config.domain);
    },

    async *discoverProducts(ctx: DiscoverContext) {
      yield* discoverProductsFromApiRecipe(config.recipe, config.key, ctx);
    },

    /** API-mode retailers skip URL discovery + per-PDP fetch. */
    async *discoverProductUrls(): AsyncGenerator<string> {},
  };
}
