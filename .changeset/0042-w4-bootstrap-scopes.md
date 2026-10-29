---
"@zhin.js/agent": patch
"create-zhin-app": patch
---

ADR 0042 W4: bootstrap section scopes. A section of `AGENTS.md` / `SOUL.md` / `TOOLS.md` can carry `<!-- scope: group -->` (also `private`, `channel`, `master`, `master-private`, comma lists) on the line under its heading; the host injects only the sections matching the turn's scene (conversation type + master or not), byte-stable per scene kind. Unannotated sections apply everywhere. `zhin trace` lists skipped section titles (`bootstrap_skipped`).
