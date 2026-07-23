# @zhin.js/pagemanager

## 2.0.5

### Patch Changes

- e5c84ed: Adapter 多账号：插件实例 config 支持 `endpoints: [{name, ...覆盖}]` 数组，`expandEndpointConfigs` 将一个实例展开为多个 endpoint record（id 为 `<slotId>~<name>`，顶层字段共享、逐项覆盖），替代多 `instanceKey` 方案；Console `/api/plugins` 收敛为一个插件卡片 + 多 endpoint。icqq / qq schema 与 README 补 `endpoints` 配置。

  Plugin Runtime Console Host：补 `/esm/*` React/router ESM 代理路由（legacy `consoleApiRouter` 对齐），TypeScriptClientBuilder 裸导入改写为 `/esm/<enc>.mjs`。

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/layout@1.0.2
  - @zhin.js/page@1.0.2
  - @zhin.js/contract@1.0.5

## 2.0.4

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

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/layout@1.0.1
  - @zhin.js/page@1.0.1
  - @zhin.js/contract@1.0.4

## 2.0.3

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/contract@1.0.3

## 2.0.2

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/contract@1.0.2

## 2.0.1

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/contract@1.0.1

## 1.0.4

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/console-types@0.1.5

## 1.0.3

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/console-types@0.1.4

## 1.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3

## 1.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console-types@0.1.2

## 1.0.0

### Major Changes

- Remote Console 与 Host 分离：zhin 主仓仅保留 Console **API**，静态 UI 迁至独立仓库 [zhinjs/console](https://github.com/zhinjs/console)。

  ### @zhin.js/console-core (major)

  - 移除 `./browser` 导出；包仅含 Node 侧 PageManager、`/entries`、`/@dev`、`/esm` 打包管线。
  - 不再依赖 `console-app` 内置壳；`registerBuiltinAppShellServer` 已删除。

  ### @zhin.js/client (minor)

  - 合并原 `@zhin.js/console-core/browser` 能力：`loadConsoleEntries`、`apiFetch`、`getApiBase`、`createRegistryStore` 等。
  - Remote Console UI 应依赖本包 + `zhin-console` 静态站，勿再 `import from '@zhin.js/console-core/browser'`。

  ### @zhin.js/console (major)

  - Host 默认 **api_only**（`serveClientHost: false`），不再捆绑 Farm 静态页。
  - 移除对 `@zhin.js/console-app` 的依赖；`PageManager` 的 esbuild 解析根目录改为机器人项目根（`ZHIN_PROJECT_ROOT` / `cwd`）。
  - 删除 `plugins/services/console/client` 内置 UI 源码（已迁至 zhin-console）。

## 0.1.1

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/console-types@0.1.1
