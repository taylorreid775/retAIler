import { type ListingPagination } from '@retailer/schema';

export interface PaginationState {
  pageIndex: number;
  /** URLs already visited (normalized). */
  seenUrls: Set<string>;
  /** Content hashes of pages already processed. */
  seenHashes: Set<string>;
}

/** Build paginated listing URLs from config (does not include link_rel discovery). */
export function* buildPaginatedUrls(
  baseUrl: string,
  pagination: ListingPagination,
  state: PaginationState,
): Generator<string> {
  const { style, startPage, maxPages } = pagination;
  if (style === 'none') {
    yield baseUrl;
    return;
  }

  if (style === 'link_rel') {
    yield baseUrl;
    return;
  }

  const start = startPage;
  for (let page = start; page < start + maxPages; page++) {
    const url = buildPageUrl(baseUrl, pagination, page);
    const norm = normalizeUrl(url);
    if (state.seenUrls.has(norm)) break;
    state.seenUrls.add(norm);
    yield url;
  }
}

export function buildPageUrl(
  baseUrl: string,
  pagination: ListingPagination,
  page: number,
): string {
  const { style, paramName, pathTemplate } = pagination;

  if (style === 'query_param' && paramName) {
    const u = new URL(baseUrl);
    u.searchParams.set(paramName, String(page));
    return u.toString();
  }

  if (style === 'path_segment' && pathTemplate) {
    const segment = pathTemplate.replace(/\{n\}/g, String(page));
    const base = baseUrl.replace(/\/$/, '');
    if (page === pagination.startPage) return baseUrl;
    return `${base}${segment.startsWith('/') ? '' : '/'}${segment}`;
  }

  return baseUrl;
}

/**
 * Parse markdown for a next-page link. Returns absolute URL or null.
 * Used when pagination.style is `link_rel` or as fallback.
 */
export function findNextPageUrl(
  markdown: string,
  currentUrl: string,
  domain: string,
): string | null {
  const origin = new URL(currentUrl).origin;
  const nextPatterns = [
    /\[[^\]]*(?:next|suivant|→|»|>)[^\]]*\]\(([^)]+)\)/i,
    /\[[^\]]*\]\(([^)]+)\)\s*(?:next|→|»)/i,
    /\[(?:\d+)\]\(([^)]+)\)/,
  ];

  for (const re of nextPatterns) {
    const m = markdown.match(re);
    if (!m?.[1]) continue;
    const resolved = resolveUrl(m[1], origin);
    if (resolved && resolved !== currentUrl && resolved.includes(domain)) {
      return resolved;
    }
  }

  // Increment page query param if present
  try {
    const u = new URL(currentUrl);
    const pageParam = ['page', 'p', 'pg', 'pagenumber'].find((k) => u.searchParams.has(k));
    if (pageParam) {
      const cur = Number.parseInt(u.searchParams.get(pageParam) ?? '1', 10);
      if (Number.isFinite(cur)) {
        u.searchParams.set(pageParam, String(cur + 1));
        return u.toString();
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function resolveUrl(href: string, origin: string): string | null {
  try {
    if (href.startsWith('http')) return href;
    if (href.startsWith('/')) return `${origin}${href}`;
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Simple hash for duplicate-page detection on listing markdown. */
export function markdownContentHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return String(h);
}
