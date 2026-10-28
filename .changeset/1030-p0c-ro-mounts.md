---
"@zhin.js/agent": patch
"@zhin.js/tool": patch
---

Isolated shell (docker, workspace-write) now mounts host self-configuration paths (#1030 list A+B: AGENTS.md, skills, .git, package.json, lockfiles, node_modules, root config, ...) read-only on top of the writable workspace, so shell tricks cannot rewrite them. Protected paths are carried on the Tool invocation policy.
