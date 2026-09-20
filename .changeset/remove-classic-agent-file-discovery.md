---
"@zhin.js/agent": patch
"@zhin.js/plugin-group-suite": patch
"zhin.js": patch
---

Remove classic `*.tool.md` and standalone Skill directory discovery from the Agent runtime. Tools now enter through Plugin Runtime `tools/<name>/index.ts` features, Skills use `skills/<name>/SKILL.md`, and Group Suite keeps its database and transient state inside its owning plugin runtime.
