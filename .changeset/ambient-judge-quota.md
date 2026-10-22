---
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Spare the ambient judge's quota: `judge` accepts a list of models tried in order when one fails or is rate limited (a failed one is passed over for a minute), an idle group is judged at most once per `judgeIntervalMs` (default 30 s), and chat lines sent to the judge are trimmed to 200 characters.
