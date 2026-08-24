---
'@zhin.js/adapter': patch
'@zhin.js/adapter-milky': patch
'@zhin.js/adapter-satori': patch
'@zhin.js/adapter-onebot11': patch
'@zhin.js/adapter-onebot12': patch
---

Expose the published imhelper protocol Clients from every Endpoint, preserve native action responses, and route host-owned HTTP, WebSocket, and raw ingress through the Client APIs. Add the shared `ClientEndpoint` deep base so concrete transports inherit one open-gated Client event bridge, and move reverse WebSocket lifecycle and heartbeat cleanup onto the common lifecycle state machine.
