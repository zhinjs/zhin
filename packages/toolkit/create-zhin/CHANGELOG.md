# create-zhin-app

## 1.0.57

### Patch Changes

- Updated dependencies [713445c]
- Updated dependencies [15bbdb3]
- Updated dependencies [0356aa1]
  - @zhin.js/scaffold-wizard@0.2.0

## 1.0.56

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

- Updated dependencies [cc5c94d]
  - @zhin.js/scaffold-wizard@0.1.9

## 1.0.55

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
  - @zhin.js/scaffold-wizard@0.1.8

## 1.0.54

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
  - @zhin.js/scaffold-wizard@0.1.7

## 1.0.53

### Patch Changes

- b2c73bd: fix: 初始化项目后,安装依赖失败
- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [b2c73bd]
- Updated dependencies [c4575c9]
  - @zhin.js/scaffold-wizard@0.1.6

## 1.0.52

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身
- Updated dependencies [7dfafc2]
- Updated dependencies [ae5239c]
  - @zhin.js/scaffold-wizard@0.1.5

## 1.0.51

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [2ef4896]
  - @zhin.js/scaffold-wizard@0.1.4

## 1.0.50

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/scaffold-wizard@0.1.3

## 1.0.49

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
  - @zhin.js/scaffold-wizard@0.1.2

## 1.0.48

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/scaffold-wizard@0.1.1

## 1.0.47

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.0.46

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身
- fdd6653: fix: change inquire list => select

## 1.0.45

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题

## 1.0.44

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化

## 1.0.43

### Patch Changes

- f19d2e0: fix: remove multiple runtime support

## 1.0.42

### Patch Changes

- 775427e: fix: edge 支持

## 1.0.41

### Patch Changes

- 32049f5: fix: init publish

## 1.0.40

### Patch Changes

- 88caeb2: fix: ask user 护栏

## 1.0.39

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 1.0.38

### Patch Changes

- e28fd7c: fix: 重新发版

## 1.0.37

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.36

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.35

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation

## 1.0.34

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.33

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.32

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统

## 1.0.31

### Patch Changes

- 5f5127c: fix: web url 调整

## 1.0.30

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth

## 1.0.29

### Patch Changes

- 8502351: fix: token 优化

## 1.0.28

### Patch Changes

- 634e2d7: fix: ai 强化

## 1.0.27

### Patch Changes

- 48481a8: fix: @zhin.js/adapter-icqq 内置点赞工具
  fix: create-zhin-app 默认增加 send 指令
  fix: @zhin.js/cli 重命名 onborading 为 onborad 并重写实现,新增 zhin send 命令，用于直接通过 send 命令发送消息
  fix: @zhin.js/host-router 新增消息发送 api

## 1.0.26

### Patch Changes

- 1107f69: fix: sys service

## 1.0.25

### Patch Changes

- cca7815: fix: esm 兼容

## 1.0.24

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.23

### Patch Changes

- 2b44e18: fix: change version

## 1.0.22

### Patch Changes

- b27e633: fix: cli 优化

## 1.0.21

### Patch Changes

- 106d357: fix: ai

## 1.0.20

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.19

### Patch Changes

- 52ae08a: fix: 更新消息处理流程

## 1.0.18

### Patch Changes

- 26aba27: fix: error default config

## 1.0.17

### Patch Changes

- 7aa94b1: fix: 更新 create-bot

## 1.0.16

### Patch Changes

- f9faa1d: fix: test release

## 1.0.15

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.14

### Patch Changes

- cda76be: fix: add adapters

## 1.0.13

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持

## 1.0.12

### Patch Changes

- a86424e: fix: 增加 sqlite3 构建提示

## 1.0.11

### Patch Changes

- c1a539e: fix: cli 优化,console 优化

## 1.0.10

### Patch Changes

- 27eb109: fix: 模板项目增加 web 示例

## 1.0.9

### Patch Changes

- 59c84ba: fix: 优化 http 插件配置

## 1.0.8

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.7

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.0.6

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/cli@1.0.5

## 1.0.5

### Patch Changes

- Updated dependencies [d291005]
  - @zhin.js/cli@1.0.4

## 1.0.4

### Patch Changes

- 15be776: fix: 修改 cli 错误,增加 permit

## 1.0.3

### Patch Changes

- Updated dependencies [ffa9cbc]
  - @zhin.js/cli@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [15fc934]
- Updated dependencies [ebf852c]
- Updated dependencies [cd8c8a8]
  - @zhin.js/cli@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/cli@1.0.1
