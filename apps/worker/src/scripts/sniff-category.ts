import '../load-env.js';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
  console.error('usage: sniff-category <categoryUrl>');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'en-CA' });
const page = await ctx.newPage();
const hits: { u: string; preview: string }[] = [];
page.on('response', (r) => {
  void (async () => {
    const u = r.url();
    if (!/json|search|apim|catalog/i.test(u) || r.status() >= 400) return;
    try {
      const t = await r.text();
      if (t.length > 300) hits.push({ u, preview: t.slice(0, 500) });
    } catch {
      // ignore
    }
  })();
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
for (const h of hits.slice(0, 8)) {
  console.log('---', h.u);
  console.log(h.preview);
}
await browser.close();
process.exit(0);
