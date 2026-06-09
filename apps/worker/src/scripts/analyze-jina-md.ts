import '../load-env.js';
import { fetchJinaMarkdown } from '@retailer/crawler';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('usage: analyze-jina-md <url> [outfile]');
  process.exit(1);
}

const r = await fetchJinaMarkdown(url);
if (!r) {
  console.error('fetch failed');
  process.exit(1);
}

const md = r.markdown;
const counts = {
  pdpLinks: (md.match(/\/pdp\//gi) ?? []).length,
  mdLinks: (md.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length,
  dollarPrices: (md.match(/\$[\d,]+/g) ?? []).length,
  images: (md.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length,
};
console.log('length:', md.length);
console.log('counts:', counts);

const idx = md.indexOf('/pdp/');
if (idx >= 0) {
  console.log('\n--- context around first /pdp/ ---');
  console.log(md.slice(Math.max(0, idx - 300), idx + 500));
}

// Show lines that look like product cards (price + text)
const lines = md.split('\n');
const productish = lines.filter((l) => /\$[\d,.]+/.test(l) && l.length < 200).slice(0, 15);
console.log('\n--- sample price lines ---');
for (const l of productish) console.log(l);

if (process.argv[3]) {
  writeFileSync(process.argv[3], md);
  console.log('\nwrote', process.argv[3]);
}
