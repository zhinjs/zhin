---
"@zhin.js/agent": patch
---

Add a scripted-model agent eval framework (`packages/im/agent/evals`) that drives `FullAgentTurnEngine` through `TurnIngress`, with tool, outbound-text, approval and termination assertions; run it with `pnpm eval:agent` (CI gate).
