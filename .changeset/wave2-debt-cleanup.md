---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/core": minor
"@zhin.js/im-contract": patch
"@zhin.js/adapter": patch
---

refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

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
