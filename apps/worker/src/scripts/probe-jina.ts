import '../load-env.js';
import { fetchJinaMarkdown } from '@retailer/crawler';

const url = process.argv[2];
if (!url) {
  console.error('usage: probe-jina <url>');
  process.exit(1);
}

const result = await fetchJinaMarkdown(url);
if (!result) {
  console.error('Jina fetch failed');
  process.exit(1);
}

console.log('status:', result.status);
console.log('finalUrl:', result.finalUrl);
console.log('markdown length:', result.markdown.length);
console.log('--- preview (first 2000 chars) ---');
console.log(result.markdown.slice(0, 2000));
process.exit(0);
