# @zhin.js/permission

## 1.1.5

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13

## 1.1.4

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/plugin-runtime@1.1.12

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
