---
"@zhin.js/adapter-weixin-ilink": patch
---

Require one canonical expanded Weixin iLink endpoint configuration and make each Endpoint own one account-scoped state directory for credentials, long-poll cursors, context tokens, and media. Remove nested endpoint and environment compatibility and add an explicit `dataDir` boundary.
