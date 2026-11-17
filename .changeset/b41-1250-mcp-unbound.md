---
"zhin.js": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
---

已连接却没有任何 Agent 绑定的 MCP 服务器会被明确提示（zhinjs/zhin#1250 第 41 批 `mcp-connected-but-unbound`）：

- 原因：每一轮的 MCP 工具只取当前 Agent 在 `ai.agents.<name>.mcpServers` 里点名的服务器，`ai.mcpServers` 只负责连接。项目配了 `ai.mcpServers` 的 GitHub MCP、`zhin status` 显示「已连接，49 个工具」，但 `ai.agents.zhin: {}` 没写 `mcpServers`，Agent 一个 GitHub 工具都拿不到，只能默默改走网页搜索；文档和配置说明却写成「连接成功后进入工具池」。
- 文档与配置说明：中英文 `ai/index`、`configuration/index`、`ai/agent` 写清「`ai.mcpServers` 只负责连接，在 `ai.agents.<name>.mcpServers` 里绑定才能用」，并给出连接 + 绑定的完整示例；`ai.mcpServers` 与 `ai.agents.<key>.mcpServers` 的配置说明（Host 配置 Schema 与 `AgentStartupConfig` / `AgentBindingConfig` 注释）同步改写，`docs/configuration/generated.md` 由 `pnpm docs:config` 重新生成。
- `GET /introspection/mcp` 的每一行新增 `boundAgents`（`ConsoleMcpServerRow.boundAgents`，绑定该服务器的 Agent；运行中的 Agent 优先，没有时读配置文件；绑定项写成服务器名或 `{ name, … }` 对象都算绑定，ADR 0065 的对象写法落地后不会误报未绑定）。
- Console「需要你处理」新增 `mcp.unbound`（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`）：已连接但没有任何 Agent 绑定的服务器列为「MCP 服务 github 已连接但没有 Agent 能用」，说明在 `ai.agents.<name>.mcpServers` 里绑定（例如 `ai.agents.zhin.mcpServers: [github]`）；实例运行时 `zhin doctor` 经同一个列表列出它。
- `zhin status` 的 MCP 行对这种服务器标 `!` 并注明「已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定」，已绑定的服务器列出绑定它的 Agent。
- Agent 就绪日志的 `mcp:` 段只列这个 Agent 真正绑定的服务器，没绑定的另起一段写成 `未绑定: github(待连接)`（如 `ready | zhin | mcp: - | 未绑定: github(待连接) | …`），不再像是已经绑给了它；调试日志相应写成 `mcp configured:`。
- MCP 工具本身的权限过滤不变。
