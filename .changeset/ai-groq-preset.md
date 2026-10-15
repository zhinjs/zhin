---
'@zhin.js/ai': patch
---

Groq gateway preset for `sdk: openai-compatible` (alias `groq` / `groqcloud`, or a `baseUrl` on `api.groq.com`). Earlier reasoning is replayed as `reasoning` instead of `reasoning_content`, which Groq rejects with a 400 on the second step of every tool loop. `logprobs`, `top_logprobs`, `logit_bias` and `n` > 1 are never sent. `reasoning_effort` only goes to GPT-OSS / Qwen 3, and GPT-OSS defaults to `low` (override with `thinkingLevel`). GPT-OSS is text-only and Llama 4 Scout / Maverick take images. gpt-oss models get a 131072-token context window. A 429 on a per-day window (Groq RPD / TPD) is `quota_exhausted` and falls back without retrying, while per-minute 429s are retried after `retry-after`.
