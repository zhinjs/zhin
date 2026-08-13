---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/tool": patch
---

Publish the built-in file capability family as native, generation-owned ToolFeatures on the canonical IM Turn path.

File execution now requires explicit Turn workspace authority. The shared policy facade canonicalizes existing targets, symlinks, and missing write targets before checking workspace containment and sensitive paths, then passes that exact authorized input to the executor. Missing authority, home-relative paths, directory escape, and symlink escape fail closed. Native read, write, edit, list, glob, and grep tools consume ToolExecutionContext and AbortSignal directly; glob and grep no longer spawn shell commands.

BREAKING CHANGE: `runTurnToolPolicies` is asynchronous and successful/approval decisions carry the authorized input. `createRuntimeTurnRequest` requires `workspaceRoot`, and canonical file tools no longer permit paths outside that workspace.
