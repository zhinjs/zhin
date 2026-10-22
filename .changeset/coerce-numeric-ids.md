---
"@zhin.js/agent": patch
---

Accept integer IDs where the structured reply schema expects a string (for example a mention target written as `2100001` instead of `"2100001"`) instead of spending a format-correction model call on them.
