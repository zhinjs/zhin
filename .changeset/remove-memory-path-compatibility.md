---
'@zhin.js/agent': patch
---

Require the canonical `data/memory/global`, `platforms/<platform>`, and `sessions/<session>` layout. File-memory loading no longer copies or reads root-level legacy files, and the public migration helper has been removed.

Anchor memory path classification to the selected workspace and reject root-level or unknown memory paths. Path resolution, policy checks, and memory reads are now pure and cannot create memory directories as a side effect.
