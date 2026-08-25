# @zhin.js/service-activity-feedback

## 3.0.17

### Patch Changes

- 45d4f24: Fix direct ICQQ password configuration, keep Plugin-local JSON Schema references and UI annotations valid during runtime config composition, and make activity feedback rollback safe before generation activation.
  - zhin.js@6.0.14

## 3.0.16

### Patch Changes

- 2719580: Publish source-aligned configuration enums for Agent execution policies and the complete activity feedback Schema, including lifecycle phases, Schedule aliases, conversation scenes, presentation types, defaults, dynamic override paths, and localized field descriptions.
- 902fa35: Separate Adapter definitions from live Endpoint responsibilities in activity feedback. Runtime feedback now depends on a narrow outbound send port and the concrete Endpoint control surface instead of fabricating the legacy all-in-one Adapter class.
- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- Updated dependencies [e9c6a73]
- Updated dependencies [902fa35]
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/agent@1.1.16
  - @zhin.js/logger@1.0.77
  - zhin.js@6.0.14

## 3.0.15

### Patch Changes

- Updated dependencies [3dbf990]
  - @zhin.js/agent@1.1.15
  - zhin.js@6.0.13

## 3.0.14

### Patch Changes

- 5969c5b: Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
- Updated dependencies [d336a3f]
- Updated dependencies [0c82a7e]
- Updated dependencies [b9217e4]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [63d89f9]
- Updated dependencies [71c7cdd]
- Updated dependencies [3cca0ea]
- Updated dependencies [1312ca0]
- Updated dependencies [985fa22]
- Updated dependencies [04b861d]
- Updated dependencies [a23d544]
- Updated dependencies [8cddabf]
- Updated dependencies [dbe5081]
  - @zhin.js/agent@1.1.14
  - zhin.js@6.0.12

## 3.0.13

### Patch Changes

- @zhin.js/agent@1.1.13
- zhin.js@6.0.11

## 3.0.12

### Patch Changes

- @zhin.js/agent@1.1.12
- zhin.js@6.0.10

## 3.0.11

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - zhin.js@6.0.10
  - @zhin.js/agent@1.1.11

## 3.0.10

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/agent@1.1.10
  - zhin.js@6.0.9

## 3.0.9

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [6fb24dd]
- Updated dependencies [d162216]
- Updated dependencies [7427818]
- Updated dependencies [90da255]
- Updated dependencies [8e973dc]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/agent@1.1.9
  - zhin.js@6.0.8

## 3.0.8

### Patch Changes

- @zhin.js/agent@1.1.8
- zhin.js@6.0.7

## 3.0.7

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/agent@1.1.7
  - zhin.js@6.0.6

## 3.0.6

### Patch Changes

- @zhin.js/agent@1.1.6
- zhin.js@6.0.5

## 3.0.5

### Patch Changes

- 51015d6: refactor(adapters): migrate platform-permit to PermissionSubject

  All adapter platform-permit checkers now accept PermissionSubject
  (duck-typed from Message/CommandSession) instead of Message directly.
  registerPlatformPermitChecker is replaced by host.registerPlatform in
  the adapter plugin setup. activity-feedback service updated for new
  PermissionHost integration.

- Updated dependencies [6f9c366]
- Updated dependencies [373a56b]
- Updated dependencies [0de46a8]
- Updated dependencies [c106ecc]
- Updated dependencies [ba08a2f]
- Updated dependencies [b08f7fe]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [a9fa72e]
- Updated dependencies [c8de3ef]
- Updated dependencies [60f0fc8]
- Updated dependencies [574c990]
- Updated dependencies [d096f16]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [d047869]
- Updated dependencies [162fa34]
- Updated dependencies [e62561e]
- Updated dependencies [3eeeb46]
- Updated dependencies [85d0f82]
- Updated dependencies [61bfc1c]
- Updated dependencies [04bad47]
- Updated dependencies [e40b048]
- Updated dependencies [5a5b1bb]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [7123c47]
- Updated dependencies [05befc1]
- Updated dependencies [0663b6a]
- Updated dependencies [f28f9b3]
- Updated dependencies [9f340f7]
- Updated dependencies [e53444f]
- Updated dependencies [5eedd26]
- Updated dependencies [92b0dd7]
- Updated dependencies [f919b6f]
- Updated dependencies [098e411]
- Updated dependencies [e1b7c01]
- Updated dependencies [9b94f87]
- Updated dependencies [a7df753]
  - @zhin.js/agent@1.1.5
  - @zhin.js/plugin-runtime@1.1.5
  - zhin.js@6.0.4

## 3.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/agent@1.1.4
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 3.0.3

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent@1.1.3
  - zhin.js@6.0.2

## 3.0.2

### Patch Changes

- Updated dependencies [696ab1b]
  - @zhin.js/agent@1.1.2
  - zhin.js@6.0.1

## 3.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent@1.1.1
  - zhin.js@6.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/agent@1.1.0
  - zhin.js@6.0.0

## 2.0.5

### Patch Changes

- @zhin.js/agent@1.0.10
- zhin.js@5.0.3

## 2.0.4

### Patch Changes

- @zhin.js/agent@1.0.9
- zhin.js@5.0.3

## 2.0.3

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/agent@1.0.8
  - zhin.js@5.0.2

## 2.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

  - zhin.js@5.0.2
  - @zhin.js/agent@1.0.7

## 2.0.1

### Patch Changes

- c730fd0: 移除 activity-feedback 遗留的 legacy host Plugin 路径（依赖旧 `@zhin.js/core` `Plugin` 类型的死代码）：

  - 删除 `bindActivityFeedbackToAIEvents`、`mountActivityFeedbackService`、`createActivityFeedbackOrchestratorFromPlugin`（`src/ai-event-binder.ts`）——这些接收旧 `Plugin`/`Plugin.root`、走 ALS 版 `subscribeAIEvents`，无任何运行时消费者与测试覆盖。
  - 删除 `createRootEndpointAccess`（`src/executor.ts`）——legacy root path 专用的 endpoint 访问器，随上述函数一并成为孤儿。
  - 从桶文件 `src/index.ts` 移除对应 re-export。

  运行时入口 `plugin.ts` 走的是 Plugin Runtime 路径（`activityFeedbackAiBus` + OutboundHost），不受影响；插件层不再有对旧 core `Plugin` 类型的依赖。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [43485a9]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - zhin.js@5.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - zhin.js@5.0.0

## 1.0.2

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
  - @zhin.js/agent@1.0.4
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1

## 1.0.1

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - zhin.js@4.1.2
