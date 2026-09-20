---
"@zhin.js/tool": patch
"@zhin.js/core": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-music": patch
---

Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
