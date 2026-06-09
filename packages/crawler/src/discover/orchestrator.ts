import { createLogger } from '@retailer/core';
import type { RetailerFingerprint } from '@retailer/schema';
import { fingerprintSite } from '../fingerprint';
import { discoverSite, type DiscoverSiteOptions, type SiteDiscovery } from '../discovery';
import { PROMOTION_MIN_CONFIDENCE, type ValidationReport } from './validate-api-recipe';

const log = createLogger('crawler:orchestrator');

/** Reduced limits for the parallel platform-pack track (homepage + fingerprint only need a seed). */
export const PLATFORM_PACK_SEED_SAMPLE_LIMIT = 12;
export const PLATFORM_PACK_SEED_CORPUS_LIMIT = 100;

export interface PlatformPackAttemptResult {
  used: boolean;
  discovery: SiteDiscovery;
  validationReport?: ValidationReport;
}

export interface OrchestratorDeps {
  tryPlatformPack: (
    discovery: SiteDiscovery,
    fingerprint: RetailerFingerprint,
  ) => Promise<PlatformPackAttemptResult>;
}

export interface OrchestratorResult {
  discovery: SiteDiscovery;
  fingerprint: RetailerFingerprint;
  platformPackUsed: boolean;
  apiValidationReport: ValidationReport | null;
  notes: string[];
  staticDiscovery: SiteDiscovery;
  platformPackResult: PlatformPackAttemptResult;
}

/** Score static/sitemap discovery for candidate selection. */
export function scoreStaticDiscovery(discovery: SiteDiscovery): number {
  if (discovery.crawlRecipe.discoveryMode === 'api') {
    return discovery.confidence;
  }
  if (discovery.sitemapUrls.length > 0 && discovery.productUrlPattern) {
    return Math.max(discovery.confidence, 0.6);
  }
  return discovery.confidence;
}

export function isSitemapOnlyDiscovery(discovery: SiteDiscovery): boolean {
  return discovery.crawlRecipe.discoveryMode !== 'api';
}

/**
 * WORKFLOW Stage 5: validated API/platform-pack paths beat sitemap-only static paths
 * when the pack meets promotion thresholds.
 */
export function shouldPreferPlatformPack(
  platformPackResult: PlatformPackAttemptResult,
  staticDiscovery: SiteDiscovery,
): boolean {
  if (!platformPackResult.used || !platformPackResult.validationReport) {
    return false;
  }

  const packConfidence = platformPackResult.validationReport.confidence;
  if (packConfidence < PROMOTION_MIN_CONFIDENCE) {
    return false;
  }

  if (isSitemapOnlyDiscovery(staticDiscovery)) {
    return true;
  }

  return packConfidence >= scoreStaticDiscovery(staticDiscovery);
}

function mergeStaticMetadataIntoPackDiscovery(
  staticDiscovery: SiteDiscovery,
  packDiscovery: SiteDiscovery,
  packConfidence: number,
  staticScore: number,
): SiteDiscovery {
  return {
    ...packDiscovery,
    key: staticDiscovery.key,
    name: staticDiscovery.name,
    domain: staticDiscovery.domain,
    homepageUrl: staticDiscovery.homepageUrl,
    sitemapUrl: staticDiscovery.sitemapUrl,
    sitemapUrls: staticDiscovery.sitemapUrls,
    llmsTxtUrl: staticDiscovery.llmsTxtUrl,
    agentFiles: staticDiscovery.agentFiles,
    crawlDelayMs: staticDiscovery.crawlDelayMs,
    notes: [
      staticDiscovery.notes,
      `orchestrator: selected platform_pack (confidence=${packConfidence.toFixed(2)} vs static=${staticScore.toFixed(2)})`,
    ]
      .filter(Boolean)
      .join('; '),
  };
}

/**
 * Pick the best validated discovery path after parallel Stage 0–1.
 * Validated platform-pack API recipes beat sitemap-only static paths per WORKFLOW Stage 5.
 */
export function selectDiscoveryCandidate(
  staticDiscovery: SiteDiscovery,
  fingerprint: RetailerFingerprint,
  platformPackResult: PlatformPackAttemptResult,
): Pick<
  OrchestratorResult,
  'discovery' | 'fingerprint' | 'platformPackUsed' | 'apiValidationReport' | 'notes'
> {
  const staticScore = scoreStaticDiscovery(staticDiscovery);

  if (shouldPreferPlatformPack(platformPackResult, staticDiscovery)) {
    const packConfidence = platformPackResult.validationReport!.confidence;
    return {
      discovery: mergeStaticMetadataIntoPackDiscovery(
        staticDiscovery,
        platformPackResult.discovery,
        packConfidence,
        staticScore,
      ),
      fingerprint,
      platformPackUsed: true,
      apiValidationReport: platformPackResult.validationReport!,
      notes: [`platform_pack selected (${packConfidence.toFixed(2)} meets promotion threshold)`],
    };
  }

  const notes = [
    staticDiscovery.notes,
    platformPackResult.used
      ? `orchestrator: selected static_site (pack confidence ${platformPackResult.validationReport?.confidence.toFixed(2) ?? 'n/a'} below promotion or static API path preferred)`
      : 'orchestrator: selected static_site (no validated platform pack)',
  ]
    .filter(Boolean)
    .join('; ');

  return {
    discovery: { ...staticDiscovery, notes },
    fingerprint,
    platformPackUsed: false,
    apiValidationReport: null,
    notes: [`static_site selected (score=${staticScore.toFixed(2)})`],
  };
}

/** Re-run platform pack on full static discovery when the parallel seed track did not validate. */
export async function resolvePlatformPackResult(
  staticDiscovery: SiteDiscovery,
  fingerprint: RetailerFingerprint,
  seedPackResult: PlatformPackAttemptResult | null,
  deps: OrchestratorDeps,
): Promise<PlatformPackAttemptResult> {
  if (seedPackResult?.used) {
    return seedPackResult;
  }

  if (seedPackResult && !seedPackResult.used) {
    log.info('seed platform pack track did not validate, retrying with full static fingerprint', {
      key: staticDiscovery.key,
      platform: fingerprint.platform,
      platformConfidence: fingerprint.platformConfidence,
    });
  }

  return deps.tryPlatformPack(staticDiscovery, fingerprint);
}

/**
 * Phase 1.3 — run full static discovery and platform-pack probing in parallel,
 * then select the best validated candidate by confidence.
 */
export async function runParallelDiscoveryStages(
  inputUrl: string,
  fetchText: NonNullable<DiscoverSiteOptions['fetchText']>,
  deps: OrchestratorDeps,
): Promise<OrchestratorResult> {
  const platformPackTrack = async (): Promise<PlatformPackAttemptResult> => {
    const seed = await discoverSite(inputUrl, {
      fetchText,
      sampleLimit: PLATFORM_PACK_SEED_SAMPLE_LIMIT,
      corpusLimit: PLATFORM_PACK_SEED_CORPUS_LIMIT,
    });
    const seedFingerprint = fingerprintSite({
      domain: seed.domain,
      homepageUrl: seed.homepageUrl,
      homepageHtml: seed.homepageHtml,
      agentUrls: seed.crawlRecipe.sampleProductUrls,
    });
    return deps.tryPlatformPack(seed, seedFingerprint);
  };

  const [staticResult, packResult] = await Promise.allSettled([
    discoverSite(inputUrl, { fetchText }),
    platformPackTrack(),
  ]);

  if (staticResult.status === 'rejected') {
    throw staticResult.reason;
  }

  const staticDiscovery = staticResult.value;

  let seedPackResult: PlatformPackAttemptResult | null = null;
  if (packResult.status === 'fulfilled') {
    seedPackResult = packResult.value;
  } else {
    log.warn('seed platform pack track failed', {
      key: staticDiscovery.key,
      err: String(packResult.reason),
    });
  }

  const fingerprint = fingerprintSite({
    domain: staticDiscovery.domain,
    homepageUrl: staticDiscovery.homepageUrl,
    homepageHtml: staticDiscovery.homepageHtml,
    agentUrls: staticDiscovery.crawlRecipe.sampleProductUrls,
  });

  const platformPackResult = await resolvePlatformPackResult(
    staticDiscovery,
    fingerprint,
    seedPackResult,
    deps,
  );

  const selected = selectDiscoveryCandidate(staticDiscovery, fingerprint, platformPackResult);

  log.info('parallel discovery stages complete', {
    key: staticDiscovery.key,
    selected: selected.platformPackUsed ? 'platform_pack' : 'static_site',
    staticScore: scoreStaticDiscovery(staticDiscovery),
    packUsed: platformPackResult.used,
    packConfidence: platformPackResult.validationReport?.confidence,
    seedPackUsed: seedPackResult?.used ?? false,
  });

  return {
    ...selected,
    staticDiscovery,
    platformPackResult,
  };
}
