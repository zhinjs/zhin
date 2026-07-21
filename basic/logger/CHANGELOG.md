# @zhin.js/logger

## 1.0.75

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

## 1.0.74

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化

## 1.0.73

### Patch Changes

- 5cc9c03: fix: ai 优化

## 1.0.72

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化

## 1.0.71

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.1.71)

## 0.1.71

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 0.1.70

### Patch Changes

- c8f8207: fix: 修复内存泄露问题

## 0.1.69

### Patch Changes

- 90d9efd: fix: 处理包名

## 0.1.68

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 0.1.67

### Patch Changes

- zhin.js@1.0.85

## 0.1.66

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 0.1.65

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 0.1.64

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 0.1.63

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 0.1.62

### Patch Changes

- zhin.js@1.0.80

## 0.1.61

### Patch Changes

- zhin.js@1.0.79

## 0.1.60

### Patch Changes

- zhin.js@1.0.78

## 0.1.59

### Patch Changes

- zhin.js@1.0.77

## 0.1.58

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 0.1.57

### Patch Changes

- zhin.js@1.0.75

## 0.1.56

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 0.1.55

### Patch Changes

- zhin.js@1.0.73

## 0.1.54

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 0.1.53

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 0.1.52

### Patch Changes

- zhin.js@1.0.68

## 0.1.51

### Patch Changes

- zhin.js@1.0.67

## 0.1.50

### Patch Changes

- zhin.js@1.0.66

## 0.1.49

### Patch Changes

- zhin.js@1.0.65

## 0.1.48

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 0.1.47

### Patch Changes

- zhin.js@1.0.63

## 0.1.46

### Patch Changes

- zhin.js@1.0.62

## 0.1.45

### Patch Changes

- zhin.js@1.0.61

## 0.1.44

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - zhin.js@1.0.60

## 0.1.43

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.1.42

### Patch Changes

- zhin.js@1.0.58

## 0.1.41

### Patch Changes

- zhin.js@1.0.57

## 0.1.40

### Patch Changes

- zhin.js@1.0.56

## 0.1.39

### Patch Changes

- zhin.js@1.0.55

## 0.1.38

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.1.37

### Patch Changes

- zhin.js@1.0.53

## 0.1.36

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 0.1.35

### Patch Changes

- zhin.js@1.0.51

## 0.1.34

### Patch Changes

- zhin.js@1.0.50

## 0.1.33

### Patch Changes

- zhin.js@1.0.49

## 0.1.32

### Patch Changes

- zhin.js@1.0.48

## 0.1.31

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 0.1.30

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 0.1.29

### Patch Changes

- zhin.js@1.0.45

## 0.1.28

### Patch Changes

- zhin.js@1.0.44

## 0.1.27

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 0.1.26

### Patch Changes

- zhin.js@1.0.42

## 0.1.25

### Patch Changes

- zhin.js@1.0.41

## 0.1.24

### Patch Changes

- Updated dependencies [7ef9057]
  - zhin.js@1.0.40

## 0.1.23

### Patch Changes

- zhin.js@1.0.39

## 0.1.22

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38

## 0.1.21

### Patch Changes

- zhin.js@1.0.37

## 0.1.20

### Patch Changes

- zhin.js@1.0.36

## 0.1.19

### Patch Changes

- zhin.js@1.0.35

## 0.1.18

### Patch Changes

- zhin.js@1.0.34

## 0.1.17

### Patch Changes

- zhin.js@1.0.33

## 0.1.16

### Patch Changes

- zhin.js@1.0.32

## 0.1.15

### Patch Changes

- zhin.js@1.0.31

## 0.1.14

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30

## 0.1.13

### Patch Changes

- zhin.js@1.0.29

## 0.1.12

### Patch Changes

- zhin.js@1.0.28

## 0.1.11

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27

## 0.1.10

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26

## 0.1.9

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25

## 0.1.8

### Patch Changes

- zhin.js@1.0.24

## 0.1.7

### Patch Changes

- Updated dependencies [52ae08a]
  - zhin.js@1.0.23

## 0.1.6

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22

## 0.1.5

### Patch Changes

- zhin.js@1.0.21

## 0.1.4

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [5141137]
  - zhin.js@1.0.20

## 0.1.3

### Patch Changes

- f9faa1d: fix: test release

## 0.1.2

### Patch Changes

- d16a69c: fix: test trust publish

## 0.1.1

### Patch Changes

- c8c3996: fix: 修复 segment-matcher
