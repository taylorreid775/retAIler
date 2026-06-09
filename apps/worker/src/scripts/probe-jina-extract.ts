import '../load-env.js';
import { fetchJinaMarkdown, extractProductsFromListingMd } from '@retailer/crawler';

const url = process.argv[2];
const patternArg = process.argv[3] ?? '/pdp/';
const domain = process.argv[4] ?? new URL(url).host;

if (!url) {
  console.error('usage: probe-jina-extract <listingUrl> [productUrlPattern] [domain]');
  process.exit(1);
}

const result = await fetchJinaMarkdown(url);
if (!result) {
  console.error('Jina fetch failed');
  process.exit(1);
}

console.log('status:', result.status);
console.log('markdown length:', result.markdown.length);

const pattern = new RegExp(patternArg, 'i');
const origin = `https://${domain}`;

const pdpSample = [...result.markdown.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi)]
  .map((m) => m[2])
  .filter((u) => pattern.test(u))
  .slice(0, 5);
console.log('sample product URLs in md:', pdpSample.length ? pdpSample : '(none)');

const products = extractProductsFromListingMd(result.markdown, {
  retailerKey: domain.replace(/\./g, '-'),
  productUrlPattern: pattern,
  domain,
  origin,
  categoryPath: ['Test'],
});

console.log('extracted products:', products.length);
const withPrice = products.filter((p) => p.price != null).length;
const withImage = products.filter((p) => p.imageUrl != null).length;
console.log('with price:', withPrice, 'with image:', withImage);

for (const p of products.slice(0, 3)) {
  console.log('---');
  console.log('title:', p.title);
  console.log('url:', p.sourceUrl);
  console.log('price:', p.price);
  console.log('image:', p.imageUrl?.slice(0, 80));
}

process.exit(products.length > 0 ? 0 : 1);
