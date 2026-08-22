---
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

Wire ICQQ login challenges (QR / slider / SMS / auth) through LoginAssist so pending tasks survive Console refresh; add login.list/submit/cancel RPC and TTY stdin consumer.
