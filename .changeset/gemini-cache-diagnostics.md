---
'@zhin.js/ai': patch
---

Reuse explicit Gemini caches and failure backoff across standalone text completions. Report cache creation failures without exposing prompts, credentials, or upstream error bodies. Repair imported Gemini tool-call histories while preserving signed parts and leaving other providers unchanged.
