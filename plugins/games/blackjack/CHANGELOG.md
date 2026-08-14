# @zhin.js/plugin-blackjack

## 0.0.14

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/core@1.5.6
  - @zhin.js/game-kit@3.0.6

## 0.0.13

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/core@1.5.5
  - @zhin.js/game-kit@3.0.5

## 0.0.12

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
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
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - @zhin.js/game-kit@3.0.4
  - @zhin.js/middleware@1.0.8

## 0.0.11

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/game-kit@3.0.3
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/middleware@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 0.0.10

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/game-kit@3.0.2
  - @zhin.js/middleware@1.0.6

## 0.0.9

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/game-kit@3.0.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - @zhin.js/middleware@1.0.5

## 0.0.8

### Patch Changes

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/command@1.0.5
  - @zhin.js/core@1.5.0
  - @zhin.js/game-kit@3.0.0

## 0.0.7

### Patch Changes

- Updated dependencies [d52f3c5]
  - @zhin.js/game-kit@2.0.4

## 0.0.6

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/game-kit@2.0.3

## 0.0.5

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/game-kit@2.0.2
  - @zhin.js/command@1.0.4
  - @zhin.js/middleware@1.0.4
  - @zhin.js/core@1.4.2

## 0.0.4

### Patch Changes

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 48260d4: 游戏迁移到 Plugin Runtime（第二批：blackjack / dice-duel / guess-number）：

  延续 rps 样板，游戏逻辑不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型，消息类型改用 game-kit 的 `GameMessageLike`；移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互死分支（Runtime 下从不执行），命令与 choice 中间件返回文本视图。保留 core 的数据库/内容活 API（`Database`/`Models`/`RelatedModel`/`SendContent`）。

  行为等价（移除的是 Runtime 下恒 null 的死分支）；三个游戏均构建通过、测试全绿（blackjack 16/16、dice-duel 8/8、guess-number 8/8）。

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [f0ec5ab]
- Updated dependencies [20f5d6c]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/command@1.0.3
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/game-kit@2.0.1
  - @zhin.js/core@1.4.1
  - @zhin.js/middleware@1.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/game-kit@2.0.0
  - @zhin.js/command@1.0.2
  - @zhin.js/middleware@1.0.2

## 0.0.2

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

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
  - @zhin.js/core@1.3.5
  - @zhin.js/game-kit@1.0.2
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/command@1.0.1
  - @zhin.js/middleware@1.0.1

## 0.0.1

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - zhin.js@4.1.2
  - @zhin.js/game-shared@1.0.1
