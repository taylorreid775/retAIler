import type { CrawlRecipe, RetailerFingerprint } from '@retailer/schema';
import { crawlRecipePlatformFromFingerprint, runPlatformPack } from '../platform-packs/index.js';
import { mergePlatformPackIntoDiscovery } from '../platform-packs/types.js';
import type { SiteDiscovery } from '../../discovery.js';
import type { DiscoverContext } from '../../adapters/types.js';
import { validateApiRecipe } from '../validate-api-recipe.js';

export interface EndpointSwapContext {
  discovery: Pick<
    SiteDiscovery,
    | 'key'
    | 'domain'
    | 'homepageUrl'
    | 'homepageHtml'
    | 'confidence'
    | 'crawlRecipe'
    | 'productUrlPattern'
    | 'sampleProductUrls'
    | 'notes'
    | 'fetchStrategy'
  >;
  fingerprint: RetailerFingerprint;
  fetchJson: NonNullable<DiscoverContext['fetchJson']>;
}

/** Try platform pack alternate endpoints when the active API endpoint fails. */
export async function trySwapEndpoint(ctx: EndpointSwapContext): Promise<CrawlRecipe | null> {
  const { discovery, fingerprint, fetchJson } = ctx;
  if (discovery.crawlRecipe.discoveryMode !== 'api') return null;

  const currentUrl = discovery.crawlRecipe.api?.baseUrl;
  const packResult = await runPlatformPack(fingerprint, {
    origin: discovery.homepageUrl,
    domain: discovery.domain,
    homepageHtml: discovery.homepageHtml ?? '',
    fetchJson,
  });
  if (!packResult || packResult.api.baseUrl === currentUrl) return null;

  const draft = mergePlatformPackIntoDiscovery(
    discovery as SiteDiscovery,
    packResult.api,
    packResult.productUrlPattern,
    [],
    crawlRecipePlatformFromFingerprint(fingerprint),
    packResult.probeUrl,
    discovery.crawlRecipe.fetchStrategy === 'browser' ? 'browser' : 'static',
    discovery.confidence,
  );

  const validation = await validateApiRecipe(draft.crawlRecipe, discovery.key, fetchJson, 3);
  if (!validation.ok) return null;

  return {
    ...draft.crawlRecipe,
    confidence: validation.report.confidence,
  };
}
