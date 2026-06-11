import type { ApiRecipe } from '@retailer/schema';
import type { CapturedRequest } from './network-types.js';

const COOKIE_NAME_RE = /^\s*([^=;\s]+)/;

/** Headers redacted before persisting HAR artifacts. */
const HAR_REDACT = /^(cookie|authorization|set-cookie|x-api-key|x-auth-token)$/i;

/** Headers excluded from ApiRecipe replay (Authorization never auto-merged). */
const REPLAY_DENY = /^(authorization|set-cookie|content-length)$/i;

/** Parse cookie names from a Cookie request header value. */
export function cookieNamesFromHeader(cookieHeader: string | undefined): string[] {
  if (!cookieHeader?.trim()) return [];
  return cookieHeader
    .split(';')
    .map((part) => COOKIE_NAME_RE.exec(part)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

/** Parse cookie names from Set-Cookie response header values. */
export function cookieNamesFromSetCookie(setCookie: string | string[] | undefined): string[] {
  if (!setCookie) return [];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values
    .map((line) => COOKIE_NAME_RE.exec(line)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

interface CookieSource {
  url: string;
  names: Set<string>;
}

/**
 * Infer cookiesRequired and dependsOn by correlating Set-Cookie responses
 * with subsequent requests that send those cookie names.
 * Input must be in chronological capture order.
 */
export function inferHeaderDependencies(captures: CapturedRequest[]): CapturedRequest[] {
  const sources: CookieSource[] = [];

  return captures.map((capture) => {
    const setCookieRaw = capture.responseHeaders['set-cookie'] ?? capture.responseHeaders['Set-Cookie'];
    const setNames = cookieNamesFromSetCookie(setCookieRaw);
    if (setNames.length) {
      sources.push({ url: capture.url, names: new Set(setNames) });
    }

    const requestCookieNames = cookieNamesFromHeader(
      capture.requestHeaders.cookie ?? capture.requestHeaders.Cookie,
    );

    const cookiesRequired = [...new Set(requestCookieNames)];
    const dependsOn = new Set<string>();

    for (const name of requestCookieNames) {
      for (const source of sources) {
        if (source.names.has(name)) {
          dependsOn.add(source.url);
        }
      }
    }

    return {
      ...capture,
      cookiesRequired,
      dependsOn: dependsOn.size ? [...dependsOn] : undefined,
    };
  });
}

/** Headers safe to replay on ApiRecipe (exclude secrets). */
export function replayableHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!REPLAY_DENY.test(k) && v) out[k] = v;
  }
  return out;
}

/** Redact sensitive header values for HAR export. */
export function redactHeadersForHar(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = HAR_REDACT.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

/** Rank captures for inference while preserving dependency metadata. */
export function rankCapturesByScore(captures: CapturedRequest[]): CapturedRequest[] {
  return [...captures].sort((a, b) => b.productLikeScore - a.productLikeScore);
}

/**
 * Infer header dependencies on chronological captures, then rank for AI selection.
 * `timing.durationMs` may hold capture sequence during collection; normalized here.
 */
export function finalizeCapturedRequests(chronological: CapturedRequest[]): CapturedRequest[] {
  const ordered = [...chronological].sort((a, b) => a.timing.durationMs - b.timing.durationMs);
  const baseTime = ordered[0]?.timing.startMs ?? 0;
  const withTiming = ordered.map((capture, index) => ({
    ...capture,
    timing: {
      startMs: baseTime + index * 100,
      durationMs: index < ordered.length - 1 ? 100 : 500,
    },
  }));
  return rankCapturesByScore(inferHeaderDependencies(withTiming));
}

/** Pick the capture that best matches a recipe base URL. */
export function selectCaptureForReplay(
  captures: CapturedRequest[],
  baseUrl: string,
): CapturedRequest | null {
  if (!captures.length) return null;
  const ranked = rankCapturesByScore(captures);
  const basePath = baseUrl.split('?')[0]!;
  const match = ranked.find((capture) => {
    const capturePath = capture.url.split('?')[0]!;
    return capturePath === basePath || capture.url.startsWith(basePath) || baseUrl.startsWith(capturePath);
  });
  return match ?? ranked[0] ?? null;
}

/**
 * Merge replay context from a browser capture into an ApiRecipe.
 * Cookies are included when the capture sent them (session replay).
 */
export function mergeReplayContextFromCapture(
  api: ApiRecipe,
  capture: CapturedRequest,
): ApiRecipe {
  const headers: Record<string, string> = {
    ...api.headers,
    ...replayableHeaders(capture.requestHeaders),
  };

  const cookie = capture.requestHeaders.cookie ?? capture.requestHeaders.Cookie;
  if (cookie) {
    headers.Cookie = cookie;
  }

  if (!headers.Referer && capture.pageUrl) {
    headers.Referer = capture.pageUrl;
  }
  if (!headers['Accept-Language'] && capture.requestHeaders['accept-language']) {
    headers['Accept-Language'] = capture.requestHeaders['accept-language'];
  }

  const method = capture.method === 'POST' ? 'POST' : api.method;

  return {
    ...api,
    method,
    headers,
    requestBody: capture.requestBody ?? api.requestBody,
    graphqlOperationName: capture.graphqlOperationName ?? api.graphqlOperationName ?? null,
  };
}
