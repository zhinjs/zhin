---
'@zhin.js/ai': patch
---

openai-compatible / Ollama transport fixes. Streamed requests now ask for usage (`stream_options.include_usage`), so gateways and Ollama report token counts again (opt out with `compat.includeUsage: false`). `baseUrl` no longer gets `/v1` forced onto a path that already names an API version (`/api/v3`, `/api/paas/v4`, `/v1beta/openai`) or ends in `/openai`; bare hosts still get `/v1`, and `compat.appendV1` forces either behaviour. Image generation and model discovery use the same base URL as chat. Ollama now plans for `OLLAMA_CONTEXT_LENGTH` or 4096 tokens instead of 128k unless `contextWindow` is set, and startup warns when it is missing. The OpenAI prompt-cache key is no longer emitted under a key openai-compatible ignores; `compat.promptCacheKey: true` sends `prompt_cache_key` as a body field.
