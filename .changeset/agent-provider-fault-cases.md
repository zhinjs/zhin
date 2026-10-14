---
"@zhin.js/agent": patch
---

Add PR-gate eval cases for provider resilience (#724): 429 retry then success, retries exhausted with a polite reply, empty reply with and without a re-ask preset, and a malformed tool call.
