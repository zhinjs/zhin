---
"@zhin.js/agent": minor
"@zhin.js/cli": patch
"zhin.js": minor
---

Remove the implicit classic `web_search` Tool from standalone `AIService` agents. Standalone capabilities are now explicit through per-agent `tools` or the service-owned registration boundary, while the generation runtime remains the sole owner of native Web Tool Features. Move shared Web search infrastructure into the cohesive `web` module and reject ambiguous duplicate registrations.
