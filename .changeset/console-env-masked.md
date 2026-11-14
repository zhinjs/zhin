---
"@zhin.js/console-protocol": minor
"@zhin.js/gateway": minor
"@zhin.js/host-http": minor
"zhin.js": minor
---

Console environment variables are masked by default (#1250). `env:get` now returns `{ format: 'masked', variables: [{ key, masked, hasValue, isReference? }], lines, content }` — first 2 and last 2 characters of values of at least 16 characters, everything else masked, for every key; no value, value length or line length — and never the file as written. The variables are exactly the ones dotenv reads (an unterminated quote no longer swallows the following lines); whatever follows `=` or `:` in a comment is masked. New `env:reveal { filename, key }` returns one variable as written (exactly the text dotenv reads as its value); it needs `ops.env.write` and `ops.env.read` (new `CONSOLE_RPC_ALSO_REQUIRES`; a missing second permission is audited with `detail.reason`) and is audited with the file and key name, never the value. `env:save { filename, changes }` writes only the submitted keys, keeps every other line byte for byte, refuses mask placeholders and quoted values with anything but spaces or `# comment` after the closing quote, and is refused (nothing written) when dotenv would read any unsubmitted key differently afterwards; the whole-file form must declare `mode: 'replace'` and is refused when it holds mask placeholders.

**Breaking for older Consoles:** an older Console's environment page saves the whole file without `mode: 'replace'` (or saves back the masked text), so its env save now fails — upgrade the Console together with the Host.
