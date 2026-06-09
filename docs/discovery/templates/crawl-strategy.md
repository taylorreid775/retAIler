# Crawl Strategy: {retailer-name}

## Discovery Mode

- **Mode:** `{discovery-mode}`
- **Primary endpoint:** `{primary-endpoint}`
- **Fallback:** `{fallback-mode}`

## Pagination

| Field | Value |
|-------|-------|
| Style | `{pagination-style}` |
| Param | `{pagination-param}` |
| Start page | `{start-page}` |
| Max pages | `{max-pages}` |
| Delay between pages | `{delay-ms}ms` |

## Rate Limits

| Field | Value |
|-------|-------|
| Request delay | `{request-delay-ms}ms` |
| Max concurrency | `{max-concurrency}` |
| Requests per second | `{rps}` |

## Fetch Strategy

- **Strategy:** `{fetch-strategy}`
- **Use proxy:** `{use-proxy}`
- **Respect robots.txt:** `{respect-robots}`

## Extraction (PDP Fallback)

- **Strategy:** `{extraction-strategy}`
- **Image JSON paths:** `{image-json-paths}`
- **Price JSON paths:** `{price-json-paths}`

## Category Dimensions

{category-dimensions}

## Listing Pages

| URL | Label | Pagination | Active |
|-----|-------|------------|--------|
{listing-pages-table}

## Scheduled Crawl

- **Cron:** `{crawl-schedule}`
- **Enabled:** `{enabled}`
