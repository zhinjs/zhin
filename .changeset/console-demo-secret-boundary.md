---
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
---

Return HTTP 403 for a valid demo token that lacks route authority, reserving 401 for invalid authentication so Console does not discard a valid credential on a permission denial. Keep the restricted demo REST surface unchanged. Raw config:get, config:get-all and config:get-source now require full scope because persisted configuration may contain secrets; demo is a limited inspection scope, not a general read-only editor account.
