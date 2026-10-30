# @zhin.js/service-typesafe

## 1.0.13

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/ai@1.1.48

## 1.0.12

### Patch Changes

- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [945303c]
  - @zhin.js/ai@1.1.47

## 1.0.11

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- Updated dependencies [ff87195]
- Updated dependencies [a3b636d]
- Updated dependencies [9cade30]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/ai@1.1.46

## 1.0.10

### Patch Changes

- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45

## 1.0.9

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44

## 1.0.8

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [d9cc732]
  - @zhin.js/ai@1.1.43

## 1.0.7

### Patch Changes

- Updated dependencies [a383380]
  - @zhin.js/ai@1.1.42

## 1.0.6

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

## 1.0.5

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41

## 1.0.4

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40

## 1.0.3

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39

## 1.0.2

### Patch Changes

- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
  - @zhin.js/ai@1.1.38

## 1.0.1

### Patch Changes

- b36452a: Add an optional TypeSafe AI Jev structured-decision provider with typed Choice, Score and Noul results, bounded cancellation-aware requests, response validation, and generation-owned cleanup. Add explicit TypeSafe setup and local doctor checks; preserve chat configuration, store credentials as environment references, and begin recommendation in shadow mode.
- Updated dependencies [b36452a]
  - @zhin.js/ai@1.1.37
