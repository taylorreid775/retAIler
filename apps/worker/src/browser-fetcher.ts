import { chromium, type Browser, type BrowserContext } from 'playwright';
import { serverEnv } from '@retailer/core';
import { nextProxy, type Fetcher, type FetchResult } from '@retailer/crawler';

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
      userAgent: serverEnv().CRAWLER_USER_AGENT,
      locale: 'en-CA',
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });
    return this.context;
  }

  /** API request via Playwright (bypasses Akamai TLS fingerprint blocks on plain fetch). */
  async fetchJson(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
    const context = await this.ensure();
    const response = await context.request.get(url, { headers });
    return { status: response.status(), text: await response.text() };
  }

  async fetch(url: string): Promise<FetchResult> {
    const context = await this.ensure();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = response?.status() ?? 0;
      const contentType = response?.headers()['content-type'] ?? '';
      const raw = response ? await response.text() : '';

      // Sitemaps/XML: use the raw response body. page.content() is Chrome's XML
      // viewer HTML and won't parse (MEC/Cloudflare sites hit this).
      if (isXmlBody(url, contentType, raw)) {
        return { url, status, html: raw, finalUrl: page.url() };
      }

      // PDPs: wait for client hydration, then snapshot the rendered DOM.
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
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

function isXmlBody(url: string, contentType: string, body: string): boolean {
  if (contentType.includes('xml')) return true;
  if (/\.xml(?:\?|$)/i.test(url)) return true;
  return body.trimStart().startsWith('<?xml');
}
