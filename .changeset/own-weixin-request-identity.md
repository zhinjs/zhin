---
"@zhin.js/adapter-weixin-ilink": minor
---

Replace process-global iLink request metadata and logger mutation with immutable endpoint-owned request identity. Every login, polling, typing, upload, and send request now carries the owning endpoint's version and bot agent explicitly, preventing one endpoint from changing another endpoint's wire identity.
