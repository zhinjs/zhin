---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Remove the process-global remote Agent and task-poller registries. Remote orchestration now receives an explicitly generation-owned `RemoteAgentRegistry`; configured Agent Cards are validated and must be ready before a candidate generation can publish. Delegation, SSE continuations, non-streaming polling, and persisted-task recovery are tracked and drained by that owner, while the old public poller API has been deleted.
