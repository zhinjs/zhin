---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

Remove the legacy composed side-event mapping aliases in favor of structured `mapNoticeParts` and `mapRequestParts`. Delete unmounted Agent default hook, tool, and subagent modules that exposed no runtime behavior.
