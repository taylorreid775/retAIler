import { db, eq, schema } from '@retailer/db';
import type { ApiRecipe, CrawlRecipe } from '@retailer/schema';
import { isGraphqlCapture } from './graphql.js';
import type { CapturedRequest } from './network-types.js';
import type { ValidationReport } from './validate-api-recipe.js';

export type EndpointType =
  | 'catalog'
  | 'search'
  | 'product'
  | 'inventory'
  | 'variants'
  | 'graphql';

export interface SaveEndpointInput {
  retailerId: string;
  endpointType: EndpointType;
  url: string;
  method: string;
  headers?: Record<string, string>;
  paginationStyle?: string | null;
  reliabilityScore?: number | null;
  validatedAt?: Date;
}

function endpointTypeFromRecipe(recipe: CrawlRecipe): EndpointType {
  if (recipe.api && isGraphqlCapture({ url: recipe.api.baseUrl, contentType: 'application/json' })) {
    return 'graphql';
  }
  if (recipe.api?.baseUrl.includes('/search')) return 'search';
  return 'catalog';
}

function endpointTypeFromCapture(capture: CapturedRequest): EndpointType {
  if (isGraphqlCapture(capture)) return 'graphql';
  if (/\/search\b/i.test(capture.url)) return 'search';
  return 'catalog';
}

/** Upsert a single retailer endpoint row. */
export async function upsertRetailerEndpoint(
  input: SaveEndpointInput,
  tx: Pick<typeof db, 'insert'> = db,
): Promise<void> {
  const now = input.validatedAt ?? new Date();
  await tx
    .insert(schema.retailerEndpoints)
    .values({
      retailerId: input.retailerId,
      endpointType: input.endpointType,
      url: input.url,
      method: input.method,
      headers: input.headers ?? {},
      paginationStyle: input.paginationStyle ?? null,
      reliabilityScore: input.reliabilityScore ?? null,
      lastValidatedAt: now,
      lastSuccessAt: now,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.retailerEndpoints.retailerId,
        schema.retailerEndpoints.url,
        schema.retailerEndpoints.method,
      ],
      set: {
        endpointType: input.endpointType,
        headers: input.headers ?? {},
        paginationStyle: input.paginationStyle ?? null,
        reliabilityScore: input.reliabilityScore ?? null,
        lastValidatedAt: now,
        lastSuccessAt: now,
        active: true,
      },
    });
}

/** Deactivate stale rows then upsert endpoints from the active recipe. */
export async function syncRetailerEndpointsFromRecipe(
  retailerId: string,
  recipe: CrawlRecipe,
  validationReport?: ValidationReport | null,
): Promise<void> {
  await db
    .update(schema.retailerEndpoints)
    .set({ active: false })
    .where(eq(schema.retailerEndpoints.retailerId, retailerId));

  await saveRetailerEndpointsFromDiscovery(retailerId, recipe, { validationReport });
}

/** Populate retailer_endpoints from validated API recipe and optional network captures. */
export async function saveRetailerEndpointsFromDiscovery(
  retailerId: string,
  recipe: CrawlRecipe,
  options?: {
    validationReport?: ValidationReport | null;
    captures?: CapturedRequest[];
  },
): Promise<void> {
  const api = recipe.api;
  if (!api) return;

  const report = options?.validationReport;
  await upsertRetailerEndpoint({
    retailerId,
    endpointType: endpointTypeFromRecipe(recipe),
    url: api.baseUrl,
    method: api.method,
    headers: api.headers,
    paginationStyle: api.pagination.style,
    reliabilityScore: report?.reliability ?? null,
    validatedAt: new Date(),
  });

  const topCaptures = (options?.captures ?? [])
    .filter((c) => c.productLikeScore >= 0.4)
    .slice(0, 5);

  for (const capture of topCaptures) {
    if (capture.url === api.baseUrl) continue;
    await upsertRetailerEndpoint({
      retailerId,
      endpointType: endpointTypeFromCapture(capture),
      url: capture.url,
      method: capture.method,
      headers: capture.requestHeaders,
      paginationStyle: null,
      reliabilityScore: capture.productLikeScore,
    });
  }
}
