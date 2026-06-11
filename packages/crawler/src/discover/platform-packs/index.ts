import { createLogger } from '@retailer/core';
import {
  type Platform,
  type RetailerFingerprint,
  toCrawlRecipePlatform,
} from '@retailer/schema';
import { bigcommercePlatformPack, BIGCOMMERCE_PRODUCT_URL_PATTERN } from './bigcommerce.js';
import { commercetoolsPlatformPack, COMMERCETOOLS_PRODUCT_URL_PATTERN } from './commercetools.js';
import { magentoPlatformPack, MAGENTO_PRODUCT_URL_PATTERN } from './magento.js';
import { salesforcePlatformPack, SALESFORCE_PRODUCT_URL_PATTERNS } from './salesforce.js';
import { shopifyPlatformPack, SHOPIFY_PRODUCT_URL_PATTERN } from './shopify.js';
import {
  shopifyHydrogenPlatformPack,
  SHOPIFY_HYDROGEN_PRODUCT_URL_PATTERN,
} from './shopify-hydrogen.js';
import { woocommercePlatformPack, WOOCOMMERCE_PRODUCT_URL_PATTERN } from './woocommerce.js';
import type { PlatformPack, PlatformPackResult, ProbeContext } from './types.js';

const log = createLogger('crawler:platform-packs');

const PACKS: Partial<Record<Platform, PlatformPack>> = {
  shopify: shopifyPlatformPack,
  shopify_hydrogen: shopifyHydrogenPlatformPack,
  salesforce: salesforcePlatformPack,
  magento: magentoPlatformPack,
  bigcommerce: bigcommercePlatformPack,
  woocommerce: woocommercePlatformPack,
  commercetools: commercetoolsPlatformPack,
};

const PRODUCT_URL_PATTERNS: Partial<Record<Platform, string>> = {
  shopify: SHOPIFY_PRODUCT_URL_PATTERN,
  shopify_hydrogen: SHOPIFY_HYDROGEN_PRODUCT_URL_PATTERN,
  salesforce: SALESFORCE_PRODUCT_URL_PATTERNS[0],
  magento: MAGENTO_PRODUCT_URL_PATTERN,
  bigcommerce: BIGCOMMERCE_PRODUCT_URL_PATTERN,
  woocommerce: WOOCOMMERCE_PRODUCT_URL_PATTERN,
  commercetools: COMMERCETOOLS_PRODUCT_URL_PATTERN,
};

function resolveProbeHeaders(
  headers: PlatformPack['probes'][number]['headers'],
  ctx: ProbeContext,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return typeof headers === 'function' ? headers(ctx) : headers;
}

function resolveProbeBody(
  body: PlatformPack['probes'][number]['body'],
  ctx: ProbeContext,
): string | undefined {
  if (!body) return undefined;
  return typeof body === 'function' ? body(ctx) : body;
}

/** Run deterministic platform-specific endpoint probes. */
export async function runPlatformPack(
  fingerprint: RetailerFingerprint,
  ctx: ProbeContext,
): Promise<PlatformPackResult | null> {
  if (fingerprint.platformConfidence < 0.5 || fingerprint.platform === 'unknown') {
    return null;
  }

  const pack = PACKS[fingerprint.platform];
  if (!pack) {
    log.info('no platform pack for fingerprint', { platform: fingerprint.platform });
    return null;
  }

  for (const probe of pack.probes) {
    const url = typeof probe.url === 'function' ? probe.url(ctx) : probe.url;
    if (url.includes('__sfcc_probe_invalid__')) continue;

    const headers = resolveProbeHeaders(probe.headers, ctx);
    const body = resolveProbeBody(probe.body, ctx);
    const method = probe.method ?? 'GET';

    let responseBody: unknown = null;
    try {
      responseBody = await ctx.fetchJson(url, headers, { method, body });
    } catch (err) {
      log.warn('platform pack probe threw', { url, err: String(err) });
      continue;
    }

    const status = responseBody != null ? 200 : 404;
    const response = { status, body: responseBody ?? {} };
    if (!probe.successCheck(response)) {
      log.info('platform pack probe did not match', { url, platform: pack.platform });
      continue;
    }

    const api = pack.buildRecipe(ctx, url, response);
    if (!api) continue;

    const productUrlPattern = PRODUCT_URL_PATTERNS[pack.platform] ?? null;

    log.info('platform pack probe succeeded', { url, platform: pack.platform });
    return { api, productUrlPattern, probeUrl: url };
  }

  return null;
}

export function crawlRecipePlatformFromFingerprint(
  fingerprint: RetailerFingerprint,
): ReturnType<typeof toCrawlRecipePlatform> {
  return toCrawlRecipePlatform(fingerprint.platform);
}

export * from './types.js';
export { shopifyPlatformPack, SHOPIFY_PRODUCT_URL_PATTERN } from './shopify.js';
export {
  shopifyHydrogenPlatformPack,
  SHOPIFY_HYDROGEN_PRODUCT_URL_PATTERN,
} from './shopify-hydrogen.js';
export {
  salesforcePlatformPack,
  SALESFORCE_PRODUCT_URL_PATTERNS,
  extractSalesforceSiteId,
} from './salesforce.js';
export { magentoPlatformPack, MAGENTO_PRODUCT_URL_PATTERN } from './magento.js';
export { bigcommercePlatformPack, BIGCOMMERCE_PRODUCT_URL_PATTERN } from './bigcommerce.js';
export { woocommercePlatformPack, WOOCOMMERCE_PRODUCT_URL_PATTERN } from './woocommerce.js';
export {
  commercetoolsPlatformPack,
  COMMERCETOOLS_PRODUCT_URL_PATTERN,
} from './commercetools.js';
