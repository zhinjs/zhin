---
'@zhin.js/cli': patch
---

Return HTTP 403 for Console RPC operations rejected by an authenticated Demo token, preserving 401 for invalid credentials and preventing denied operations from acquiring runtime resources.
