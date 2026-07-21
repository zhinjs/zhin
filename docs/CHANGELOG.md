# @zhin.js/docs

## 1.0.45

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

## 1.0.44

### Patch Changes

- 872c583: fix: 代码格式优化

## 1.0.43

### Patch Changes

- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- 7700903: fix: 游戏强化

## 1.0.42

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化

## 1.0.41

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身

## 1.0.40

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 1.0.39

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.

## 1.0.38

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 1.0.37

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化

## 1.0.36

### Patch Changes

- c8f8207: fix: 修复内存泄露问题

## 1.0.35

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.0.34

### Patch Changes

- 90d9efd: fix: 处理包名

## 1.0.33

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题

## 1.0.32

### Patch Changes

- f19d2e0: fix: remove multiple runtime support

## 1.0.31

### Patch Changes

- 775427e: fix: edge 支持

## 1.0.30

### Patch Changes

- 32049f5: fix: init publish

## 1.0.29

### Patch Changes

- 8086ccb: fix: ai 增强/优化

## 1.0.28

### Patch Changes

- 92da96d: fix skill 激活优化

## 1.0.27

### Patch Changes

- cb9fbf1: fix: ai 增强

## 1.0.26

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新

## 1.0.25

### Patch Changes

- e28fd7c: fix: 重新发版

## 1.0.24

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.23

### Patch Changes

- d0250e8: fix: 修复 onebot11 的反向 bug,优化 cli

## 1.0.22

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.21

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation

## 1.0.20

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.19

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理

## 1.0.18

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.17

### Patch Changes

- 607acc4: fix: 视觉模型处理

## 1.0.16

### Patch Changes

- 5a68249: fix: 文档优化

## 1.0.15

### Patch Changes

- ab5c54a: fix: ai 架构优化

## 1.0.14

### Patch Changes

- 631da6e: fix: 约定公开路由前缀/pub

## 1.0.13

### Patch Changes

- 432d0a5: fix: 鉴权优化
- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth

## 1.0.12

### Patch Changes

- 634e2d7: fix: ai 强化

## 1.0.11

### Patch Changes

- 10d8bdc: fix: win 下 dev 错误

## 1.0.10

### Patch Changes

- 771706d: fix: 技能优化

## 1.0.9

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.8

### Patch Changes

- 2b44e18: fix: change version

## 1.0.7

### Patch Changes

- b27e633: fix: cli 优化

## 1.0.6

### Patch Changes

- 106d357: fix: ai

## 1.0.5

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.4

### Patch Changes

- f9faa1d: fix: test release

## 1.0.3

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.2

### Patch Changes

- cda76be: fix: add adapters
