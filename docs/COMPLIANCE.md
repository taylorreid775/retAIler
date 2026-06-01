# Crawling Compliance & Legal Checkpoint

Crawling third-party retail sites carries real Terms-of-Service and legal risk.
Treat this as a gate: **a retailer must pass this checklist before its
`enabled` flag is set to `true` in production.**

## Per-retailer checklist

- [ ] Reviewed the retailer's Terms of Service for scraping/automated-access clauses.
- [ ] Reviewed `robots.txt`; our crawler respects it by default (`respectRobotsTxt`).
- [ ] Confirmed we only collect **factual, public** catalog data (title, price,
      availability, images already publicly served) — not copyrighted prose at scale.
- [ ] Set a polite `requestDelayMs` (default 2000ms) and low `maxConcurrency`.
- [ ] Crawler identifies itself via `CRAWLER_USER_AGENT` where identification is expected.
- [ ] Confirmed data retention + provenance: raw HTML snapshots are stored with
      source URL + timestamp (`page_snapshots`).
- [ ] Legal sign-off recorded (owner + date).

## Engineering safeguards already in place

- `robots.txt` parsing + allow/deny enforcement (`packages/crawler/src/robots.ts`).
- Per-host throttling (`RateLimiter`) and per-retailer `requestDelayMs` / `maxConcurrency`.
- Backoff + retry, with extended backoff on HTTP 429 (`RetryAfterError`).
- HTML snapshotting for provenance and re-extraction (no re-crawl needed).
- Proxy + user-agent rotation are **opt-in** per retailer (`useProxy`).

## Operating principles

- Prefer official product feeds / affiliate APIs where available over crawling.
- Never bypass authentication, paywalls, or anti-bot challenges.
- Honour takedown / opt-out requests promptly by disabling the retailer.
- Keep crawl volume proportionate; cache aggressively.
