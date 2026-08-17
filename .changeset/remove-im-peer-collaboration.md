---
'@zhin.js/agent': major
'@zhin.js/ai': major
'@zhin.js/core': major
'@zhin.js/cli': patch
---

Remove the classic Message-based Collaboration Cell execution seam. IM now
serves only as canonical turn ingress and reply delivery; Agent-to-Agent work is
executed by the Orchestration Kernel through `local` Agent bindings or
`remote_mesh` A2A agents.

Remove peer mention routing, synthetic Message bridging, Cell prompt injection,
IM projection executors, `internal_room`, and the dead Collaboration outbound
parser APIs. Orchestration executor and persisted source parsing now fail closed
for removed legacy shapes instead of silently changing execution domains.

`AITriggerConfig.peerMode` and the public `internal_room` / `im_projection`
executor variants are removed. Local task `assignedTo` values now name an Agent
binding; remote tasks name an A2A Agent.
