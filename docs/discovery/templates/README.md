# Retailer Knowledge Templates

Used by `packages/crawler/src/discover/knowledge/writer.ts` to generate per-retailer docs.

Output location: `docs/discovery/retailers/{retailer-key}/`

| Template | Output file |
|----------|-------------|
| [retailer-profile.md](./retailer-profile.md) | `retailer-profile.md` |
| [endpoint-analysis.md](./endpoint-analysis.md) | `endpoint-analysis.md` |
| [crawl-strategy.md](./crawl-strategy.md) | `crawl-strategy.md` |
| [validation-report.md](./validation-report.md) | `validation-report.md` |
| [known-issues.md](./known-issues.md) | `known-issues.md` |
| [CHANGELOG.md](./CHANGELOG.md) | `CHANGELOG.md` |

Placeholders use `{kebab-case}` format. The writer replaces them from structured discovery stage outputs — no LLM generation.
