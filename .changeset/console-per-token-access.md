---
"@zhin.js/host-http": patch
"@zhin.js/console-contract": patch
"@zhin.js/pagemanager": patch
"@zhin.js/client": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
---

Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
