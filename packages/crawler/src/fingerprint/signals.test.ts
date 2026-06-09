import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectPlatformSignals } from './signals.js';

describe('detectPlatformSignals Salesforce', () => {
  it('does not classify generic Next.js __NEXT_DATA__ as Salesforce', () => {
    const result = detectPlatformSignals({
      lowerHtml:
        '<script id="__next_data__">{"props":{"pageProps":{"siteName":"demo"}}}</script>',
      homepageHtml:
        '<script id="__NEXT_DATA__">{"props":{"pageProps":{"siteName":"demo"}}}</script>',
      urls: [],
    });
    assert.notEqual(result.platform, 'salesforce');
  });

  it('adds Salesforce confidence when demandware and SFCC site id co-occur', () => {
    const html =
      '<script id="__NEXT_DATA__">{"props":{"pageProps":{"site":"SportChekCA"}}}</script> demandware dw.ac';
    const result = detectPlatformSignals({
      lowerHtml: html.toLowerCase(),
      homepageHtml: html,
      urls: [],
    });
    assert.equal(result.platform, 'salesforce');
    assert.ok(result.confidence >= 0.5);
  });
});
