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

  async fetch(url: string): Promise<FetchResult> {
    const context = await this.ensure();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Give client-rendered PDPs a moment to hydrate price/availability.
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const html = await page.content();
      return {
        url,
        status: response?.status() ?? 0,
        html,
        finalUrl: page.url(),
      };
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
