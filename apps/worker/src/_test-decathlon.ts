import { extractFromJsonLd, getAdapter } from '@retailer/crawler';

const url = 'https://www.decathlon.ca/en/p/500-aluminium-bike-multitool/100441/m8386667';

async function main() {
  const adapter = getAdapter('decathlon');
  if (!adapter) {
    console.log('adapter not registered yet');
    return;
  }

  let n = 0;
  for await (const u of adapter.discoverProductUrls({ limit: 5 })) {
    console.log('discovered', u);
    n++;
  }
  console.log('total discovered', n);

  const res = await fetch(url, { headers: { 'user-agent': 'RetAIlerBot/0.1' } });
  const html = await res.text();
  console.log('fetch', { status: res.status, len: html.length });
  const p = extractFromJsonLd(html, url, 'decathlon');
  console.log('extract', p ? { title: p.title, price: p.price, sku: p.retailerSku } : null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
