---
"@zhin.js/agent": patch
---

Nightly evals: serialize and pace real model requests to the Gemini free tier (≥4 s apart, ≤15 RPM). A 429 is retried after 2/4/8 s or after a longer `retryDelay` / `Retry-After`; a daily-quota 429 is never retried and fails the run with a clear message.
