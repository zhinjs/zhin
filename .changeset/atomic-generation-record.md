---
"@zhin.js/plugin-runtime": major
"@zhin.js/runtime": major
"@zhin.js/cli": patch
---

Publish each generation as one committed snapshot-and-state record so Runtime ownership and model sidecars cannot lag behind commit observers. `GenerationCommitEvent` now exposes `previous` and `current` committed records through their `snapshot` and `state` fields.

Make HMR shutdown close admission and await the active reload, stop accepting generation work after a process restart is required, and isolate post-commit observer failures from the committed reload outcome.
