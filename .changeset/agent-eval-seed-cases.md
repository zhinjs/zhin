---
"@zhin.js/agent": patch
---

Add 27 seed agent eval cases covering QQ regressions, #716/#718 fixes and #719 group-member tightening. The scripted eval driver gains native file/bash tools on a temp workspace, `notOffered` tool-call expectations, model-input assertions and generic provider fault steps, and applies the same group-member restriction as AgentRuntime via the new shared `restrictGroupMemberTurn` helper.
