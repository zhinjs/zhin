---
'@zhin.js/permission': patch
'@zhin.js/im-contract': patch
'@zhin.js/adapter': patch
'@zhin.js/plugin-runtime': patch
---

feat(permission): add unified @zhin.js/permission package with builtin DSL (adapter/group/private/channel/user/role), PermissionHost, and platform permit checker. Extract LegacyEndpointControlSurface to im-contract. Support Unicode capability local names in plugin-runtime.
