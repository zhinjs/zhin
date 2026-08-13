---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Route production IM Agent turns through the Root-owned `AgentRuntime` and the
generation-owned full `AgentTurnEngine`. Add canonical deferred capability
loading for projected tools and skills, keep policy/audit execution under the
turn authority, and remove the production `ZhinAgent.processTurn` bridge.
