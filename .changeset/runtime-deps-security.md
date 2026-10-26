---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/mcp": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-wechat-mp": patch
---

Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
