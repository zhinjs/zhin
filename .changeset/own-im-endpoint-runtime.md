---
"@zhin.js/core": patch
"@zhin.js/cli": patch
---

Move generation-leased Endpoint discovery, capability lookup, Console delivery, controls, and management into a dedicated `EndpointRuntime`. Remove the flat Endpoint methods from `ImRuntime`, migrate Host composition to `im.endpoints`, and narrow the outbound Host dependency to its required runtime port.
