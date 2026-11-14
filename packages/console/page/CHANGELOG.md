# @zhin.js/page

## 1.1.19

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/feature-kit@1.1.17

## 1.1.18

### Patch Changes

- c2bbdcf: 页面元数据新增可选 `section`（`overview` / `conversations` / `features` / `plugins` / `ops` / `access`，ADR 0052），声明页面在 Console 导航里属于哪个分区；`definePage` 校验取值，Host 的 `/entries` 与客户端 `resolveEntryRegister` 把它透传到路由 `meta.section`，未知值被丢弃。
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [fd055d2]
- Updated dependencies [fd22375]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/console-contract@1.1.6
  - @zhin.js/plugin-runtime@1.2.0

## 1.1.17

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/console-contract@1.1.5
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/feature-kit@1.1.15

## 1.1.16

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
- Updated dependencies [cbf1fb1]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/console-contract@1.1.4
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/feature-kit@1.1.14

## 1.1.15

### Patch Changes

- fed2c27: Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

  - Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
  - Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
  - Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
  - Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.

- Updated dependencies [fed2c27]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/feature-kit@1.1.13

## 1.1.14

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12

## 1.1.13

### Patch Changes

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/feature-kit@1.1.11

## 1.1.12

### Patch Changes

- 5e878ba: fix(console): match Page/Layout projections by `$projection` brand instead of prototype identity, so Console topology no longer comes back empty when the runtime loads feature packages with a `?zhin-generation` query (Sandbox and other plugin pages were missing).

## 1.1.11

### Patch Changes

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/plugin-runtime@1.1.18

## 1.1.10

### Patch Changes

- af29996: 为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [658a5fb]
- Updated dependencies [144a17b]
- Updated dependencies [af29996]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/console-contract@1.1.3
  - @zhin.js/feature-kit@1.1.9

## 1.1.9

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/feature-kit@1.1.8

## 1.1.8

### Patch Changes

- Updated dependencies [d3563d9]
  - @zhin.js/feature-kit@1.1.7

## 1.1.7

### Patch Changes

- Updated dependencies [064b06d]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.6

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/console-contract@1.1.2
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.5

### Patch Changes

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.4

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12

## 1.1.3

### Patch Changes

- Updated dependencies [fa542a2]
  - @zhin.js/console-contract@1.1.1

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2

## 1.1.1

### Patch Changes

- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/console-contract@1.1.0
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.13

### Patch Changes

- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13

## 1.0.12

### Patch Changes

- Updated dependencies [67ef8c4]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/feature-kit@1.0.12

## 1.0.11

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/feature-kit@1.0.8

## 1.0.7

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/console-contract@1.0.1
  - @zhin.js/feature-kit@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.6

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/feature-kit@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/feature-kit@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
