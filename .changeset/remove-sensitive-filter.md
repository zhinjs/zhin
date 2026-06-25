---
"@zhin.js/sensitive-filter": major
---

Remove `@zhin.js/sensitive-filter` from the monorepo. Content moderation is an operator policy: use `dispatcher.addGuardrail` and `before.sendMessage` hooks (see ADR 0021 and docs/advanced/content-moderation). No built-in wordlists.
