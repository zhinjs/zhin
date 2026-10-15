---
"@zhin.js/agent": patch
---

Nightly evals: retry a 503 UNAVAILABLE once (8–15 s, or a longer Retry-After), record runs that stay 503 as provider-unavailable instead of model failures, fail mostly-503 nights as infra-flaky, list budget-skipped runs in the summary, and default to gemini-3.5-flash-lite.
