import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { nextProxy, type Fetcher, type FetchResult } from '@retailer/crawler';

/** Realistic Chrome UA — required to pass Cloudflare on retailers like MEC. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Playwright-backed fetcher for JS-rendered retailers. Reuses one browser +
 * context across fetches. Lives in the worker (not the crawler package) so
 * serverless/web contexts never pull in Playwright.
 */
export class BrowserFetcher implements Fetcher {
  readonly kind = 'browser' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private async ensure(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const proxy = nextProxy();
    this.browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      userAgent: BROWSER_UA,
      locale: 'en-CA',
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });
    return this.context;
  }

  /** API request via Playwright (bypasses Akamai TLS fingerprint blocks on plain fetch). */
  async fetchJson(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
    return this.fetchApi(url, { headers, method: 'GET' });
  }

  async fetchApi(
    url: string,
    opts: { headers: Record<string, string>; method?: 'GET' | 'POST'; body?: string },
  ): Promise<{ status: number; text: string }> {
    const context = await this.ensure();
    const method = opts.method ?? 'GET';
    const response =
      method === 'POST'
        ? await context.request.post(url, { headers: opts.headers, data: opts.body })
        : await context.request.get(url, { headers: opts.headers });
    return { status: response.status(), text: await response.text() };
  }

  async fetch(url: string): Promise<FetchResult> {
    const context = await this.ensure();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const status = response?.status() ?? 0;
      const contentType = response?.headers()['content-type'] ?? '';
      const raw = response ? await response.text() : '';

      // Sitemaps/XML: use the raw response body. page.content() is Chrome's XML
      // viewer HTML and won't parse (MEC/Cloudflare sites hit this).
      if (isXmlBody(url, contentType, raw)) {
        return { url, status, html: raw, finalUrl: page.url() };
      }

      await waitPastCloudflare(page);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      if (url.includes('/product/')) {
        await page
          .waitForFunction(() => document.getElementById('__NEXT_DATA__') != null, { timeout: 20_000 })
          .catch(() => {});
      }
      const html = await page.content();
      return { url, status, html, finalUrl: page.url() };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}

/** Poll until Cloudflare interstitial clears (MEC, etc.). */
async function waitPastCloudflare(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) return;
    await page.waitForTimeout(5_000);
  }
}

function isXmlBody(url: string, contentType: string, body: string): boolean {
  if (contentType.includes('xml')) return true;
  if (/\.xml(?:\?|$)/i.test(url)) return true;
  return body.trimStart().startsWith('<?xml');
}
