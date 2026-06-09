import '../load-env.js';
import {
  discoverCategoryDirectory,
  extractCategoriesHeuristic,
  fetchJinaMarkdown,
} from '@retailer/crawler';

const url = process.argv[2];
if (!url) {
  console.error('usage: probe-jina-categories <homepageUrl>');
  process.exit(1);
}

const domain = process.argv[3] ?? new URL(url).host;
const skipAi = process.argv.includes('--jina-only');

console.log('homepage:', url);
console.log('domain:', domain);

const fetched = await fetchJinaMarkdown(url);
if (!fetched?.markdown) {
  console.error('Jina fetch failed');
  process.exit(1);
}

console.log('jina markdown length:', fetched.markdown.length);
if (fetched.markdown.includes('Bad Request') && fetched.markdown.length < 500) {
  console.error('site blocks Jina');
  console.log(fetched.markdown);
  process.exit(1);
}

const heuristic = extractCategoriesHeuristic(fetched.markdown, domain);
console.log('\n--- heuristic category extraction:', heuristic.categories.length, '---');
console.log('productUrlPattern:', heuristic.productUrlPattern);
console.log('confidence:', heuristic.confidence);
for (const c of heuristic.categories.slice(0, 15)) {
  console.log(`  ${c.name} -> ${c.url}`);
}

if (skipAi) {
  process.exit(heuristic.categories.length > 0 ? 0 : 1);
}

console.log('\n--- AI category directory discovery ---');
const result = await discoverCategoryDirectory({
  homepageUrl: url,
  domain,
  homepageMarkdown: fetched.markdown,
  spotCheckLimit: 2,
});

if (!result) {
  console.error('category discovery failed (AI, validation, or spot-check)');
  process.exit(1);
}

const { directory } = result;
console.log('confidence:', directory.confidence);
console.log('productUrlPattern:', directory.productUrlPattern);
console.log('pagination:', directory.pagination);
console.log('categories:', directory.categories.length);
if (directory.notes) console.log('notes:', directory.notes);

for (const c of directory.categories.slice(0, 20)) {
  console.log(`  ${c.parentName ? `${c.parentName} > ` : ''}${c.name}`);
  console.log(`    ${c.url}`);
}
if (directory.categories.length > 20) {
  console.log(`  ... +${directory.categories.length - 20} more`);
}

process.exit(0);
