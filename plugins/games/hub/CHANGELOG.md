# @zhin.js/plugin-game-hub

## 1.0.20

### Patch Changes

- Updated dependencies [974772e]
- Updated dependencies [1312ca0]
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/game-kit@3.0.12

## 1.0.19

### Patch Changes

- @zhin.js/game-kit@3.0.11
- zhin.js@6.0.11

## 1.0.18

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - zhin.js@6.0.10

## 1.0.17

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - zhin.js@6.0.10
  - @zhin.js/game-kit@3.0.10

## 1.0.16

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/command@1.0.13
  - @zhin.js/game-kit@3.0.9

## 1.0.15

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/game-kit@3.0.8
  - @zhin.js/command@1.0.12

## 1.0.14

### Patch Changes

- @zhin.js/game-kit@3.0.7

## 1.0.13

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/game-kit@3.0.6

## 1.0.12

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/game-kit@3.0.5

## 1.0.11

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/game-kit@3.0.4

## 1.0.10

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/game-kit@3.0.3
  - @zhin.js/command@1.0.8
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.9

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [9f57124]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/game-kit@3.0.2

## 1.0.8

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/game-kit@3.0.1
  - @zhin.js/command@1.0.6

## 1.0.7

### Patch Changes

- Updated dependencies [7c1e63a]
  - @zhin.js/command@1.0.5
  - @zhin.js/game-kit@3.0.0

## 1.0.6

### Patch Changes

- Updated dependencies [d52f3c5]
  - @zhin.js/game-kit@2.0.4

## 1.0.5

### Patch Changes

- @zhin.js/game-kit@2.0.3

## 1.0.4

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/game-kit@2.0.2
  - @zhin.js/command@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [20f5d6c]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
  - @zhin.js/command@1.0.3
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/game-kit@2.0.1

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/game-kit@2.0.0
  - @zhin.js/command@1.0.2

## 1.0.1

### Patch Changes

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/game-kit@1.0.2
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/command@1.0.1
