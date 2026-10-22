---
"@zhin.js/adapter-icqq": patch
---

Group and private share cards are now confirmed with a real message id: ICQQ's share API returns none, so after an accepted share the adapter reads the conversation history for the bot's own newest card (once more after a short wait). When it cannot be found the delivery stays unconfirmed as before; no id is invented.
