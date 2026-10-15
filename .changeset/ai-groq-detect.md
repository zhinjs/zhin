---
'@zhin.js/ai': patch
---

The Groq gateway preset now uses the same detector as the Groq request fixes: alias `groq` / `groqcloud`, or a `baseUrl` whose hostname is exactly `api.groq.com`. Before, the preset matched any `baseUrl` containing `api.groq.com`, so a lookalike host such as `api.groq.com.evil.example` got the preset's sdk coercion but not the request fixes.
