---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Record redacted model inputs per request for local conversation traces, with reported usage kept separate from context estimates. Preserve trusted conversation and source-message identity, expose details through full-scope read-only Console APIs, and enforce bounded trace retention. Request-body recording is enabled by default and can be disabled with `ai.agent.recordRequestBodies: false`.
