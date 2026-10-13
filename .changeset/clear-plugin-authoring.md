---
"@zhin.js/cli": patch
"@zhin.js/schema": patch
"@zhin.js/command": patch
"@zhin.js/core": patch
"@zhin.js/middleware": patch
"@zhin.js/isolate": patch
"@zhin.js/permission": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"zhin.js": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-short-url": patch
---

Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.
