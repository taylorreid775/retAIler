import type { ApiRecipe, CrawlRecipe, Platform, RetailerFingerprint } from '@retailer/schema';

export interface ProbeResponse {
  status: number;
  body: unknown;
}

export interface ProbeContext {
  origin: string;
  domain: string;
  homepageHtml: string | null;
  fetchJson: (
    url: string,
    headers?: Record<string, string>,
    init?: { method?: 'GET' | 'POST'; body?: string },
  ) => Promise<unknown | null>;
}

export interface ProbeDefinition {
  url: string | ((ctx: ProbeContext) => string);
  method: 'GET' | 'POST';
  headers?: Record<string, string> | ((ctx: ProbeContext) => Record<string, string>);
  body?: string | ((ctx: ProbeContext) => string);
  successCheck: (response: ProbeResponse) => boolean;
}

export interface PlatformPackResult {
  api: ApiRecipe;
  productUrlPattern: string | null;
  probeUrl: string;
}

export interface PlatformPack {
  platform: Platform;
  probes: ProbeDefinition[];
  buildRecipe(ctx: ProbeContext, probeUrl: string, response: ProbeResponse): ApiRecipe | null;
}

type ApiMergeDiscovery = {
  confidence: number;
  productUrlPattern: string | null;
  sampleProductUrls: string[];
  crawlRecipe: CrawlRecipe;
  notes: string;
  fetchStrategy: 'static' | 'browser' | 'jina_reader';
};

/** Merge a validated platform-pack API block into a site discovery result. */
export function mergePlatformPackIntoDiscovery<T extends ApiMergeDiscovery>(
  discovery: T,
  api: ApiRecipe,
  productUrlPattern: string | null,
  sampleUrls: string[],
  platform: CrawlRecipe['platform'],
  probeUrl: string,
  fetchStrategy: 'static' | 'browser',
  confidence: number,
): T {
  const pattern = productUrlPattern ?? discovery.productUrlPattern;
  const samples = sampleUrls.length ? sampleUrls : discovery.sampleProductUrls;

  return {
    ...discovery,
    confidence,
    productUrlPattern: pattern,
    sampleProductUrls: samples.slice(0, 8),
    fetchStrategy,
    notes: `${discovery.notes}; platform pack confirmed catalog API (${probeUrl})`,
    crawlRecipe: {
      ...discovery.crawlRecipe,
      discoveryMode: 'api',
      platform,
      api,
      productUrlPattern: pattern,
      sampleProductUrls: samples.slice(0, 8),
      fetchStrategy,
      confidence,
      sources: [...new Set([...discovery.crawlRecipe.sources, 'platform' as const])],
      notes: [...discovery.crawlRecipe.notes, `platform_pack: ${probeUrl}`],
    },
  };
}
