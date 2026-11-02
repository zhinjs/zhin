---
"@zhin.js/adapter": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-onebot11": patch
---

Preserve account-profile write acknowledgements already observed before cancellation, distinguish native Discord REST rejection from unknown outcomes, and retain the last valid profile when a newer concurrent read fails. Keep scene-scoped SOUL presence consistent with the actual prompt and allow discovered URLs to pass through the existing network authorization policy.
