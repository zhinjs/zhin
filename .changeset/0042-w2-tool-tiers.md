---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
---

ADR 0042 W2: resident tools are tiered by scene (group and ordinary private chats keep chat essentials only; master private chat adds development and delegation tools; non-IM turns keep the old default set). Calling an authorized deferred tool by exact name auto-loads it, and `discover` attaches and loads the schemas of its best 1-3 matches. The provider tool list is now stable for prompt caching: resident tools sorted by name, loaded tools in first-load order (new `loadedOrder` in the deferred tool snapshot), new tools only append.
