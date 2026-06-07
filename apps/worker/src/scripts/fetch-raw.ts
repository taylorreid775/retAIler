import '../load-env.js';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { createLogger } from '@retailer/core';

const url = process.argv[2];
const log = createLogger('fetch-raw');
const fetchText = createDiscoverFetchText({ fetchStrategy: 'browser', log });
const text = await fetchText(url);
console.log('len', text?.length ?? 0);
console.log(text?.slice(0, 1200) ?? 'null');
process.exit(0);
