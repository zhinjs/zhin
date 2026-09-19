---
"@zhin.js/agent": minor
"@zhin.js/plugin-group-suite": minor
"zhin.js": minor
---

Remove classic `*.tool.md` and standalone Skill directory discovery from the Agent runtime. Tools and Skills now enter through Plugin Runtime `$*.ts` features, and Group Suite keeps its database and transient state inside its owning plugin runtime.
