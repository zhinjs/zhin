---
"@zhin.js/mcp-feature": minor
"@zhin.js/agent": minor
"@zhin.js/runtime": patch
"zhin.js": patch
---

MCP 工具按聊天角色授权（ADR 0065 P0 + P1）。**行为变更：已经绑给聊天 Agent 的 MCP 服务器，升级后立刻收紧**——不写 `permit` 时，只有上游标注 `readOnlyHint: true` 的工具对所有人开放，其余工具（未标注、标注为写、`readOnlyHint` 与 `destructiveHint` 矛盾）只给全局主人 `owner@global`。迁移说明见 `docs/migrations/mcp-tool-permit.md`。

- 接入 MCP 服务器时保留上游 `annotations`，转成 `McpToolDescriptor.hints` / `ToolCapability.mcpHints`（只接受布尔值）。标注只决定权限档位，不放宽审批：MCP 工具仍是 `on-risk`，照常走审批、文件策略、网络白名单和硬闸。
- 配置：`ai.mcpServers[].permit`（`readOnly` / `default` / `tools`，值为 `everyone`、`deny`、一个 permit DSL 字符串或 DSL 数组），`ai.agents.<name>.mcpServers[]` 可写 `{ name, permit }`，与服务器级结果取 AND，只能收窄。`tools` 按上游原始工具名匹配：精确名优先，其次字面字符最多的 `*` 模式，并列时都要满足；非 ASCII 工具名只能被精确名命中。`everyone` / `deny` 放进数组、空数组、未知键、重复的模式、同一 Agent 里重复的服务器、DSL 写错（含已移除的 `master` 等）都会让启动报错。
- 每轮组装工具池时按本轮发送者的聊天角色过滤：没有权限的 MCP 工具不进工具池，`discover`、`load_tool` 和 `alwaysLoaded` 里都没有。执行前按角色存储里的当前角色再判一次；会话历史里重放的旧调用、回合中被撤销的角色、子 Agent 沿用的父回合能力都会被拒绝，记 `tool_denied`，`policy: 'mcp-permit'`。
- 定时任务按创建者当前的角色降一档运行，所以全局主人创建的任务默认也用不了「仅主人」的 MCP 工具；需要时在 `permit.tools` 里把该工具放宽到 `trusted`。A2A、zhin 自己的 MCP Server 入口同样只能用只读工具。
- 恢复旧行为写 `permit: { default: everyone }`（不推荐：普通成员发起的写操作在 `execApprovalMode: auto` 下经自动审核即可执行）。
- 修复：配置的 MCP 服务器投影给 Agent 的工具名带了一层多余的服务器前缀，调用上游时发送的也是带前缀的名字；现在使用上游报告的原始名。
- 修复：合并的群聊回合（ADR 0038）此前只收窄 `roles`，聊天角色仍取第一个发言者的，permit（含 MCP 工具档位）因此把 trusted / admin 成员的工具借给了同一合并窗口里的普通成员；现在聊天角色取所有成员共同持有的最低角色，层级取最窄的。
- 修复：`ai.agents.<name>.mcpServers`（含 Agent 层 `permit`）加入自我变更禁改名单，Agent 不能用 `self_change` 删掉收窄或给绑定加服务器。
- `@zhin.js/runtime`：配置 schema 增加上述两处字段，`ai.agents.<name>.mcpServers` 标为安全敏感。
