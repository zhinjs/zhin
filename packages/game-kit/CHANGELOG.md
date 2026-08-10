# @zhin.js/game-shared

## 3.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/core@1.5.3
  - @zhin.js/middleware@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3
  - @zhin.js/html-renderer@3.0.3
  - @zhin.js/satori@1.0.18

## 3.0.2

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - zhin.js@6.0.2
  - @zhin.js/html-renderer@3.0.2
  - @zhin.js/middleware@1.0.6

## 3.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/core@1.5.1
  - @zhin.js/middleware@1.0.5
  - zhin.js@6.0.1
  - @zhin.js/html-renderer@3.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/core@1.5.0
  - zhin.js@6.0.0
  - @zhin.js/html-renderer@3.0.0

## 2.0.4

### Patch Changes

- d52f3c5: fix: QQ 适配器群聊误识别为私聊、game-kit 启动崩溃、全面补齐 recallMessage

  - fix(cli): `resolveChannelType` 增加 `metadata.channelKind` 检查，修复 QQ/Discord/KOOK 群聊消息被误分类为私聊
  - fix(game-kit): `createHostGameDb` 改用延迟代理模型，避免数据库启动前解析模型导致崩溃
  - feat(qq): 实现 `recallMessage`，解析复合 messageId 路由到对应 SDK 撤回方法；`normalizeQqMessage` 增加 `message_type` 缺失时的回退检测
  - feat(slack): 实现 `recallMessage`，利用已有 compound ref 和 `chat.delete` API
  - feat(onebot11): 两个 endpoint 类实现 `recallMessage`（`delete_msg`）
  - feat(onebot12): 两个 endpoint 类实现 `recallMessage`（`delete_message`）
  - feat(napcat): 三个 endpoint 类实现 `recallMessage`（`delete_msg`）
  - feat(discord): 两个 endpoint 类实现 `recallMessage`；`send()` 改为返回 `channelId:snowflake` 复合 ID
  - feat(telegram): 实现 `recallMessage`（`deleteMessage`）；`send()` 改为返回 `chatId:messageId` 复合 ID
  - feat(kook): 两个 endpoint 类实现 `recallMessage`，利用 kook-client `recallMsg` API
  - feat(lark): 实现 `recallMessage`（`DELETE /im/v1/messages/{id}`）
  - feat(wecom): 实现 `recallMessage`（`POST /cgi-bin/message/recall`）

## 2.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3
  - @zhin.js/html-renderer@2.0.3

## 2.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

  - zhin.js@5.0.2
  - @zhin.js/middleware@1.0.4
  - @zhin.js/core@1.4.2
  - @zhin.js/html-renderer@2.0.2

## 2.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 20f5d6c: 游戏迁移到 Plugin Runtime（首个游戏 rps + game-kit 共享支撑）：

  - **game-kit**：`GameMessageLike`（`command-message.ts`）的 `$sender.name` 放宽为可选，使其成为 core `Message` 的结构兼容超集；`channelKey`（`board-sender.ts`）与 `recordGameOutcome`（`game-records.ts`）的消息参数类型改用 `GameMessageLike`。这样共享 helper 同时接受运行时桥接的 `GameMessageLike` 与迁移过渡期仍传入的 legacy core `Message`，让游戏可逐个迁移而不破坏未迁移游戏的类型。
  - **rps**：游戏逻辑（`game-flow.ts` / `rps-command.ts` / `session-service.ts`）不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型；消息类型改用 `GameMessageLike`。移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互分支（Runtime 下从不执行），命令与 choice 中间件返回文本视图；`runRpsCommandText` 合并进 `runRpsCommand`。

  行为等价（移除的是 Runtime 下恒 null 的死分支）；rps 构建与 10/10 测试通过，未迁移游戏（blackjack）构建仍通过，验证向后兼容。

- Updated dependencies [5691aba]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/html-renderer@2.0.1
  - @zhin.js/satori@1.0.17
  - zhin.js@5.0.1
  - @zhin.js/core@1.4.1
  - @zhin.js/middleware@1.0.3

## 2.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - zhin.js@5.0.0
  - @zhin.js/html-renderer@2.0.0
  - @zhin.js/middleware@1.0.2

## 1.0.2

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
  - zhin.js@4.1.3
  - @zhin.js/html-renderer@1.0.4
  - @zhin.js/middleware@1.0.1

## 1.0.1

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - zhin.js@4.1.2
  - @zhin.js/html-renderer@1.0.3
