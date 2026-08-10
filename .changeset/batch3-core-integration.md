---
'@zhin.js/core': patch
---

refactor(core): integrate permission host and canonical endpoint control

Adapter now routes recall/edit operations through the canonical EndpointControl
port, with classic $-prefixed methods bridged via resolveEndpointControl.
CommandFeature and MessageCommand accept PermissionHost for declarative
permit checks. Dispatcher accepts an optional permissionHost option.
ImRuntime provides the permission host via DI. MessageCommand uses
toPermissionSubject for duck-typed subject projection.
