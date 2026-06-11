/**
 * Canonical retailer domain normalization for cross-org dedup and lookups.
 * Strips protocol, www., port, path, and lowercases the host.
 */
export function normalizeRetailerDomain(urlOrHost: string): string {
  const trimmed = urlOrHost.trim();
  if (!trimmed) return '';

  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    const bare = trimmed
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      ?.split(':')[0]
      ?.toLowerCase()
      .replace(/^www\./, '');
    return bare ?? trimmed.toLowerCase();
  }
}

/** Stable retailer key slug derived from a normalized domain. */
export function deriveRetailerKey(domain: string): string {
  return normalizeRetailerDomain(domain)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
