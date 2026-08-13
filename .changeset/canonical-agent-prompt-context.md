---
'@zhin.js/core': major
'@zhin.js/agent': major
'@zhin.js/adapter-icqq': major
'@zhin.js/adapter-github': major
---

Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.
