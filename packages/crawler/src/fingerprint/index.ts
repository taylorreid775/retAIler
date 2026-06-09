import {
  type RetailerFingerprint,
  RetailerFingerprintSchema,
  type RecommendedStrategy,
} from '@retailer/schema';
import {
  detectBotProtection,
  detectFramework,
  detectPlatformSignals,
} from './signals.js';

export * from './signals.js';

export interface FingerprintSiteInput {
  domain: string;
  homepageUrl: string;
  homepageHtml: string | null;
  agentUrls?: string[];
  responseHeaders?: Record<string, string>;
}

/**
 * Build a retailer fingerprint from static homepage evidence.
 * Extends legacy `detectPlatform()` with framework, bot protection, and routing hints.
 */
export function fingerprintSite(input: FingerprintSiteInput): RetailerFingerprint {
  const lowerHtml = (input.homepageHtml ?? '').toLowerCase();
  const urls = input.agentUrls ?? [];
  const platformSignals = detectPlatformSignals({ lowerHtml, urls });
  const framework = detectFramework(lowerHtml);
  const botProtection = detectBotProtection(lowerHtml, input.responseHeaders);

  let recommendedStrategy: RecommendedStrategy = 'sitemap';
  if (platformSignals.confidence >= 0.5 && platformSignals.platform !== 'unknown') {
    recommendedStrategy = 'platform_pack';
  } else if (botProtection !== 'none') {
    recommendedStrategy = 'network_sniff';
  } else if (platformSignals.platform === 'custom_nextjs' || framework === 'nextjs') {
    recommendedStrategy = 'network_sniff';
  }

  const fingerprint: RetailerFingerprint = {
    domain: input.domain,
    platform: platformSignals.platform,
    platformConfidence: platformSignals.confidence,
    framework,
    commerceEngine: platformSignals.commerceEngine,
    botProtection,
    apiHints: platformSignals.apiHints,
    bundleSignals: platformSignals.bundleSignals,
    recommendedStrategy,
    detectedAt: new Date().toISOString(),
  };

  return RetailerFingerprintSchema.parse(fingerprint);
}
