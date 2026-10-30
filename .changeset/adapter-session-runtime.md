---
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/feature-kit": patch
"@zhin.js/command": patch
"@zhin.js/handler": patch
"@zhin.js/middleware": patch
"@zhin.js/core": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/client": patch
"@zhin.js/testing": patch
"zhin.js": patch
---

Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.
