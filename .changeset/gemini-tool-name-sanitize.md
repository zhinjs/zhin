---
'@zhin.js/ai': patch
---

Send Gemini only valid function names. Tool names that break Gemini's naming rule (for example `60s__skill__60s-life__weather`, which starts with a digit because the plugin key is `60s`) are rewritten for the request and mapped back when the model calls them, so execution and history keep the real names. Valid names and other providers are unchanged.
