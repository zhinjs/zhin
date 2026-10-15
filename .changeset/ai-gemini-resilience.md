---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
---

Gemini coverage for the provider resilience layer (#724). Gemini safety blocks (SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY, RECITATION and blocked prompts) now get a polite refusal and are never retried or sent to a fallback model. A per-day Gemini quota (`QuotaFailure` `PerDay`) skips retries and falls back to the next candidate model. 504 `DEADLINE_EXCEEDED` is reported as a timeout. A new Gemini model-harness preset re-asks an empty reply or a `MALFORMED_FUNCTION_CALL` once on the same model. The nightly capability matrix gets a multimodal column, and `NIGHTLY_PROVIDER=minimax` keeps MiniMax available next to the Gemini default.
