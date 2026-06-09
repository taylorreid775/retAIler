import '../load-env.js';
import { discoverSite } from '@retailer/crawler';

const url = process.argv[2] ?? 'https://www.sportchek.ca';

async function main(): Promise<void> {
  const d = await discoverSite(url, { sampleLimit: 6, corpusLimit: 80 });
  console.log(
    JSON.stringify(
      {
        llmsTxtUrl: d.llmsTxtUrl,
        agentFiles: d.agentFiles,
        confidence: d.confidence,
        pattern: d.productUrlPattern,
        samples: d.sampleProductUrls,
        sitemapUrls: d.sitemapUrls?.slice(0, 3),
        notes: d.notes,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
