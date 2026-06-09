import type { Platform } from '@retailer/schema';

export interface PlatformSignalInput {
  lowerHtml: string;
  homepageHtml?: string | null;
  urls: string[];
}

function extractSfccSiteFromNextData(html: string): string | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]!) as Record<string, unknown>;
    const props = data.props as Record<string, unknown> | undefined;
    const site =
      (props?.pageProps as Record<string, unknown> | undefined)?.site ??
      props?.site;
    if (typeof site === 'string' && /^[A-Za-z0-9_-]+$/.test(site)) return site;
  } catch {
    // ignore malformed __NEXT_DATA__
  }
  return null;
}

export interface PlatformSignalResult {
  platform: Platform;
  confidence: number;
  commerceEngine: string | null;
  apiHints: string[];
  bundleSignals: string[];
}

/** Weighted platform detection from homepage HTML and discovered URLs. */
export function detectPlatformSignals(input: PlatformSignalInput): PlatformSignalResult {
  const { lowerHtml: lower, urls } = input;
  const html = input.homepageHtml ?? input.lowerHtml;
  const apiHints: string[] = [];
  const bundleSignals: string[] = [];

  const scores = new Map<Platform, number>();

  const add = (platform: Platform, weight: number) => {
    scores.set(platform, (scores.get(platform) ?? 0) + weight);
  };

  if (lower.includes('@shopify/hydrogen') || lower.includes('shopify hydrogen')) {
    add('shopify_hydrogen', 0.45);
    bundleSignals.push('@shopify/hydrogen');
  }
  if (lower.includes('cdn.shopify.com') || lower.includes('shopify.theme')) {
    add('shopify', 0.35);
    bundleSignals.push('cdn.shopify.com');
  }
  if (lower.includes('myshopify.com') || urls.some((u) => u.includes('myshopify.com'))) {
    add('shopify', 0.25);
  }
  if (lower.includes('/products.json') || urls.some((u) => u.includes('/products.json'))) {
    add('shopify', 0.2);
    apiHints.push('/products.json');
  }
  if (lower.includes('shopify-storefront-access-token')) {
    add('shopify', 0.15);
    apiHints.push('storefront-graphql');
  }

  if (lower.includes('bigcommerce') || urls.some((u) => u.includes('bigcommerce.com'))) {
    add('bigcommerce', 0.4);
    bundleSignals.push('bigcommerce');
  }
  if (lower.includes('window.bcdata') || lower.includes('stencilbootstrap')) {
    add('bigcommerce', 0.25);
  }

  if (
    lower.includes('salesforce') ||
    lower.includes('demandware') ||
    lower.includes('dw.ac') ||
    lower.includes('/on/demandware.store/') ||
    urls.some((u) => /\/on\/demandware\.store\//i.test(u))
  ) {
    add('salesforce', 0.35);
    bundleSignals.push('demandware');
  }
  const sfccSite = extractSfccSiteFromNextData(html);
  if (sfccSite && (lower.includes('demandware') || lower.includes('dw.ac'))) {
    add('salesforce', 0.2);
    apiHints.push(`sfcc-site:${sfccSite}`);
  }
  if (/\/s\/[a-z0-9_-]+\/dw\/shop\//i.test(lower)) {
    add('salesforce', 0.1);
    apiHints.push('sfcc-site-path');
  }

  if (lower.includes('mage/') || lower.includes('data-mage-init')) {
    add('magento', 0.35);
    bundleSignals.push('magento');
  }
  if (urls.some((u) => u.includes('/rest/v1/'))) {
    add('magento', 0.2);
    apiHints.push('/rest/V1/');
  }

  if (lower.includes('wp-content') || lower.includes('woocommerce')) {
    add('woocommerce', 0.3);
  }
  if (urls.some((u) => u.includes('/wp-json/wc/store/'))) {
    add('woocommerce', 0.25);
    apiHints.push('/wp-json/wc/store/');
  }

  if (lower.includes('commercetools')) {
    add('commercetools', 0.35);
    bundleSignals.push('commercetools');
  }

  if (lower.includes('__next_data__') || lower.includes('/_next/static/')) {
    add('custom_nextjs', 0.15);
  }

  let platform: Platform = 'unknown';
  let confidence = 0;
  for (const [p, score] of scores) {
    if (score > confidence) {
      platform = p;
      confidence = score;
    }
  }

  confidence = Math.min(1, confidence);

  const commerceEngine =
    platform === 'shopify' || platform === 'shopify_hydrogen'
      ? 'shopify'
      : platform === 'salesforce'
        ? 'demandware'
        : platform === 'bigcommerce'
          ? 'bigcommerce'
          : platform === 'magento'
            ? 'magento'
            : platform === 'woocommerce'
              ? 'woocommerce'
              : platform === 'commercetools'
                ? 'commercetools'
                : null;

  return { platform, confidence, commerceEngine, apiHints, bundleSignals };
}

export function detectFramework(lowerHtml: string): 'nextjs' | 'react' | 'hydrogen' | 'stencil' | 'unknown' {
  if (lowerHtml.includes('@shopify/hydrogen') || lowerHtml.includes('shopify hydrogen')) return 'hydrogen';
  if (lowerHtml.includes('stencilbootstrap') || lowerHtml.includes('window.bcdata')) return 'stencil';
  if (lowerHtml.includes('__next_data__') || lowerHtml.includes('/_next/static/')) return 'nextjs';
  if (lowerHtml.includes('react') || lowerHtml.includes('__react')) return 'react';
  return 'unknown';
}

export function detectBotProtection(
  lowerHtml: string,
  headers: Record<string, string> = {},
): 'none' | 'cloudflare' | 'akamai' | 'incapsula' | 'unknown' {
  const headerBlob = Object.entries(headers)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')
    .toLowerCase();
  if (headerBlob.includes('cloudflare') || lowerHtml.includes('cf-browser-verification')) {
    return 'cloudflare';
  }
  if (lowerHtml.includes('incapsula') || lowerHtml.includes('_incapsula_resource')) {
    return 'incapsula';
  }
  if (headerBlob.includes('akamai') || lowerHtml.includes('akamai')) {
    return 'akamai';
  }
  return 'none';
}

/** Back-compat helper for agent-manifest platform enum. */
export function detectLegacyPlatform(
  lower: string,
  urls: string[],
): 'shopify' | 'bigcommerce' | 'salesforce' | 'unknown' {
  const { platform } = detectPlatformSignals({ lowerHtml: lower, urls });
  if (platform === 'shopify' || platform === 'shopify_hydrogen') return 'shopify';
  if (platform === 'bigcommerce') return 'bigcommerce';
  if (platform === 'salesforce') return 'salesforce';
  return 'unknown';
}
