---
"@zhin.js/adapter-kook": patch
---

Add an opt-in fixed-loopback JSON API fault proxy through the actual SDK Axios HTTPS agent. Preserve the canonical www.kookapp.cn identity and TLS validation, refuse other destinations and redirects, and keep media fetch uploads outside this proxy scope.
