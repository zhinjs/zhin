# @zhin.js/im-contract

## 1.0.3

### Patch Changes

- c106ecc: feat(permission): add unified @zhin.js/permission package with builtin DSL (adapter/group/private/channel/user/role), PermissionHost, and platform permit checker. Extract LegacyEndpointControlSurface to im-contract. Support Unicode capability local names in plugin-runtime.
- a7df753: refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

  **AI 层**

  - `preprocessInboundMedia` / `buildSubagentInboundTask` 入参收窄为 canonical 单形态（ContentPart union 臂删除）。
  - 删除死面：`INBOUND_MEDIA_PARTS_EXTRA_KEY`、`userMessageToFilterText`、tool-policy `always/once/never` 别名、ContentPart `face` 变体、`describeVisionPartsAsText`；`processMultimodal` 等公网 shim 标 `@deprecated`（下个大版本删除）。
  - 测试桥归位：`createOpenAiCompletionsStreamFn` 及 wire 转换器移出公共 API（入 agent 测试目录）；`openai-bridge` 只剩 `assistantText`；`legacy-tool-bridge.ts` 正名 `tool-bridge.ts`。
  - 类型修复：`ModelApi = 'ai-sdk' | (string & {})`；`AgentTool.execute` 与实现对齐为三参（删 `as` 强转）。

  **core 层**

  - 死导出整批删除（均零引用）：`AITool`、撞名 `ToolDefinition`、`NoticeType/RequestType`、Interactive 别名全簇、`PermissionService`/`ConfigService` 别名、`getLiveEndpoint`、`qrcode-segment` 整文件；热路径不再自用 deprecated 别名（`resolveInteractiveSegments` 删除，改 `resolveKeyboardSegments`）。
  - im-contract 双 legacy 格式化函数二合一（`formatLegacyMessageRef` 为唯一公开 API）；ai-outbound 的 legacy `kind` 回退分支删除。

  **agent 层**

  - `ZhinAgentPrivate` 58 → 43 成员：死成员/零读取成员删除，deferred 族收敛为 `DeferredTurnState` 模块，三份手工镜像改为权威接口 Pick，`readonly` 名不副实纠偏，AutoContinueHost 单参化。
  - 4 个值导入循环解环（纯函数下沉 collab-utils / ask-user-format / memory-layers）；prompt 双轨收敛（3 个零调用导出 + 死分支删除）；死文件删除；`sandbox-enhanced` 挂 `@deprecated` 摘出公共导出；`tokenUsageToLegacy` 合一、`AGENT_ROLE_CONFIGS` 拆表。

  BREAKING CHANGE：上述删除项均为公共导出面的收窄，详见各条。

## 1.0.2

### Patch Changes

- f8c7a54: fix: im

## 1.0.1

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。
