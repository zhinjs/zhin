---
"@zhin.js/cli": patch
---

Fix start without `@zhin.js/agent`: Console `self-changes` no longer statically imports the optional agent peer, so napcat / non-AI created-project acceptance can reach development readiness again.
