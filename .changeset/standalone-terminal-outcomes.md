---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Preserve actual model error/aborted terminals, observed partial results and accumulated usage across standalone Agent tasks. Subagents and deferred workers now report those terminals as errors, and Workroom planning rejects failed responses before parsing JSON. Cancellation retains the caller's original rejection reason and exposes a copied interruption snapshot without retrying tools or changing continuation policies.

Update synchronous subagent callers to read `spawnSync()`'s structured status/result/toolCalls/terminal outcome instead of a string. The built-in waiting tool reports the actual outcome without exposing routing metadata. A failed deferred re-completion now reaches existing main-agent failure gates, which can stop segment continuation that previously proceeded after the hidden error.
