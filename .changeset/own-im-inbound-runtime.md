---
"@zhin.js/core": patch
---

Move Endpoint ingress normalization, generation leases, inbound middleware, handlers, interaction and command routing, Agent fallback, and side-event action scopes into one `InboundRuntime`. Remove the flat `ImRuntime.receiveEndpointEvent()` entry and require Adapter ingress through the canonical `endpointEvents.receive()` gateway.
