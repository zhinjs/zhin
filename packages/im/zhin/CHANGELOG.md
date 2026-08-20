# zhin.js

## 6.0.10

### Patch Changes

- d3920e9: Extract the `handlers/` convention into a dedicated Feature package `@zhin.js/handler`, and mount it as a platform Stable Feature on `@zhin.js/core` (inherited by Roots via `platformFeatures` / `zhin runtime start`).

  Also add the `zhin.js/middleware` facade re-export so Stable Feature authoring is consistent with `zhin.js/command` / `adapter` / `component` / `handler`.

  `@zhin.js/feature-kit` is now kit-only: handler authoring, `HandlerIndex`, and the Feature provider entry are removed. Do not list `@zhin.js/feature-kit` in `zhin.features`.

  **Authoring:** apps and plugins that depend on `zhin.js` should import `definePlugin` from the main entry (`zhin.js`) and other `define*` from facade subpaths (`zhin.js/command`, `zhin.js/middleware`, `zhin.js/handler`, `zhin.js/adapter`, `zhin.js/component`) — do not separately install `@zhin.js/plugin-runtime` or the `@zhin.js/*` Feature implementation packages. Workspace plugins/examples/adapters were updated accordingly (imports + deps; child plugins keep `zhin.features` mounts and peer `zhin.js`). CLI `zhin new` / migrate cutover scaffolds follow the same rule.

  BREAKING CHANGE: `@zhin.js/feature-kit` no longer exports handler APIs and is no longer a `type: "feature"` package.

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - @zhin.js/runtime@1.0.12
  - @zhin.js/agent@1.1.11
  - @zhin.js/html-renderer@3.0.10
  - @zhin.js/speech@3.0.10

## 6.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/runtime@1.0.11
  - @zhin.js/agent@1.1.10
  - @zhin.js/core@1.5.9
  - @zhin.js/ai@1.5.4
  - @zhin.js/html-renderer@3.0.9
  - @zhin.js/speech@3.0.9

## 6.0.8

### Patch Changes

- 8e973dc: Delete the classic Node bootstrap and its entire unreachable setup graph. `zhin.js/node`, `bootstrapNode`, classic endpoint/config/service assembly, legacy signal handling, and the duplicate database log transport are no longer published or compiled.

  BREAKING CHANGE: applications must start through `zhin runtime start`; there is no compatibility stub or classic Host bootstrap subpath.

- Updated dependencies [63253bb]
- Updated dependencies [6fb24dd]
- Updated dependencies [d162216]
- Updated dependencies [7427818]
- Updated dependencies [90da255]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/runtime@1.0.10
  - @zhin.js/core@1.5.8
  - @zhin.js/agent@1.1.9
  - @zhin.js/ai@1.5.3
  - @zhin.js/permission@1.0.2
  - @zhin.js/html-renderer@3.0.8
  - @zhin.js/speech@3.0.8

## 6.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/agent@1.1.8
  - @zhin.js/html-renderer@3.0.7
  - @zhin.js/speech@3.0.7

## 6.0.6

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/agent@1.1.7
  - @zhin.js/core@1.5.6
  - @zhin.js/runtime@1.0.9
  - @zhin.js/html-renderer@3.0.6
  - @zhin.js/speech@3.0.6

## 6.0.5

### Patch Changes

- @zhin.js/core@1.5.5
- @zhin.js/runtime@1.0.9
- @zhin.js/agent@1.1.6
- @zhin.js/html-renderer@3.0.5
- @zhin.js/speech@3.0.5

## 6.0.4

### Patch Changes

- ba08a2f: refactor(zhin): replace PermissionFeature with createPermissionHost

  Zhin entry point now creates a standalone PermissionHost and passes it to
  the message dispatcher, removing the legacy PermissionFeature registration.
  Command permit checks are unified through the new permission system.

- 92b0dd7: refactor: complete plugin dual-track elimination (Slices 3–4)

  Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
  collaboration, media, memory, prompt, and orchestrator modules); dead branches
  collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
  all packages.

  Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
  (`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
  stack directly.

  Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
  service bus is superseded by Scope + Token (introduced in Slice 2).

  Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
  `AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
  no longer depends on dead `init/` modules.

  Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
  update agent README to remove `initAgentModule` usage examples.

- Updated dependencies [6f9c366]
- Updated dependencies [373a56b]
- Updated dependencies [0de46a8]
- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [c50aca3]
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
  - @zhin.js/permission@1.0.1
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/ai@1.5.2
  - @zhin.js/runtime@1.0.9
  - @zhin.js/html-renderer@3.0.4
  - @zhin.js/speech@3.0.4

## 6.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/agent@1.1.4
  - @zhin.js/ai@1.5.1
  - @zhin.js/core@1.5.3
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/runtime@1.0.8
  - @zhin.js/html-renderer@3.0.3
  - @zhin.js/speech@3.0.3

## 6.0.2

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent@1.1.3
  - @zhin.js/html-renderer@3.0.2
  - @zhin.js/speech@3.0.2
  - @zhin.js/runtime@1.0.7

## 6.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent@1.1.1
  - @zhin.js/core@1.5.1
  - @zhin.js/runtime@1.0.6
  - @zhin.js/html-renderer@3.0.1
  - @zhin.js/speech@3.0.1

## 6.0.0

### Patch Changes

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0
  - @zhin.js/core@1.5.0
  - @zhin.js/agent@1.1.0
  - @zhin.js/runtime@1.0.5
  - @zhin.js/html-renderer@3.0.0
  - @zhin.js/speech@3.0.0

## 5.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/runtime@1.0.5
  - @zhin.js/agent@1.0.9
  - @zhin.js/html-renderer@2.0.3
  - @zhin.js/speech@2.0.3

## 5.0.2

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/runtime@1.0.4
  - @zhin.js/core@1.4.2
  - @zhin.js/agent@1.0.7
  - @zhin.js/html-renderer@2.0.2
  - @zhin.js/speech@2.0.2

## 5.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 43485a9: 架构对齐修复（platformFeatures 继承落地）：

  - `zhin.js` 主包 `zhin.plugins` 清空：host-router/host-api 是 legacy 插件包（`usePlugin` 入口），经 graph 加载会崩溃；新 Runtime 的 Console 由 cli 装配，门面保持纯 re-export。
  - `@zhin.js/runtime` package-resolver：`declaredDependency` 接受 `peerDependencies`（optional peer 是合法声明，未安装时由 `optional` 引用容错）。
  - `@zhin.js/cli` PackageCutover 检查器适配继承形态：依赖 zhin.js/core 时 manifest `features` 可省略 command/component/middleware（platformFeatures 继承），不再误报 blocked。
  - 文档：新增 `docs/architecture/package-topology.md`（包结构依赖图与各层 zhin 字段配置指南）。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [8c7d03d]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/runtime@1.0.3
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/ai@1.4.6
  - @zhin.js/html-renderer@2.0.1
  - @zhin.js/speech@2.0.1
  - @zhin.js/core@1.4.1

## 5.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/host-router@3.0.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-api@3.0.0
  - @zhin.js/html-renderer@2.0.0
  - @zhin.js/speech@2.0.0
  - @zhin.js/runtime@1.0.2

## 4.1.3

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
  - @zhin.js/logger@1.0.75
  - @zhin.js/host-api@2.0.6
  - @zhin.js/host-router@2.0.4
  - @zhin.js/html-renderer@1.0.4
  - @zhin.js/speech@1.0.4
  - @zhin.js/kernel@1.0.4
  - @zhin.js/runtime@1.0.1

## 4.1.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/core@1.3.4
  - @zhin.js/host-api@2.0.5
  - @zhin.js/host-router@2.0.3
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/html-renderer@1.0.3
  - @zhin.js/speech@1.0.3

## 4.1.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/agent@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/schema@1.0.71
  - @zhin.js/host-api@2.0.4
  - @zhin.js/host-router@2.0.2
  - @zhin.js/html-renderer@1.0.2
  - @zhin.js/speech@1.0.2

## 4.1.0

### Minor Changes

- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/host-api@2.0.3
  - @zhin.js/agent@1.0.1
  - @zhin.js/core@1.3.2
  - @zhin.js/logger@1.0.72
  - @zhin.js/speech@1.0.1
  - @zhin.js/html-renderer@1.0.1
  - @zhin.js/kernel@1.0.1

## 4.0.1

### Patch Changes

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/agent@0.3.1
  - @zhin.js/core@1.3.1
  - @zhin.js/host-api@2.0.1
  - @zhin.js/host-router@2.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0
  - @zhin.js/agent@0.3.0
  - @zhin.js/core@1.3.0
  - @zhin.js/host-api@2.0.0
  - @zhin.js/host-router@2.0.0

## 2.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/host-api@1.0.1
  - @zhin.js/agent@0.2.1
  - @zhin.js/core@1.2.1
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71
  - @zhin.js/kernel@0.1.1

## 2.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/kernel@0.1.0
  - @zhin.js/core@1.2.0
  - @zhin.js/ai@1.2.0
  - @zhin.js/agent@0.2.0
  - @zhin.js/host-api@1.0.0
  - @zhin.js/host-router@1.0.0

## 1.0.92

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/kernel@0.0.50
  - @zhin.js/agent@0.1.31
  - @zhin.js/core@1.1.33
  - @zhin.js/ai@1.1.31
  - @zhin.js/host-router@0.0.3

## 1.0.91

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/kernel@0.0.49
  - @zhin.js/host-api@0.0.4
  - @zhin.js/agent@0.1.30
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30
  - @zhin.js/host-router@0.0.3

## 1.0.90

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/schema@1.0.70
  - @zhin.js/host-api@0.0.3
  - @zhin.js/host-router@0.0.3
  - @zhin.js/agent@0.1.29
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31
  - @zhin.js/kernel@0.0.48

## 1.0.89

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - @zhin.js/kernel@0.0.47
  - @zhin.js/agent@0.1.28
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28
  - @zhin.js/host-api@0.0.2

## 1.0.88

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身

## 1.0.87

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/schema@1.0.69
  - @zhin.js/core@1.1.29
  - @zhin.js/agent@0.1.27
  - @zhin.js/ai@1.1.27
  - @zhin.js/kernel@0.0.46
  - @zhin.js/host-api@0.0.1
  - @zhin.js/host-router@0.0.1

## 1.0.86

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/agent@0.1.26
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/schema@1.0.68
  - @zhin.js/ai@1.1.26
  - @zhin.js/host-router-host@0.1.4
  - @zhin.js/kernel@0.0.45
  - @zhin.js/queue-runtime@0.0.4
  - @zhin.js/storage-port@0.0.2
  - @zhin.js/adapter-sandbox@3.0.5
  - @zhin.js/console@3.0.5
  - @zhin.js/host-router@1.0.79

## 1.0.85

### Patch Changes

- Updated dependencies [b0e0a71]
  - @zhin.js/agent@0.1.25
  - @zhin.js/logger@0.1.67
  - @zhin.js/schema@1.0.67
  - @zhin.js/adapter-sandbox@3.0.4
  - @zhin.js/console@3.0.4
  - @zhin.js/host-router@1.0.78
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25
  - @zhin.js/kernel@0.0.44
  - @zhin.js/queue-runtime@0.0.3

## 1.0.84

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/adapter-sandbox@3.0.3
  - @zhin.js/console@3.0.3
  - @zhin.js/host-router-host@0.1.3
  - @zhin.js/kernel@0.0.43
  - @zhin.js/agent@0.1.24
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24
  - @zhin.js/schema@1.0.66
  - @zhin.js/queue-runtime@0.0.2
  - @zhin.js/storage-port@0.0.1
  - @zhin.js/host-router@1.0.77

## 1.0.83

### Breaking Changes

- **移除** `zhin.js/setup` 侧效入口。Node/Bun 请改用 `import { bootstrapNode } from 'zhin.js/node'`（CLI `zhin dev` / `zhin start` 已切换）。Edge（Deno Deploy、Vercel、Cloudflare Workers）请使用 `zhin.js/deno`、`zhin.js/vercel` 或 `zhin.js/cloudflare` 的 `bootstrap*()`。

### Patch Changes

- 775427e: fix: edge 支持
- 多运行时 bootstrap：`zhin.js/node`、`zhin.js/deno`、`zhin.js/vercel`、`zhin.js/cloudflare`；共享 `bootstrapEdgeCore`（Fetch HTTP、Console 子集、Sandbox SSE/WS）
- Updated dependencies [775427e]
  - @zhin.js/kernel@0.0.42
  - @zhin.js/agent@0.1.23
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/schema@1.0.65
  - @zhin.js/ai@1.1.23

## 1.0.82

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/schema@1.0.64
  - @zhin.js/agent@0.1.22
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24
  - @zhin.js/kernel@0.0.41

## 1.0.81

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/agent@0.1.21
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21
  - @zhin.js/logger@0.1.63
  - @zhin.js/schema@1.0.63
  - @zhin.js/kernel@0.0.40

## 1.0.80

### Patch Changes

- Updated dependencies [3b3e49b]
  - @zhin.js/agent@0.1.20
  - @zhin.js/logger@0.1.62
  - @zhin.js/schema@1.0.62
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20
  - @zhin.js/kernel@0.0.39

## 1.0.79

### Patch Changes

- Updated dependencies [92da96d]
  - @zhin.js/agent@0.1.19
  - @zhin.js/logger@0.1.61
  - @zhin.js/schema@1.0.61
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19
  - @zhin.js/kernel@0.0.38

## 1.0.78

### Patch Changes

- Updated dependencies [88caeb2]
  - @zhin.js/agent@0.1.18
  - @zhin.js/core@1.1.20
  - @zhin.js/logger@0.1.60
  - @zhin.js/schema@1.0.60
  - @zhin.js/ai@1.1.18
  - @zhin.js/kernel@0.0.37

## 1.0.77

### Patch Changes

- Updated dependencies [fcad030]
  - @zhin.js/agent@0.1.17
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19
  - @zhin.js/logger@0.1.59
  - @zhin.js/schema@1.0.59
  - @zhin.js/kernel@0.0.36

## 1.0.76

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/agent@0.1.16
  - @zhin.js/ai@1.1.16
  - @zhin.js/logger@0.1.58
  - @zhin.js/schema@1.0.58
  - @zhin.js/core@1.1.18
  - @zhin.js/kernel@0.0.35

## 1.0.75

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/agent@0.1.15
  - @zhin.js/core@1.1.17
  - @zhin.js/logger@0.1.57
  - @zhin.js/schema@1.0.57
  - @zhin.js/kernel@0.0.34

## 1.0.74

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/kernel@0.0.33
  - @zhin.js/agent@0.1.14
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14
  - @zhin.js/logger@0.1.56
  - @zhin.js/schema@1.0.56

## 1.0.73

### Patch Changes

- Updated dependencies [63d0b88]
  - @zhin.js/agent@0.1.13
  - @zhin.js/logger@0.1.55
  - @zhin.js/schema@1.0.55
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13
  - @zhin.js/kernel@0.0.32

## 1.0.72

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - @zhin.js/schema@1.0.54
  - @zhin.js/agent@0.1.12
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14
  - @zhin.js/kernel@0.0.31

## 1.0.71

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/agent@0.1.11
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13
  - @zhin.js/kernel@0.0.30

## 1.0.70

### Patch Changes

- Updated dependencies [bcd56d5]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/core@1.1.12
  - @zhin.js/ai@1.1.11
  - @zhin.js/kernel@0.0.30
  - @zhin.js/agent@0.1.11

## 1.0.69

### Patch Changes

- Updated dependencies [7b0227a]
  - @zhin.js/core@1.1.11
  - @zhin.js/agent@0.1.11

## 1.0.68

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/agent@0.1.10
  - @zhin.js/logger@0.1.52
  - @zhin.js/schema@1.0.52
  - @zhin.js/ai@1.1.10
  - @zhin.js/kernel@0.0.29

## 1.0.67

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/agent@0.1.9
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9
  - @zhin.js/logger@0.1.51
  - @zhin.js/schema@1.0.51
  - @zhin.js/kernel@0.0.28

## 1.0.66

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/agent@0.1.8
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8
  - @zhin.js/logger@0.1.50
  - @zhin.js/schema@1.0.50
  - @zhin.js/kernel@0.0.27

## 1.0.65

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/agent@0.1.7
  - @zhin.js/core@1.1.7
  - @zhin.js/logger@0.1.49
  - @zhin.js/schema@1.0.49
  - @zhin.js/kernel@0.0.26

## 1.0.64

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48
  - @zhin.js/agent@0.1.6
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6
  - @zhin.js/kernel@0.0.25

## 1.0.63

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/agent@0.1.5
  - @zhin.js/logger@0.1.47
  - @zhin.js/schema@1.0.47
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5
  - @zhin.js/kernel@0.0.24

## 1.0.62

### Patch Changes

- Updated dependencies [bf0dc75]
  - @zhin.js/agent@0.1.4
  - @zhin.js/logger@0.1.46
  - @zhin.js/schema@1.0.46
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4
  - @zhin.js/kernel@0.0.23

## 1.0.61

### Patch Changes

- Updated dependencies [a257f3f]
  - @zhin.js/agent@0.1.3
  - @zhin.js/logger@0.1.45
  - @zhin.js/schema@1.0.45
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3
  - @zhin.js/kernel@0.0.22

## 1.0.60

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/kernel@0.0.21
  - @zhin.js/agent@0.1.2
  - @zhin.js/core@1.1.2
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44
  - @zhin.js/ai@1.1.2

## 1.0.59

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43
  - @zhin.js/agent@0.1.1
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1
  - @zhin.js/kernel@0.0.20

## 1.0.58

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/agent@0.1.0
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0
  - @zhin.js/logger@0.1.42
  - @zhin.js/schema@1.0.42
  - @zhin.js/kernel@0.0.19

## 1.0.57

### Patch Changes

- Updated dependencies [c606a57]
  - @zhin.js/agent@0.0.20
  - @zhin.js/core@1.0.57
  - @zhin.js/logger@0.1.41
  - @zhin.js/schema@1.0.41
  - @zhin.js/ai@1.0.18
  - @zhin.js/kernel@0.0.18

## 1.0.56

### Patch Changes

- Updated dependencies [20ab379]
  - @zhin.js/agent@0.0.19
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56
  - @zhin.js/logger@0.1.40
  - @zhin.js/schema@1.0.40
  - @zhin.js/kernel@0.0.17

## 1.0.55

### Patch Changes

- Updated dependencies [75709e1]
  - @zhin.js/agent@0.0.18
  - @zhin.js/core@1.0.55
  - @zhin.js/logger@0.1.39
  - @zhin.js/schema@1.0.39
  - @zhin.js/ai@1.0.16
  - @zhin.js/kernel@0.0.16

## 1.0.54

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38
  - @zhin.js/agent@0.0.17
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54
  - @zhin.js/kernel@0.0.15

## 1.0.53

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/agent@0.0.16
- @zhin.js/logger@0.1.37
- @zhin.js/schema@1.0.37
- @zhin.js/ai@1.0.14
- @zhin.js/kernel@0.0.14

## 1.0.52

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- bb6bfa8: feat: 技能全面文件化——仓库内插件/适配器使用 `skills/<name>/SKILL.md`；Core 已移除 `plugin.declareSkill` / `Adapter.declareSkill` API
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/agent@0.0.15
  - @zhin.js/logger@0.1.36
  - @zhin.js/schema@1.0.36
  - @zhin.js/ai@1.0.13
  - @zhin.js/kernel@0.0.13

## 1.0.51

### Patch Changes

- Updated dependencies [607acc4]
  - @zhin.js/agent@0.0.14
  - @zhin.js/logger@0.1.35
  - @zhin.js/schema@1.0.35
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12
  - @zhin.js/kernel@0.0.12

## 1.0.50

### Patch Changes

- Updated dependencies [2510365]
  - @zhin.js/agent@0.0.13
  - @zhin.js/logger@0.1.34
  - @zhin.js/schema@1.0.34
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11
  - @zhin.js/kernel@0.0.11

## 1.0.49

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/kernel@0.0.10
  - @zhin.js/core@1.0.49
  - @zhin.js/agent@0.0.12
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33
  - @zhin.js/ai@1.0.10

## 1.0.48

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/kernel@0.0.9
  - @zhin.js/core@1.0.48
  - @zhin.js/agent@0.0.11
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32
  - @zhin.js/ai@1.0.9

## 1.0.47

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/agent@0.0.10
  - @zhin.js/core@1.0.47
  - @zhin.js/logger@0.1.31
  - @zhin.js/schema@1.0.31
  - @zhin.js/ai@1.0.8
  - @zhin.js/kernel@0.0.8

## 1.0.46

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/agent@0.0.9
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46
  - @zhin.js/logger@0.1.30
  - @zhin.js/schema@1.0.30
  - @zhin.js/kernel@0.0.7

## 1.0.45

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6
  - @zhin.js/agent@0.0.8
  - @zhin.js/logger@0.1.29
  - @zhin.js/schema@1.0.29
  - @zhin.js/kernel@0.0.6

## 1.0.44

### Patch Changes

- Updated dependencies [4f2fb55]
  - @zhin.js/agent@0.0.7
  - @zhin.js/logger@0.1.28
  - @zhin.js/schema@1.0.28
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5
  - @zhin.js/kernel@0.0.5

## 1.0.43

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/agent@0.0.6
  - @zhin.js/logger@0.1.27
  - @zhin.js/schema@1.0.27
  - @zhin.js/ai@1.0.4
  - @zhin.js/kernel@0.0.4

## 1.0.42

### Patch Changes

- Updated dependencies [0999ca6]
  - @zhin.js/agent@0.0.5
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42
  - @zhin.js/logger@0.1.26
  - @zhin.js/schema@1.0.26
  - @zhin.js/kernel@0.0.3

## 1.0.41

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/agent@0.0.4
  - @zhin.js/logger@0.1.25
  - @zhin.js/schema@1.0.25
  - @zhin.js/ai@1.0.2
  - @zhin.js/kernel@0.0.2

## 1.0.40

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/agent@0.0.3
  - @zhin.js/core@1.0.40
  - @zhin.js/logger@0.1.24
  - @zhin.js/schema@1.0.24
  - @zhin.js/ai@1.0.1
  - @zhin.js/kernel@0.0.1

## 1.0.39

### Patch Changes

- Updated dependencies [04f76ac]
  - @zhin.js/agent@0.0.2
  - @zhin.js/core@1.0.39
  - @zhin.js/logger@0.1.23
  - @zhin.js/schema@1.0.23

## 1.0.38

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
  - @zhin.js/agent@0.0.1
  - @zhin.js/logger@0.1.22
  - @zhin.js/schema@1.0.22

## 1.0.37

### Patch Changes

- Updated dependencies [a8ce720]
  - @zhin.js/core@1.0.37
  - @zhin.js/logger@0.1.21
  - @zhin.js/schema@1.0.21

## 1.0.36

### Patch Changes

- Updated dependencies [6d94111]
  - @zhin.js/core@1.0.36
  - @zhin.js/logger@0.1.20
  - @zhin.js/schema@1.0.20

## 1.0.35

### Patch Changes

- Updated dependencies [8502351]
  - @zhin.js/core@1.0.35
  - @zhin.js/logger@0.1.19
  - @zhin.js/schema@1.0.19

## 1.0.34

### Patch Changes

- Updated dependencies [634e2d7]
  - @zhin.js/core@1.0.34
  - @zhin.js/logger@0.1.18
  - @zhin.js/schema@1.0.18

## 1.0.33

### Patch Changes

- Updated dependencies [4abae79]
  - @zhin.js/core@1.0.33
  - @zhin.js/logger@0.1.17
  - @zhin.js/schema@1.0.17

## 1.0.32

### Patch Changes

- Updated dependencies [10d8bdc]
  - @zhin.js/core@1.0.32
  - @zhin.js/logger@0.1.16
  - @zhin.js/schema@1.0.16

## 1.0.31

### Patch Changes

- Updated dependencies [771706d]
  - @zhin.js/core@1.0.31
  - @zhin.js/logger@0.1.15
  - @zhin.js/schema@1.0.15

## 1.0.30

### Patch Changes

- 460a6c6: fix: unhandleRejection
  - @zhin.js/logger@0.1.14
  - @zhin.js/schema@1.0.14
  - @zhin.js/core@1.0.30

## 1.0.29

### Patch Changes

- Updated dependencies [4ec9176]
  - @zhin.js/core@1.0.29
  - @zhin.js/logger@0.1.13
  - @zhin.js/schema@1.0.13

## 1.0.28

### Patch Changes

- Updated dependencies [05a514d]
  - @zhin.js/core@1.0.28
  - @zhin.js/logger@0.1.12
  - @zhin.js/schema@1.0.12

## 1.0.27

### Patch Changes

- b27e633: fix: cli 优化
- Updated dependencies [b27e633]
  - @zhin.js/core@1.0.27
  - @zhin.js/logger@0.1.11
  - @zhin.js/schema@1.0.11

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/core@1.0.26
  - @zhin.js/logger@0.1.10
  - @zhin.js/schema@1.0.10

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/ai@0.0.2
  - @zhin.js/logger@0.1.9
  - @zhin.js/schema@1.0.9
  - @zhin.js/core@1.0.25

## 1.0.24

### Patch Changes

- Updated dependencies [6108e5d]
  - @zhin.js/core@1.0.24
  - @zhin.js/logger@0.1.8
  - @zhin.js/schema@1.0.8

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - @zhin.js/core@1.0.23
  - @zhin.js/logger@0.1.7
  - @zhin.js/schema@1.0.7

## 1.0.22

### Patch Changes

- 26aba27: fix: error default config
  - @zhin.js/logger@0.1.6
  - @zhin.js/schema@1.0.6
  - @zhin.js/core@1.0.22

## 1.0.21

### Patch Changes

- Updated dependencies [3960e70]
  - @zhin.js/core@1.0.21
  - @zhin.js/logger@0.1.5
  - @zhin.js/schema@1.0.5

## 1.0.20

### Patch Changes

- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - @zhin.js/schema@1.0.4
  - @zhin.js/core@1.0.20

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - @zhin.js/schema@1.0.3
  - @zhin.js/core@1.0.19

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - @zhin.js/schema@1.0.2
  - @zhin.js/core@1.0.18

## 1.0.17

### Patch Changes

- Updated dependencies [3bc5d56]
  - @zhin.js/core@1.0.17

## 1.0.16

### Patch Changes

- Updated dependencies [e733fab]
  - @zhin.js/core@1.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [f9e75ce]
- Updated dependencies [e783f90]
- Updated dependencies [f9e75ce]
  - @zhin.js/core@1.0.15

## 1.0.14

### Patch Changes

- Updated dependencies [547028f]
  - @zhin.js/core@1.0.14

## 1.0.13

### Patch Changes

- Updated dependencies [a2e1ebc]
  - @zhin.js/core@1.0.13

## 1.0.12

### Patch Changes

- Updated dependencies [ff5a7ed]
  - @zhin.js/core@1.0.12

## 1.0.11

### Patch Changes

- @zhin.js/core@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1
  - @zhin.js/core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [c490260]
  - @zhin.js/core@1.0.9

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [47845fb]
  - @zhin.js/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [c2d9047]
- Updated dependencies [c2d9047]
  - @zhin.js/core@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [15be776]
  - @zhin.js/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [89bc676]
  - @zhin.js/core@1.0.3

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- Updated dependencies [15fc934]
- Updated dependencies [3ecd487]
  - @zhin.js/core@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/core@1.0.1
