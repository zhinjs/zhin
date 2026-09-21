# @zhin.js/plugin-content-moderation

## 1.1.3

### Patch Changes

- Updated dependencies [5b5d270]
  - @zhin.js/core@1.1.38

## 1.1.2

### Patch Changes

- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [9110ab8]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [1cb1163]
- Updated dependencies [be3061e]
- Updated dependencies [75f8332]
- Updated dependencies [81935e2]
- Updated dependencies [f9ed01b]
- Updated dependencies [ac0ab50]
- Updated dependencies [5140ce1]
- Updated dependencies [522d75f]
- Updated dependencies [a7611b3]
- Updated dependencies [8823044]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [5c3858e]
  - @zhin.js/core@1.1.37
  - @zhin.js/logger@1.1.1

## 1.1.1

### Patch Changes

- @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/core@1.1.35
  - @zhin.js/logger@1.1.0

## 2.0.1

### Patch Changes

- @zhin.js/core@1.5.16
- zhin.js@7.0.1

## 2.0.0

### Patch Changes

- zhin.js@7.0.0

## 1.0.13

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 1.0.12

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14
  - @zhin.js/logger@1.0.77
  - @zhin.js/middleware@1.0.13
  - zhin.js@6.0.14

## 1.0.11

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13
  - zhin.js@6.0.13

## 1.0.10

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - zhin.js@6.0.12
  - @zhin.js/middleware@1.0.12

## 1.0.9

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11

## 1.0.8

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 1.0.7

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 1.0.6

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/middleware@1.0.10

## 1.0.5

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/middleware@1.0.9

## 1.0.4

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7

## 1.0.3

### Patch Changes

- @zhin.js/core@1.5.6

## 1.0.2

### Patch Changes

- @zhin.js/core@1.5.5

## 1.0.1

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/middleware@1.0.8
