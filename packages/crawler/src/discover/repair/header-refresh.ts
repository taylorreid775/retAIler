import type { CrawlRecipe } from '@retailer/schema';

/** Authorization is never auto-merged; Cookie is refreshed from browser context. */
const SKIP_HEADER = /^(authorization|set-cookie|content-length)$/i;

/** Merge freshly captured browser headers into an API recipe (deterministic). */
export function refreshApiHeaders(
  recipe: CrawlRecipe,
  captured: Record<string, string>,
): CrawlRecipe | null {
  if (recipe.discoveryMode !== 'api' || !recipe.api) return null;

  const merged: Record<string, string> = { ...recipe.api.headers };
  let changed = false;

  for (const [key, value] of Object.entries(captured)) {
    if (SKIP_HEADER.test(key)) continue;
    if (!value || merged[key] === value) continue;
    merged[key] = value;
    changed = true;
  }

  if (!changed) return null;

  return {
    ...recipe,
    api: {
      ...recipe.api,
      headers: merged,
    },
  };
}
