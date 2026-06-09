import { createLogger } from '@retailer/core';
import {
  type Platform,
  type RetailerFingerprint,
  toCrawlRecipePlatform,
} from '@retailer/schema';
import { salesforcePlatformPack, SALESFORCE_PRODUCT_URL_PATTERNS } from './salesforce.js';
import { shopifyPlatformPack, SHOPIFY_PRODUCT_URL_PATTERN } from './shopify.js';
import type { PlatformPack, PlatformPackResult, ProbeContext } from './types.js';

const log = createLogger('crawler:platform-packs');

const PACKS: Partial<Record<Platform, PlatformPack>> = {
  shopify: shopifyPlatformPack,
  shopify_hydrogen: shopifyPlatformPack,
  salesforce: salesforcePlatformPack,
};

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

    let body: unknown = null;
    try {
      body = await ctx.fetchJson(url, probe.headers);
    } catch (err) {
      log.warn('platform pack probe threw', { url, err: String(err) });
      continue;
    }

    const status = body != null ? 200 : 404;
    const response = { status, body: body ?? {} };
    if (!probe.successCheck(response)) {
      log.info('platform pack probe did not match', { url, platform: pack.platform });
      continue;
    }

    const api = pack.buildRecipe(ctx, url, response);
    if (!api) continue;

    const productUrlPattern =
      pack.platform === 'shopify' || pack.platform === 'shopify_hydrogen'
        ? SHOPIFY_PRODUCT_URL_PATTERN
        : SALESFORCE_PRODUCT_URL_PATTERNS[0] ?? null;

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
  salesforcePlatformPack,
  SALESFORCE_PRODUCT_URL_PATTERNS,
  extractSalesforceSiteId,
} from './salesforce.js';
