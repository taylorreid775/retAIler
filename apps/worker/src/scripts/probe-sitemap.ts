import '../load-env.js';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { createLogger } from '@retailer/core';
import { getSitemapChildren, walkSitemap } from '@retailer/crawler';

const log = createLogger('probe-sitemap');
const fetchText = createDiscoverFetchText({ fetchStrategy: 'browser', log });
const sm = process.argv[2];
const filter = process.argv[3] ?? '';
if (!sm) {
  console.error('usage: probe-sitemap <sitemapUrl> [urlFilterSubstring]');
  process.exit(1);
}

const children = await getSitemapChildren(sm, { fetchText });
if (children?.length) {
  console.log('children:', children.length);
  for (const c of children.filter((u) => /product|pdp/i.test(u)).slice(0, 10)) console.log(' child', c);
}

let n = 0;
for await (const url of walkSitemap(sm, (u) => !filter || u.includes(filter), { fetchText })) {
  if (n++ < 20) console.log(url);
}
console.log('count', n);
process.exit(0);
