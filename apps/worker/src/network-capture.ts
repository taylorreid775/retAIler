import { chromium } from 'playwright';
import { createLogger } from '@retailer/core';
import {
  scoreJsonForProducts,
  buildCapturedRequest,
  finalizeCapturedRequests,
  parseGraphqlOperationName,
  type CapturedRequest,
  type CapturedJsonResponse,
  toCapturedJsonResponse,
} from '@retailer/crawler';

const log = createLogger('worker:network-capture');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RESPONSE_BODY_LIMIT = 256 * 1024;

function seedUrlsFor(inputUrl: string): string[] {
  const origin = new URL(inputUrl).origin;
  const host = new URL(origin).host;
  const seeds = [origin, inputUrl];
  if (host.endsWith('.ca')) {
    seeds.push(`${origin}/en-CA`, `${origin}/fr-CA`, `${origin}/en-ca`);
  }
  if (host.includes('marks.com') || host.includes('atmosphere.ca') || host.includes('sportchek.ca')) {
    seeds.push(`${origin}/en/c/men`, `${origin}/en/c/women`);
  }
  if (host.includes('runningroom.com') || host.includes('shop.runningroom.com')) {
    seeds.push(`${origin}/men-s-running-shoes`, `${origin}/women-s-running-shoes`);
  }
  return [...new Set(seeds)];
}

function mapResourceType(type: string): CapturedRequest['resourceType'] {
  if (type === 'xhr' || type === 'fetch' || type === 'document' || type === 'script') {
    return type;
  }
  return 'fetch';
}

function captureDedupeKey(requestUrl: string, method: string, requestBody?: string): string {
  const bodyKey = requestBody ? requestBody.slice(0, 128) : '';
  return `${method}:${requestUrl}:${bodyKey}`;
}

/**
 * Load seed pages in Playwright and collect full request metadata for catalog APIs.
 * Stage 2 network analysis — headers, bodies, timing, GraphQL ops, cookie deps.
 */
export async function captureNetworkRequests(inputUrl: string): Promise<CapturedRequest[]> {
  const seeds = seedUrlsFor(inputUrl);
  const chronological: CapturedRequest[] = [];
  const seen = new Set<string>();
  let captureSequence = 0;
  const sessionStart = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      locale: 'en-CA',
    });

    for (const pageUrl of seeds.slice(0, 6)) {
      const page = await context.newPage();
      const pending: Promise<void>[] = [];

      page.on('response', (response) => {
        const task = (async () => {
          const requestUrl = response.url();
          const req = response.request();
          const method = req.method();
          const requestBody = req.postData() ?? undefined;
          const dedupeKey = captureDedupeKey(requestUrl, method, requestBody);
          if (seen.has(dedupeKey)) return;

          const status = response.status();
          if (status < 200 || status >= 300) return;

          const contentType = response.headers()['content-type'] ?? '';
          const looksJson =
            contentType.includes('json') ||
            /\/(search|catalog|products|api|graphql)\b/i.test(requestUrl);
          if (!looksJson) return;

          let text: string;
          try {
            text = await response.text();
          } catch {
            return;
          }
          if (text.length < 80) return;

          const productLikeScore = scoreJsonForProducts(text);
          if (productLikeScore < 0.35) return;

          seen.add(dedupeKey);
          const seq = captureSequence++;
          const timingStart = Date.now() - sessionStart;

          chronological.push(
            buildCapturedRequest({
              url: requestUrl,
              pageUrl,
              method,
              resourceType: mapResourceType(req.resourceType()),
              requestHeaders: { ...req.headers() },
              responseHeaders: { ...response.headers() },
              requestBody,
              status,
              contentType,
              responseBody: text.slice(0, RESPONSE_BODY_LIMIT),
              productLikeScore,
              timing: { startMs: timingStart, durationMs: seq },
              cookiesRequired: [],
              graphqlOperationName: parseGraphqlOperationName(requestBody),
            }),
          );
        })().catch((err) => {
          log.warn('network capture handler failed', { pageUrl, err: String(err) });
        });

        pending.push(task);
      });

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(5_000);
      } catch (err) {
        log.warn('network capture page load failed', { pageUrl, err: String(err) });
      }

      await Promise.all(pending);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  chronological.sort((a, b) => a.timing.durationMs - b.timing.durationMs);
  return finalizeCapturedRequests(chronological);
}

/** Legacy wrapper — returns CapturedJsonResponse[] for infer-api compatibility. */
export async function captureNetworkJson(inputUrl: string): Promise<CapturedJsonResponse[]> {
  const captures = await captureNetworkRequests(inputUrl);
  return captures.map(toCapturedJsonResponse);
}
