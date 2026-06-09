# Validation Report: {retailer-name}

> Discovery run `{discovery-run-id}` — `{timestamp}`

## Summary

| Metric | Value |
|--------|-------|
| Overall confidence | `{confidence}` |
| Reliability (3-probe) | `{reliability}` |
| Estimated catalog size | `{catalog-size}` |
| Products probed | `{products-probed}` |
| Promotion approved | `{promoted}` |

## Field Presence

| Field | % Present | Required |
|-------|-----------|----------|
| name | `{name-pct}` | Yes |
| sku | `{sku-pct}` | Yes |
| price | `{price-pct}` | Yes |
| url | `{url-pct}` | Yes |
| brand | `{brand-pct}` | Preferred |
| image | `{image-pct}` | Preferred |
| description | `{description-pct}` | Optional |
| gtin/upc | `{gtin-pct}` | High value |
| availability | `{availability-pct}` | Preferred |
| variants | `{variants-pct}` | Platform-dependent |

## Pagination Validation

| Check | Result |
|-------|--------|
| Page 1 items | `{page1-count}` |
| Page 2 items | `{page2-count}` |
| Duplicate overlap | `{overlap-pct}` |
| Pagination style detected | `{pagination-style}` |

## Failure Modes Observed

{failure-modes}

## Sample Products (Anonymized)

```json
{sample-products-json}
```

## Promotion Gate

```
confidence >= 0.7: {confidence-check}
catalog size >= 50: {size-check}
reliability >= 0.9: {reliability-check}
RESULT: {gate-result}
```
