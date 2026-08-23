---
title: Documentation content insights loop
---

# Improve documentation from real questions

The Zhin documentation includes a vendor-neutral content-insights client that is disabled by default. It sends anonymous events only when the deployer configures a collector Endpoint, the visitor explicitly gives consent, and the browser does not enable DNT. It uses no cookies or user/device IDs and sends no URL query, fragment, external referrer, IP field, or browser fingerprint.

The loop answers four product questions: what people search for, what they cannot find, which old paths are broken, and which pages they exit from. It is not a user-profiling system.

## Connect a collector Endpoint

Configure two Actions Variables in the repository's Pages deployment environment:

| Variable | Required | Meaning |
| --- | --- | --- |
| `DOCS_INSIGHTS_ENDPOINT` | yes | HTTPS endpoint accepting anonymous JSON `POST` requests |
| `DOCS_INSIGHTS_SITE_ID` | no | Dataset name; defaults to `zhin-docs` and is capped at 40 characters |

The workflow exposes them at build time as `VITE_DOCS_INSIGHTS_ENDPOINT` and `VITE_DOCS_INSIGHTS_SITE_ID`. Without an Endpoint, neither the client nor consent notice runs, so local development, forks, and unconfigured deployments never collect accidentally.

The collector should accept `content-type: application/json`, return any 2xx status, and enforce body-size, rate, and retention limits. A cross-origin collector must allow only the documentation origin. Do not enrich events with IP, User-Agent, or identity data.

## Event contract

Every event contains `schemaVersion`, `event`, a `path` without query or fragment, `locale`, `viewport`, and `siteId`.

| Event | Additional fields | Decision supported |
| --- | --- | --- |
| `page_view` | `previousPath` (same-site path only) | Measure arrival and navigation discoverability |
| `page_exit` | `previousPath`, bucketed `dwell` | Find frequent exit pages and very short visits |
| `not_found` | `previousPath` | Find 404 paths and internal broken links |
| `search` | `searchTerm`, `resultCount` | Discover user language and existing answers |
| `search_no_results` | `searchTerm`, `resultCount=0` | Prioritize missing solutions |

Search terms are capped at 64 characters and restricted to natural-language letters, numbers, spaces, and hyphens. Email addresses, URLs, tokens/secrets, long hashes, mixed alphanumeric credentials, and key-like strings are not sent; only `searchRedacted: true` remains. `dwell` is one of `under_10s`, `10s_to_60s`, `1m_to_5m`, or `over_5m`; time before first consent is excluded.

## Weekly content review

Run one 30-minute review every week and make decisions from aggregates rather than individual events:

1. Aggregate `search_no_results` by normalized term. For the top three, add a solution or improve synonyms and entry points.
2. Aggregate `not_found` by `path + previousPath`. Fix internal sources; add redirects or migration notes for legacy external paths.
3. Aggregate `page_exit` by `path + dwell`. Prioritize high-traffic pages with short dwell and frequent exits; rewrite their opening, action path, and next step.
4. Compare `search` with `page_view`. When an answer exists but remains heavily searched, improve navigation and headings instead of duplicating another page.
5. Record the baseline, change, owner, and next review date. If two weekly reviews show no improvement, reject the hypothesis and revisit user intent.

Review only aggregates with at least 10 events to avoid reacting to tiny samples. Retain raw events for no more than 30 days; aggregate trends may live longer.

## Verify the integration

Build locally with a temporary same-origin collector path:

```bash
VITE_DOCS_INSIGHTS_ENDPOINT=/__docs-insights \
VITE_DOCS_INSIGHTS_SITE_ID=zhin-docs-local \
pnpm docs:build
```

Preview the site, choose “Allow anonymous insights” in the consent notice, then verify:

1. A normal page produces `page_view`.
2. A successful and a random no-result query produce `search` and `search_no_results`.
3. A missing route produces `not_found`.
4. Navigation or closing the page produces `page_exit`, with no `?` or `#` in its path.
5. Denying consent or enabling DNT stops all subsequent requests.

The automated gate `pnpm vitest run tests/docs/docs-insights.test.ts tests/docs/content-insights-loop.test.ts` verifies data minimization, sensitive-query redaction, and the operational contract.

Visitors can use the persistent Privacy control in the lower-right corner to change their choice at any time; denying consent immediately stops subsequent collection. Removing `zhin:docs-insights-consent:v1` from site storage also resets the choice.
