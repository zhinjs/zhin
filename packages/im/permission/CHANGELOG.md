# @zhin.js/permission

## 1.1.3

### Patch Changes

- 0de4836: Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11

## 1.1.1

### Patch Changes

- b076eae: Replace the permission host factory with an explicitly owned `PermissionHost` class. Each IM runtime now holds a private permission registry, so platform and custom checkers cannot leak between roots or generations.

  Remove Core's duplicate permit parser, checker, legacy `PermissionFeature`, and process-global platform permit registry. Permit syntax and evaluation now have one owner in `@zhin.js/permission`, and scene-management tool construction no longer mutates global authorization state.

- 4380cf9: Colocate adapter command definitions and Agent Skill handlers with their owning capabilities, and provide a shared validated platform permission constructor.
- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.4

### Patch Changes

- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
  - @zhin.js/plugin-runtime@1.1.8

## 1.0.3

### Patch Changes

- Updated dependencies [67ef8c4]
  - @zhin.js/plugin-runtime@1.1.7

## 1.0.2

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6

## 1.0.1

### Patch Changes

- c106ecc: feat(permission): add unified @zhin.js/permission package with builtin DSL (adapter/group/private/channel/user/role), PermissionHost, and platform permit checker. Extract LegacyEndpointControlSurface to im-contract. Support Unicode capability local names in plugin-runtime.
- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5
