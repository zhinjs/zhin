---
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/mcp": patch
"@zhin.js/a2a": patch
"@zhin.js/ai": patch
"@zhin.js/scaffold-wizard": patch
---

fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

- Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
- Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
- Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
- Fix incomplete URL substring sanitization in tests
- Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
- Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
- Update transitive dependencies via `pnpm update`
