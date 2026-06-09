import '../load-env.js';
import { fetchJinaMarkdown, extractProductsFromListingMd } from '@retailer/crawler';

const SITES: Array<{
  label: string;
  url: string;
  pattern: string;
  domain: string;
  minProducts?: number;
}> = [
  {
    label: 'Sport Chek — running shoes PLP',
    url: 'https://www.sportchek.ca/en/cat/activities-and-equipment/running/running-shoes-DC2000805.html',
    pattern: '/pdp/',
    domain: 'www.sportchek.ca',
    minProducts: 5,
  },
  {
    label: 'Sport Chek — homepage',
    url: 'https://www.sportchek.ca',
    pattern: '/pdp/',
    domain: 'www.sportchek.ca',
    minProducts: 0,
  },
  {
    label: 'Lululemon — homepage',
    url: 'https://shop.lululemon.com',
    pattern: '/p/',
    domain: 'shop.lululemon.com',
  },
  {
    label: 'Lululemon — men category',
    url: 'https://shop.lululemon.com/c/men',
    pattern: '/p/',
    domain: 'shop.lululemon.com',
  },
];

let failures = 0;

for (const site of SITES) {
  console.log(`\n=== ${site.label} ===`);
  console.log('url:', site.url);

  const result = await fetchJinaMarkdown(site.url);
  if (!result) {
    console.log('FAIL: Jina fetch returned null');
    failures += 1;
    continue;
  }

  console.log('markdown length:', result.markdown.length);

  if (result.markdown.includes('Bad Request') || result.markdown.length < 300) {
    console.log('WARN: site likely blocks Jina or returned error payload');
    console.log(result.markdown.slice(0, 300));
    continue;
  }

  const pattern = new RegExp(site.pattern, 'i');
  const products = extractProductsFromListingMd(result.markdown, {
    retailerKey: site.domain,
    productUrlPattern: pattern,
    domain: site.domain,
    origin: `https://${site.domain}`,
    categoryPath: ['Probe'],
  });

  const withPrice = products.filter((p) => p.price != null).length;
  const withImage = products.filter((p) => p.imageUrl != null).length;
  console.log('products:', products.length, '| price:', withPrice, '| image:', withImage);

  if (site.minProducts != null && products.length < site.minProducts) {
    console.log(`FAIL: expected >= ${site.minProducts} products`);
    failures += 1;
  } else if (products[0]) {
    console.log('sample:', {
      title: products[0].title,
      price: products[0].price,
      url: products[0].sourceUrl.slice(0, 80),
    });
  }
}

console.log(`\nDone. failures: ${failures}`);
process.exit(failures > 0 ? 1 : 0);
