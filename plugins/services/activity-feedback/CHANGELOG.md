# @zhin.js/service-activity-feedback

## 1.1.20

### Patch Changes

- Updated dependencies [e0f991c]
- Updated dependencies [8846d5d]
- Updated dependencies [8c85a2b]
- Updated dependencies [2cc80df]
- Updated dependencies [97bf337]
- Updated dependencies [43560d0]
- Updated dependencies [1bf0253]
- Updated dependencies [ee9d38a]
- Updated dependencies [eb306e1]
- Updated dependencies [b76317d]
- Updated dependencies [c9775fb]
- Updated dependencies [5efb4e9]
- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [3fd758c]
- Updated dependencies [16896fe]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [88c82d0]
- Updated dependencies [e37f30f]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [f0e1df7]
- Updated dependencies [7f34293]
- Updated dependencies [d9672ec]
- Updated dependencies [42e630d]
- Updated dependencies [1096173]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [8ce6cd2]
- Updated dependencies [f2bbab5]
- Updated dependencies [44eb3f8]
- Updated dependencies [ab2263a]
- Updated dependencies [dfa14b5]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [1ca669a]
  - @zhin.js/agent@1.1.43

## 1.1.19

### Patch Changes

- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

- Updated dependencies [5be6f3a]
- Updated dependencies [334e92d]
- Updated dependencies [0bdd5df]
- Updated dependencies [08e64de]
- Updated dependencies [291cf6e]
- Updated dependencies [ff87195]
- Updated dependencies [d6158d5]
- Updated dependencies [d507e5f]
- Updated dependencies [cffaa8f]
- Updated dependencies [a3b636d]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [e7b72a4]
- Updated dependencies [66b6404]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [9dfdaf4]
- Updated dependencies [a5f0381]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/agent@1.1.42

## 1.1.18

### Patch Changes

- Updated dependencies [0dd657d]
  - @zhin.js/agent@1.1.41

## 1.1.17

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [250b026]
- Updated dependencies [bf0fa9f]
- Updated dependencies [9bc3285]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/agent@1.1.40

## 1.1.16

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [deeb964]
- Updated dependencies [d9cc732]
- Updated dependencies [d3fc1a6]
- Updated dependencies [070bb6b]
  - @zhin.js/agent@1.1.39

## 1.1.15

### Patch Changes

- @zhin.js/agent@1.1.38

## 1.1.14

### Patch Changes

- Updated dependencies [6fdd30b]
- Updated dependencies [1a11207]
- Updated dependencies [a3ab153]
- Updated dependencies [61cca0b]
- Updated dependencies [e8f7309]
- Updated dependencies [ade0f33]
- Updated dependencies [d3563d9]
- Updated dependencies [b15c86b]
- Updated dependencies [3224ba3]
- Updated dependencies [f91cc89]
- Updated dependencies [1148821]
- Updated dependencies [4dd081c]
- Updated dependencies [c618eb7]
- Updated dependencies [a383380]
- Updated dependencies [b3bbada]
- Updated dependencies [12d9a03]
  - @zhin.js/agent@1.1.37

## 1.1.13

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [18de875]
  - @zhin.js/agent@1.1.36

## 1.1.12

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/agent@1.1.35

## 1.1.11

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/agent@1.1.34

## 1.1.10

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- b947298: testing 新增类型化的假运行环境：`createFakePlugin` / `runPluginSetup` 提供真实 Scope 与内存版数据库、定时（可控时钟）、出站记录，`runCommand` / `runMiddleware` / `runHandler` 直接执行约定目录里的定义，`fakeOf` 取代 `as never`。activity-feedback 的测试已迁移。

  包名由 `@zhin.js/plugin-test-kit` 改为 `@zhin.js/testing`（目录 `packages/toolkit/testing`）。旧名 `@zhin.js/plugin-test-kit` 不再更新，请改用新包；API 与 `PluginTestKit` 类名不变。

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/agent@1.1.33
  - @zhin.js/logger@1.1.2

## 1.1.9

### Patch Changes

- Updated dependencies [9891e66]
- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [1f24fbf]
- Updated dependencies [55811d1]
- Updated dependencies [9b8b586]
- Updated dependencies [a6ea7b4]
- Updated dependencies [9486586]
- Updated dependencies [2b5e5ae]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [bf52b40]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [4ce55db]
- Updated dependencies [ba56e74]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [1ea299a]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [dbc1456]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [57ea5f7]
- Updated dependencies [f48ba72]
- Updated dependencies [417ec5b]
- Updated dependencies [7f0f8ca]
- Updated dependencies [d38d38c]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [f768296]
- Updated dependencies [9891e66]
- Updated dependencies [bc09928]
- Updated dependencies [779750f]
- Updated dependencies [9891e66]
- Updated dependencies [b3fea8c]
  - @zhin.js/agent@1.1.32

## 1.1.8

### Patch Changes

- @zhin.js/agent@1.1.31

## 1.1.7

### Patch Changes

- Updated dependencies [b36452a]
  - @zhin.js/agent@1.1.30

## 1.1.6

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/agent@1.1.29

## 1.1.5

### Patch Changes

- Updated dependencies [0de4836]
  - @zhin.js/agent@1.1.28

## 1.1.4

### Patch Changes

- Updated dependencies [36c2eb9]
- Updated dependencies [95b24d4]
- Updated dependencies [cce3d5b]
  - @zhin.js/agent@1.1.27

## 1.1.3

### Patch Changes

- c861789: Own the Agent lifecycle event contract inside the Agent package and remove the
  classic Plugin event subscription bridges. Runtime consumers now subscribe
  through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
  publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
  declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
  activity bus with a generation-owned Resource, and remove concrete Plugin objects
  from ZhinAgent and its tool security path.
- 6b70e46: Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [e1d77d2]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [eb0100a]
- Updated dependencies [6b0415a]
- Updated dependencies [cd54131]
- Updated dependencies [8ededb6]
- Updated dependencies [8740059]
- Updated dependencies [25a845a]
- Updated dependencies [103f2c3]
- Updated dependencies [9110ab8]
- Updated dependencies [d844144]
- Updated dependencies [2a2b5d7]
- Updated dependencies [1fa1c09]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [f4387ef]
- Updated dependencies [75920c4]
- Updated dependencies [5c1ea6c]
- Updated dependencies [cd4f240]
- Updated dependencies [535fed1]
- Updated dependencies [5d990be]
- Updated dependencies [cd55ee6]
- Updated dependencies [98dbc85]
- Updated dependencies [3abdc90]
- Updated dependencies [2b7b271]
- Updated dependencies [f19d598]
- Updated dependencies [ba0ba3c]
- Updated dependencies [5140ce1]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [4bc3d3c]
- Updated dependencies [6012e3c]
- Updated dependencies [31b42a8]
- Updated dependencies [cb61227]
- Updated dependencies [140cf0f]
- Updated dependencies [774ed26]
- Updated dependencies [adecba9]
- Updated dependencies [019f5ff]
- Updated dependencies [77d5a46]
- Updated dependencies [da17137]
- Updated dependencies [659b61d]
- Updated dependencies [91adaa5]
- Updated dependencies [1fed817]
- Updated dependencies [698f16f]
- Updated dependencies [e5d9795]
- Updated dependencies [444ea45]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [33ea736]
  - @zhin.js/agent@1.1.26
  - @zhin.js/logger@1.1.1

## 1.1.2

### Patch Changes

- Updated dependencies [33b1582]
  - @zhin.js/agent@1.1.25

## 1.1.1

### Patch Changes

- Updated dependencies [28b7375]
- Updated dependencies [aec523c]
  - @zhin.js/agent@1.1.24

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
- Updated dependencies [a34bf91]
  - @zhin.js/agent@1.1.23
  - @zhin.js/logger@1.1.0

## 4.0.1

### Patch Changes

- zhin.js@7.0.1
- @zhin.js/agent@1.2.1

## 4.0.0

### Patch Changes

- Updated dependencies [12325e1]
- Updated dependencies [d19e976]
  - @zhin.js/agent@1.2.0
  - zhin.js@7.0.0

## 3.0.23

### Patch Changes

- Updated dependencies [a728a20]
  - @zhin.js/agent@1.1.22
  - zhin.js@6.0.15

## 3.0.22

### Patch Changes

- Updated dependencies [337fd05]
  - @zhin.js/agent@1.1.21
  - zhin.js@6.0.15

## 3.0.21

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/agent@1.1.20
  - zhin.js@6.0.15

## 3.0.20

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/agent@1.1.19
  - zhin.js@6.0.15

## 3.0.19

### Patch Changes

- Updated dependencies [a5ee497]
- Updated dependencies [7108d0b]
  - @zhin.js/agent@1.1.18
  - zhin.js@6.0.15

## 3.0.18

### Patch Changes

- Updated dependencies [736fa04]
  - @zhin.js/agent@1.1.17
  - zhin.js@6.0.14

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
