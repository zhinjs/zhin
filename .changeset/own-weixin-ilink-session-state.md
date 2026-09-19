---
"@zhin.js/adapter-weixin-ilink": minor
---

Move context tokens, persistence timers, and expired-session cooldowns into endpoint-owned classes. Multiple iLink endpoints no longer share mutable module state, and inbound token updates now produce one persistence side effect.
