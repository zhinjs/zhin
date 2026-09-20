---
"@zhin.js/tool": minor
"@zhin.js/core": minor
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/cli": minor
"@zhin.js/adapter-github": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/process-monitor": minor
"@zhin.js/plugin-group-suite": minor
"@zhin.js/plugin-music": minor
---

Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
