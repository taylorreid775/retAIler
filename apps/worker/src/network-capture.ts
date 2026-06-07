import { chromium } from 'playwright';
import { createLogger } from '@retailer/core';
import { scoreJsonForProducts, type CapturedJsonResponse } from '@retailer/crawler';

const log = createLogger('worker:network-capture');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SKIP_HEADER = /^(cookie|authorization|set-cookie|content-length)$/i;

function seedUrlsFor(inputUrl: string): string[] {
  const origin = new URL(inputUrl).origin;
  const host = new URL(origin).host;
  const seeds = [origin, inputUrl];
  if (host.endsWith('.ca')) {
    seeds.push(`${origin}/en-CA`, `${origin}/fr-CA`, `${origin}/en-ca`);
  }
  // Category/listing pages trigger catalog search APIs (CT family, Magento+Klevu).
  if (host.includes('marks.com') || host.includes('atmosphere.ca') || host.includes('sportchek.ca')) {
    seeds.push(`${origin}/en/c/men`, `${origin}/en/c/women`);
  }
  if (host.includes('runningroom.com') || host.includes('shop.runningroom.com')) {
    seeds.push(`${origin}/men-s-running-shoes`, `${origin}/women-s-running-shoes`);
  }
  return [...new Set(seeds)];
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SKIP_HEADER.test(k)) out[k] = v;
  }
  return out;
}

/**
 * Load seed pages in Playwright and collect JSON XHR/fetch responses that look
 * like product catalog APIs (sportchek-ai scrape_search_json.py pattern).
 */
export async function captureNetworkJson(inputUrl: string): Promise<CapturedJsonResponse[]> {
  const seeds = seedUrlsFor(inputUrl);
  const captures: CapturedJsonResponse[] = [];
  const seen = new Set<string>();

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
      page.on('response', (response) => {
        void (async () => {
          const requestUrl = response.url();
          if (seen.has(requestUrl)) return;
          const status = response.status();
          if (status < 200 || status >= 300) return;

          const contentType = response.headers()['content-type'] ?? '';
          const looksJson =
            contentType.includes('json') ||
            /\/(search|catalog|products|api)\b/i.test(requestUrl);
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

          seen.add(requestUrl);
          const req = response.request();
          captures.push({
            pageUrl,
            requestUrl,
            method: req.method(),
            requestHeaders: sanitizeHeaders(req.headers()),
            status,
            contentType,
            bodyPreview: text.slice(0, 12_000),
            productLikeScore,
          });
        })();
      });

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(5_000);
      } catch (err) {
        log.warn('network capture page load failed', { pageUrl, err: String(err) });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return captures.sort((a, b) => b.productLikeScore - a.productLikeScore);
}
