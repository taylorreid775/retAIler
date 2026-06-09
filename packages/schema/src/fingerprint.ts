import { z } from 'zod';

export const PlatformSchema = z.enum([
  'shopify',
  'shopify_hydrogen',
  'salesforce',
  'magento',
  'bigcommerce',
  'woocommerce',
  'sap_commerce',
  'commercetools',
  'custom_react',
  'custom_nextjs',
  'unknown',
]);

export type Platform = z.infer<typeof PlatformSchema>;

export const FrameworkSchema = z.enum(['nextjs', 'react', 'hydrogen', 'stencil', 'unknown']);

export const BotProtectionSchema = z.enum([
  'none',
  'cloudflare',
  'akamai',
  'incapsula',
  'unknown',
]);

export const RecommendedStrategySchema = z.enum([
  'platform_pack',
  'network_sniff',
  'sitemap',
  'jina_nav',
]);

export type RecommendedStrategy = z.infer<typeof RecommendedStrategySchema>;

export const RetailerFingerprintSchema = z.object({
  domain: z.string(),
  platform: PlatformSchema,
  platformConfidence: z.number().min(0).max(1),
  framework: FrameworkSchema,
  commerceEngine: z.string().nullable(),
  botProtection: BotProtectionSchema,
  apiHints: z.array(z.string()),
  bundleSignals: z.array(z.string()),
  recommendedStrategy: RecommendedStrategySchema,
  detectedAt: z.string(),
});

export type RetailerFingerprint = z.infer<typeof RetailerFingerprintSchema>;

/** Map extended fingerprint platforms to crawl-recipe platform values. */
export function toCrawlRecipePlatform(
  platform: Platform,
): 'shopify' | 'bigcommerce' | 'salesforce' | 'unknown' {
  if (platform === 'shopify' || platform === 'shopify_hydrogen') return 'shopify';
  if (platform === 'bigcommerce') return 'bigcommerce';
  if (platform === 'salesforce') return 'salesforce';
  return 'unknown';
}
