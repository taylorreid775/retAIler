import { chromium } from 'playwright';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Skip headers we should not copy from passive listeners (Cookie added from context). */
const SKIP_LISTENER_HEADER = /^(authorization|set-cookie|content-length)$/i;

/**
 * Try each navigate URL in one browser session. Returns request headers for the
 * target API prefix plus a synthesized Cookie header from the browser context.
 */
export async function captureRequestHeaders(
  navigateUrls: string[],
  targetUrlPrefix?: string,
): Promise<Record<string, string>> {
  const seeds = [...new Set(navigateUrls.filter(Boolean))];
  if (!seeds.length) return {};

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({ userAgent: BROWSER_UA, locale: 'en-CA' });
    const page = await context.newPage();
    let captured: Record<string, string> = {};

    page.on('request', (request) => {
      const url = request.url();
      if (targetUrlPrefix && !url.startsWith(targetUrlPrefix) && !seeds.includes(url)) return;
      const headers = request.headers();
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (!SKIP_LISTENER_HEADER.test(k)) out[k] = v;
      }
      if (Object.keys(out).length) captured = { ...captured, ...out };
    });

    for (const pageUrl of seeds.slice(0, 6)) {
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(2000);
      } catch {
        continue;
      }
      if (targetUrlPrefix && Object.keys(captured).length > 0) break;
    }

    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    if (cookieHeader) {
      captured.Cookie = cookieHeader;
    }

    return captured;
  } finally {
    await browser.close();
  }
}
