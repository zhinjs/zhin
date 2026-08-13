---
'@zhin.js/agent': patch
---

Make the full Agent Core depend on one required ToolExecutionAuthority. Policy, approval, journal, cancellation, and execution now remain behind a turn-owned adapter, allowing canonical TurnToolRuntime execution without a second Agent loop or duplicate approval path.
