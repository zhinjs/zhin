# @zhin.js/isolate

## 1.1.13

### Patch Changes

- Updated dependencies [0dd657d]
  - @zhin.js/runtime@1.1.13

## 1.1.12

### Patch Changes

- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [bf0fa9f]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/runtime@1.1.12
  - @zhin.js/plugin-runtime@1.1.16

## 1.1.11

### Patch Changes

- Updated dependencies [974fa85]
  - @zhin.js/runtime@1.1.11

## 1.1.10

### Patch Changes

- Updated dependencies [1a11207]
- Updated dependencies [8302701]
- Updated dependencies [de5b2a1]
- Updated dependencies [29d0be9]
  - @zhin.js/runtime@1.1.10

## 1.1.9

### Patch Changes

- Updated dependencies [2b4d6dc]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [8550f17]
- Updated dependencies [7edd04c]
  - @zhin.js/runtime@1.1.9
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.8

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/runtime@1.1.8

## 1.1.7

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [0c35b96]
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/runtime@1.1.7
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [7d2263c]
- Updated dependencies [7d2263c]
- Updated dependencies [a62acca]
- Updated dependencies [386150d]
- Updated dependencies [8e26cf1]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/runtime@1.1.6
  - @zhin.js/plugin-runtime@1.1.13

## 1.1.5

### Patch Changes

- Updated dependencies [badcc1f]
- Updated dependencies [b36452a]
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/runtime@1.1.5

## 1.1.4

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/runtime@1.1.4

## 1.1.3

### Patch Changes

- Updated dependencies [f12e39a]
  - @zhin.js/runtime@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
- Updated dependencies [7a65d32]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/runtime@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [44cf8cb]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [698f16f]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [33ea736]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/runtime@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/plugin-runtime@1.1.9
  - @zhin.js/runtime@1.1.0

## 1.0.19

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/runtime@1.0.19

## 1.0.18

### Patch Changes

- Updated dependencies [fcbff21]
  - @zhin.js/runtime@1.0.18

## 1.0.17

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/runtime@1.0.17

## 1.0.16

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/runtime@1.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [45d4f24]
  - @zhin.js/runtime@1.0.15

## 1.0.14

### Patch Changes

- Updated dependencies [2719580]
- Updated dependencies [c92286c]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
  - @zhin.js/runtime@1.0.14
  - @zhin.js/plugin-runtime@1.1.8

## 1.0.13

### Patch Changes

- Updated dependencies [67ef8c4]
- Updated dependencies [985fa22]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/runtime@1.0.13

## 1.0.12

### Patch Changes

- @zhin.js/runtime@1.0.12

## 1.0.11

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/runtime@1.0.11

## 1.0.10

### Patch Changes

- 63253bb: Restrict Root consumers to the read-only `SnapshotReader` lease interface and
  remove public `RootRuntime.controller` access. Generation commit, transaction,
  close, and stop authority now remain inside the Root lifecycle.

  Close Root admission when rollback cleanup or retired-generation disposal can
  no longer prove lifecycle integrity. Existing leases may drain, but new
  operations and generation transactions fail closed until the Process Host
  stops the Root.

  Bind externally driven capability resources to lifecycle-owned generation admission gates.
  Adapter candidates can establish Endpoint connections during readiness while their IM ingress
  remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
  without closing the old Endpoint before the transaction succeeds.
  Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
  now retain their exact generation until settlement instead of escaping with a live object.

  Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
  connection readiness, and local admission are required generation prerequisites; any failure
  disposes the complete candidate set and leaves the previous generation serving traffic.

  Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
  `HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
  with generation admission so candidate routes cannot shadow committed routes before publish.

  Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
  quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
  only; the previous generation remains untouched until the single synchronous snapshot/admission
  publish point, then drains through its existing leases.
  Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
  database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
  fails closed and awaits candidate cancellation cleanup.

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/runtime@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/runtime@1.0.9

## 1.0.8

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/runtime@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/runtime@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/runtime@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/runtime@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/runtime@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [078e3f7]
- Updated dependencies [43485a9]
- Updated dependencies [8c7d03d]
- Updated dependencies [fa66c4c]
  - @zhin.js/runtime@1.0.3
  - @zhin.js/plugin-runtime@1.1.1

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/runtime@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/runtime@1.0.1
