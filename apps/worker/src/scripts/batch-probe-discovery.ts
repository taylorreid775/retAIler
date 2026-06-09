/**
 * Probe site mapping for many stores — no DB writes, no Redis queue.
 * usage: batch-probe-discovery.ts [url...]
 */
import '../load-env.js';
import { discoverSite } from '@retailer/crawler';
import { createLogger } from '@retailer/core';

const log = createLogger('batch-probe');

const DEFAULT_SITES = [
  'https://www.sportchek.ca',
  'https://www.mec.ca',
  'https://www.decathlon.ca',
  'https://www.marks.com',
  'https://www.national-sports.com',
  'https://www.prohockeylife.com',
  'https://www.sportinglife.ca',
  'https://www.atmosphere.ca',
  'https://www.runningroom.com',
  'https://www.altitude-sports.com',
  'https://www.golftown.com',
  'https://www.sportsexperts.ca',
  'https://www.cabelas.ca',
  'https://www.hockeymonkey.ca',
  'https://www.sourceforsports.ca',
  'https://www.lululemon.com',
  'https://www.patagonia.com',
  'https://www.walmart.ca',
  'https://www.canadiantire.ca',
  'https://www.bestbuy.ca',
];

type Row = {
  url: string;
  key: string;
  confidence: number;
  pattern: string;
  mode: string;
  platform: string;
  sitemaps: number;
  samples: number;
  fetch: string;
  notes: string;
};

async function probeOne(url: string): Promise<Row> {
  const started = Date.now();
  try {
    const d = await discoverSite(url, { sampleLimit: 6, corpusLimit: 120 });
    const row: Row = {
      url,
      key: d.key,
      confidence: d.confidence,
      pattern: d.productUrlPattern ?? '—',
      mode: d.crawlRecipe.discoveryMode ?? '—',
      platform: d.crawlRecipe.platform ?? '—',
      sitemaps: d.sitemapUrls.length,
      samples: d.sampleProductUrls.length,
      fetch: d.fetchStrategy,
      notes: d.notes.split(';').slice(0, 2).join('; ').slice(0, 80),
    };
    log.info('probed', { url, ms: Date.now() - started, confidence: row.confidence });
    return row;
  } catch (err) {
    log.warn('probe failed', { url, err: String(err) });
    return {
      url,
      key: '—',
      confidence: 0,
      pattern: '—',
      mode: '—',
      platform: '—',
      sitemaps: 0,
      samples: 0,
      fetch: '—',
      notes: String(err).slice(0, 80),
    };
  }
}

async function main(): Promise<void> {
  const sites = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SITES;
  const rows: Row[] = [];

  // Sequential — polite to retailer sites and avoids local socket exhaustion.
  for (const url of sites) {
    rows.push(await probeOne(url));
  }

  const ok = rows.filter((r) => r.confidence >= 0.7 && r.pattern !== '—');
  const weak = rows.filter((r) => r.confidence > 0 && r.confidence < 0.7);
  const fail = rows.filter((r) => r.confidence <= 0);

  console.log('\n── Summary ──');
  console.log(`Total: ${rows.length}  Strong (≥70%): ${ok.length}  Weak: ${weak.length}  Failed: ${fail.length}`);

  console.log('\n── Results ──');
  console.table(
    rows.map((r) => ({
      store: new URL(r.url).host.replace(/^www\./, ''),
      conf: r.confidence.toFixed(2),
      pattern: r.pattern.length > 24 ? `${r.pattern.slice(0, 24)}…` : r.pattern,
      mode: r.mode,
      platform: r.platform,
      maps: r.sitemaps,
      samples: r.samples,
      fetch: r.fetch,
    })),
  );

  if (fail.length || weak.length) {
    console.log('\n── Needs attention ──');
    for (const r of [...fail, ...weak]) {
      console.log(`• ${r.url}`);
      console.log(`  ${r.notes || 'no pattern / zero confidence'}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
