/** Temporary testing hooks — disable before launch. */
export function isDevCrawlNowEnabled(): boolean {
  return process.env.ENABLE_DEV_CRAWL_NOW === 'true';
}
