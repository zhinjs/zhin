---
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Ambient engagement no longer goes silent mid-conversation. After the bot speaks, the group is in a conversation with it for `conversationWindowMs` (default 3 minutes): members replying to it are answered whenever the judge agrees, without the interjection cooldown or hourly cap (a 30-per-hour safety ceiling remains). `cooldownMs` and `maxPerHour` now limit only unprompted interjections, and the judge is told when the bot is in a conversation and which lines are its own.
