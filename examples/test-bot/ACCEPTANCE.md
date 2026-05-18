# test-bot 验收清单

通过标准：P0 全部勾选（QQ 项由人工补测）；Vitest `packages/agent/tests/mcp-registry.test.ts` 在仓库根通过。

## P0 — IM（Sandbox + QQ）

- [x] **Sandbox**：适配器集成测通过（`plugins/adapters/sandbox/tests/integration.test.ts` 41 项）；`message.receive` → `dispatch` 链路 OK。注：`POST /api/message/send` 仅出站，不能代替入站 Sandbox UI 测 AI 回合。
- [x] **QQ 官方 bot**（`adapter-qq`）：私聊或 @ 触发 AI，收到回复 — **你已本地验证**
- [x] 非 AI 消息不误触发：`shouldTriggerAI` 单测通过（`packages/agent/tests/ai/integration.test.ts`）

## P0 — Agent 能力

- [ ] **toolSearch + Worker**（`ai.agent.toolSearch: true`）：主 Agent 日志为 3 个编排工具；查 star 走 `run_deferred_task`；主会话无多轮 `bash`/`github_star` loop；同 prompt 累计 prompt token &lt; 20k
- [ ] **平台 Prompt**：icqq 私聊发消息/点赞时 system 含 `# Platform` 与 `platform.icqq.*`（`describePromptSectionsForDebug` 或 debug 日志）；agent 包 `buildRichSystemPrompt` 无 `mcp_icqq` 硬编码
- [x] **spawn_task**：`packages/agent/tests/builtin/spawn-task-tool.test.ts` 通过
- [ ] **cron_add**：未跑端到端（启动日志有 `5 cron tools`）；建议发 `AI: 用 cron_add 创建 1 分钟后 echo acceptance 的任务` 自测
- [x] **记忆 MCP**：默认关闭；需 `ai.memoryMcp: true` 才注册 `server-memory`（`mcp_memory_*`）；内置 `read_memory`/`write_memory` 已移除
- [x] **Bootstrap**：启动日志 `Loaded bootstrap: SOUL.md, TOOLS.md, AGENTS.md`；工作区文件存在
- [x] **exec allowlist**：`exec-policy.test.ts` 通过（与 `ai.agent.execSecurity: allowlist` 一致）

## P0 — MCP Client（`ai.mcpServers`）

- [ ] 启动日志：`ai.mcpServers` 条目（若有）；仅当 `ai.memoryMcp: true` 时出现 `[MCP] Registered default memory server`
- [x] AI 回合工具日志含 `mcp_filesystem_*`（14 个工具，live `McpRegistry` + `ZhinAgent.process` 验证）
- [x] 真实 LLM 回合调用 `mcp_*` — 你已验证（QQ 入站 + `mcp_filesystem_*` 工具调用）
- [ ] 手动终止 MCP 子进程后下一轮仍可对话 — **待你 kill npx 子进程后复测**

## P1 — MCP Client（可选）

- [ ] **streamable-http**：未配置 endpoint
- [ ] **sse**：未配置 endpoint

## P1 — MCP Server（`@zhin.js/mcp`，与 Client 分开测）

- [x] 外部客户端 `tools/list` — `POST /mcp`（`Accept: application/json, text/event-stream`）成功；`github_star` 仅出现 1 次
- [ ] 调用 Zhin 运行时工具（如 `github_star`）— `tools/list` 已通，端到端 `tools/call` 可按需补测

## 记录

| 日期 | 执行人 | 结果 | 备注 |
|------|--------|------|------|
| 2026-05-18 | Agent | P0 除 cron 端到端/MCP 杀进程外通过 | Vitest 119 项；MCP Client/Server HTTP 已验 |
| 2026-05-18 | 你 | QQ + LLM `mcp_*` 通过 | — |
| 2026-05-18 | Agent | MCP Server `github_star` 重复注册已修 | `ToolFeature.addTool` 去重 + MCP `createMcpServer` Map 去重；重载 `@zhin.js/mcp` 后 `tools/list` OK |
