import '../load-env.js';
import { discoverSite } from '@retailer/crawler';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { createLogger } from '@retailer/core';
import { captureNetworkJson } from '../network-capture.js';

const log = createLogger('probe');
const fetchText = createDiscoverFetchText({ fetchStrategy: 'browser', log });

const sites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://www.marks.com',
      'https://www.national-sports.com',
      'https://www.runningroom.com',
      'https://www.atmosphere.ca',
      'https://www.sportsexperts.ca',
    ];

for (const url of sites) {
  console.log('\n===', url, '===');
  try {
    const d = await discoverSite(url, { fetchText, sampleLimit: 8 });
    console.log(
      JSON.stringify(
        {
          key: d.key,
          confidence: d.confidence,
          pattern: d.productUrlPattern,
          samples: d.sampleProductUrls?.slice(0, 5),
          sitemapUrls: d.sitemapUrls?.slice(0, 3),
          notes: d.notes,
          mode: d.crawlRecipe?.discoveryMode,
          platform: d.crawlRecipe?.platform,
          recipePattern: d.crawlRecipe?.productUrlPattern,
          recipeSamples: d.crawlRecipe?.sampleProductUrls?.slice(0, 3),
        },
        null,
        2,
      ),
    );
    if (d.confidence <= 0 || !d.productUrlPattern) {
      const captures = await captureNetworkJson(url);
      console.log(
        'network captures:',
        captures.length,
        captures.slice(0, 3).map((c) => ({
          score: c.productLikeScore,
          url: c.requestUrl.slice(0, 120),
        })),
      );
    }
  } catch (e) {
    console.log('ERROR', String(e));
  }
}

process.exit(0);
