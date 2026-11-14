---
"@zhin.js/console-protocol": minor
"@zhin.js/gateway": minor
"@zhin.js/host-http": patch
"zhin.js": patch
---

Console environment variables are masked by default (#1250). `env:get` now returns `{ format: 'masked', variables: [{ key, masked, length, hasValue, isReference? }], lines, content }` — first 2 and last 2 characters of values longer than 8, everything else masked, for every key — and never the file as written. New `env:reveal { filename, key }` returns one variable as written; it needs `ops.env.write` and `ops.env.read` (new `CONSOLE_RPC_ALSO_REQUIRES`) and is audited with the file and key name, never the value. `env:save { filename, changes }` writes only the submitted keys, keeps every other line byte for byte and refuses mask placeholders; the whole-file form must declare `mode: 'replace'` and is refused when it holds mask placeholders.
