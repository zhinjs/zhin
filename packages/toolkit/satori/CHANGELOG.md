# @zhin.js/satori

## 1.0.19

### Patch Changes

- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

## 1.0.18

### Patch Changes

- f8c7a54: fix: im

## 1.0.17

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

## 1.0.16

### Patch Changes

- 5cc9c03: fix: ai 优化

## 1.0.15

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化

## 1.0.14

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.2.14)

## 0.2.14

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化

## 0.2.13

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.

## 0.2.12

### Patch Changes

- c8f8207: fix: 修复内存泄露问题

## 0.2.11

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题

## 0.2.10

### Patch Changes

- f19d2e0: fix: remove multiple runtime support

## 0.2.9

### Patch Changes

- 775427e: fix: edge 支持

## 0.2.8

### Patch Changes

- 32049f5: fix: init publish

## 0.2.7

### Patch Changes

- e28fd7c: fix: 重新发版

## 0.2.6

### Patch Changes

- 4304825: fix: 重新发版

## 0.2.5

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 0.2.4

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation

## 0.2.3

### Patch Changes

- c212bf7: fix: 适配器优化

## 0.2.2

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 0.2.1

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐

## 0.2.0

### Major Changes

- 改为直接依赖官方 `satori`，通过 `html-react-parser` 提供 `htmlToSvg`；移除旧版自研布局/渲染源码。
- 保留 `fonts/` 与字体工具函数；导出 `satori`（官方）与 `htmlToSvg`。

## 0.1.0

### Minor Changes

- 404feeb: feat: add built-in font utilities API

  Exposes new font utility types and functions from @zhin.js/satori package:

  - BuiltinFont interface for type-safe font definitions
  - Font getter functions (getRobotoRegular, getRobotoBold, getNotoSans\*, etc.)
  - Note: These functions throw errors in this build as no fonts are bundled

## 0.0.2

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
