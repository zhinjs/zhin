---
"@zhin.js/testing": patch
"@zhin.js/agent": patch
---

`PluginTestKit` accepts a file-backed configuration (`createConfigDocument(path)`) as `config`, so tests share the same file authority as `zhin start` (saved vs applied config, `config:explain`, reload of the config file). Adds end-to-end smoke scenarios for literal-choice config forms, `config:explain` and structured replies.

`@zhin.js/agent` evals gain a structured-reply seed case (mention + text segments) that the nightly real-model run replays under the existing request budget.
