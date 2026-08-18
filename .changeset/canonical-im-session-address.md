---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Replace Message-shaped session management with canonical session-key interfaces.
`ZhinAgent.archiveSession`, `ZhinAgent.compactSession`, and the session-tree
helpers now accept a stable session key instead of a synthetic IM Message.

Route Plugin Runtime transcript recording, passive group context, management
commands, and Owner approval through immutable Turn access/address data. Owner
approval persistence now has one origin-neutral implementation shared by the
canonical command path and the remaining classic policy adapter. Ordinary IM
turns no longer construct a synthetic Message; that projection is isolated to
configured collaboration Cell orchestration.
