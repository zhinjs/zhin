---
'@zhin.js/core': patch
'@zhin.js/agent': patch
'@zhin.js/adapter-icqq': patch
'@zhin.js/adapter-github': patch
---

Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.
