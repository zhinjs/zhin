# @zhin.js/adapter-github

## 5.0.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/agent@1.1.8
  - zhin.js@6.0.7

## 5.0.7

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/agent@1.1.7
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.6
  - zhin.js@6.0.6

## 5.0.6

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.5
  - @zhin.js/agent@1.1.6
  - zhin.js@6.0.5

## 5.0.5

### Patch Changes

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- Updated dependencies [6f9c366]
- Updated dependencies [373a56b]
- Updated dependencies [0de46a8]
- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [b0f37ae]
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
  - @zhin.js/host-http@1.0.8
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/adapter@1.1.7
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4

## 5.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/host-http@1.0.7
  - @zhin.js/adapter@1.1.6
  - @zhin.js/agent@1.1.4
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 5.0.3

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/host-http@1.0.6
  - @zhin.js/agent@1.1.3
  - zhin.js@6.0.2

## 5.0.2

### Patch Changes

- Updated dependencies [696ab1b]
  - @zhin.js/agent@1.1.2
  - zhin.js@6.0.1

## 5.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/host-http@1.0.5
  - @zhin.js/adapter@1.1.4
  - @zhin.js/agent@1.1.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - zhin.js@6.0.1

## 5.0.0

### Patch Changes

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/command@1.0.5
  - @zhin.js/adapter@1.1.3
  - @zhin.js/core@1.5.0
  - @zhin.js/agent@1.1.0
  - zhin.js@6.0.0

## 4.0.5

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/host-http@1.0.4
  - @zhin.js/agent@1.0.10
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 4.0.4

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/agent@1.0.9
  - zhin.js@5.0.3

## 4.0.3

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/agent@1.0.8
  - @zhin.js/core@1.4.2
  - zhin.js@5.0.2

## 4.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/command@1.0.4
  - zhin.js@5.0.2
  - @zhin.js/adapter@1.1.2
  - @zhin.js/core@1.4.2
  - @zhin.js/agent@1.0.7

## 4.0.1

### Patch Changes

- 74b035c: endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [9c997b2]
- Updated dependencies [09d4f25]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/command@1.0.3
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/host-http@1.0.3
  - zhin.js@5.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1

## 4.0.0

### Patch Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- f32c424: 适配器配置统一为 endpoints 数组格式：`plugins.<adapter>` 为该 adapter 所有 endpoint 的通用配置，`plugins.<adapter>.endpoints[i]` 为单个 endpoint 的特殊配置（逐项覆盖，`name` 必填）。slack / github schema 新增 `endpoints` 属性；icqq / qq / slack 顶层必填改为 `anyOf`（单 endpoint 字段或 `endpoints` 数组二选一，兼容 Ajv strictRequired）。
- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0

## 3.0.3

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
  - @zhin.js/core@1.3.5
  - @zhin.js/agent@1.0.4
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 3.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 3.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

- ae5239c: fix: 核心包瘦身
- Updated dependencies [ae5239c]
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 2.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/host-router@2.0.0

## 1.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - zhin.js@2.0.1

## 1.0.0

### Patch Changes

- 65f4b0a: 架构优化、类型安全提升与构建系统清理

  **kernel** (minor)

  - PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

  **core** (minor)

  - Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
  - Plugin.stop() 委托 `super.stop()` 消除重复代码
  - Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

  **ai** (minor)

  - BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
  - 修复 fetch/fetchText 的 AbortController 泄漏

  **agent** (minor)

  - 为 7 个模块级单例添加 reset() 函数支持测试隔离
  - 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

  **host-api / plugins** (patch)

  - handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
  - adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast
  - zhin.js@2.0.0
  - @zhin.js/host-router@1.0.0

## 0.1.63

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 0.1.62

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 0.1.61

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 0.1.60

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89

## 0.1.59

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.1.58

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/host-router@0.0.1

## 0.1.57

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86
  - @zhin.js/host-router@1.0.79

## 0.1.56

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/host-router@1.0.78

## 0.1.55

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/host-router@1.0.77

## 0.1.54

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/host-router@1.0.76
  - zhin.js@1.0.83

## 0.1.53

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/host-router@1.0.75
  - zhin.js@1.0.82

## 0.1.52

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/host-router@1.0.74

## 0.1.51

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/host-router@1.0.73

## 0.1.50

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/host-router@1.0.72

## 0.1.49

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/host-router@1.0.71

## 0.1.48

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/host-router@1.0.70

## 0.1.47

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/host-router@1.0.69

## 0.1.46

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/host-router@1.0.68

## 0.1.45

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/host-router@1.0.67

## 0.1.44

### Patch Changes

- zhin.js@1.0.73
- @zhin.js/host-router@1.0.66

## 0.1.43

### Patch Changes

- 57bdf7a: fix: github adapter error

## 0.1.42

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/host-router@1.0.65

## 0.1.41

### Patch Changes

- 4304825: fix: 重新发版
- ed66fb1: fix: 适配器优化
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/host-router@1.0.64

## 0.1.40

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/host-router@1.0.63

## 0.1.39

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67

## 0.1.38

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/host-router@1.0.61

## 0.1.37

### Patch Changes

- d73a3b7: fix: ai error
  - zhin.js@1.0.65
  - @zhin.js/host-router@1.0.60

## 0.1.36

### Patch Changes

- 36c1b8f: fix: 重构 icqq\github 适配器

## 0.1.35

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/host-router@1.0.59

## 0.1.34

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63

## 0.1.33

### Patch Changes

- 6b146fd: fix: 补齐工具

## 0.1.32

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/host-router@1.0.57

## 0.1.31

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/host-router@1.0.56

## 0.1.30

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
  - @zhin.js/host-router@1.0.55

## 0.1.29

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 0.1.28

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/host-router@1.0.53

## 0.1.27

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/host-router@1.0.52

## 0.1.26

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/host-router@1.0.51

## 0.1.25

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/host-router@1.0.50

## 0.1.24

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 0.1.23

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 0.1.22

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 0.1.21

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/host-router@1.0.46

## 0.1.20

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45

## 0.1.19

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/host-router@1.0.44

## 0.1.18

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/host-router@1.0.43

## 0.1.17

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/host-router@1.0.42

## 0.1.16

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/host-router@1.0.41

## 0.1.15

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/host-router@1.0.40

## 0.1.14

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/host-router@1.0.39

## 0.1.13

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/host-router@1.0.38

## 0.1.12

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/host-router@1.0.37
  - zhin.js@1.0.43

## 0.1.11

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/host-router@1.0.36

## 0.1.10

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/host-router@1.0.35

## 0.1.9

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 0.1.8

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/host-router@1.0.33

## 0.1.7

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 0.1.6

### Patch Changes

- 631da6e: fix: 约定公开路由前缀/pub
- Updated dependencies [631da6e]
  - @zhin.js/host-router@1.0.31

## 0.1.5

### Patch Changes

- d7bdca3: fix: add public url

## 0.1.4

### Patch Changes

- e23e732: fix: 增强平台 AI 能力
- bb0be4c: fix: 平台能力增强

## 0.1.3

### Patch Changes

- a8ce720: fix: ai 优化,github 优化
  - zhin.js@1.0.37
  - @zhin.js/host-router@1.0.30

## 0.1.2

### Patch Changes

- d4a7daa: fix: github 优化

## 0.1.1

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - zhin.js@1.0.36
