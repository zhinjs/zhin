# test-bot 验收清单

**对外承诺范围 = Stable**（见 [minimal-bot](../minimal-bot/)）。本目录为**厨房水槽**：多 Endpoint、toolSearch、MCP 等用于 Advanced / 回归，勿当作默认模板。

Vitest 基线：仓库根 `pnpm test`；MCP 注册相关见 `packages/agent/tests/mcp-registry.test.ts`。

**CI Stable smoke**（入站 + 配置契约 + 核心 Agent 单测，无真实 LLM）：

```bash
pnpm check:stable
```

**Advanced 自动化契约**（toolSearch / 平台 Prompt / cron / MCP 重连；无 QQ 实机）：

```bash
pnpm vitest run packages/agent/tests/advanced-acceptance.test.ts \
  packages/agent/tests/cron-engine.test.ts \
  packages/agent/tests/mcp-registry.test.ts \
  packages/agent/tests/tool-search-orchestrator.test.ts \
  packages/agent/tests/ai/prompt-discipline.test.ts \
  packages/agent/tests/icqq-agent-prompt.test.ts
```

---

## Stable（与 minimal-bot 一致；CI / 单测可覆盖）

通过标准：下列项勾选；由 `pnpm check:stable` 在 CI 中运行。

### IM

- [x] **Sandbox**：`plugins/adapters/sandbox/tests/integration.test.ts`（含于 `pnpm check:stable`）
- [x] **非 AI 不误触发**：`packages/agent/tests/ai/integration.test.ts` → `shouldTriggerAI`（含于 `pnpm check:stable`）

### Agent（minimal 配置：无 toolSearch、无 MCP）

- [x] **spawn_task**：`packages/agent/tests/builtin/spawn-task-tool.test.ts`（含于 `pnpm check:stable`）
- [x] **Bootstrap**：工作区 `SOUL.md` / `TOOLS.md` / `AGENTS.md`（本目录；手测 / 启动日志）
- [x] **exec allowlist**：`packages/agent/tests/exec-policy.test.ts`（含于 `pnpm check:stable`）
- [x] **minimal-bot 配置契约**：`examples/minimal-bot/tests/stable-path.test.ts`（含于 `pnpm check:stable`）

### 说明

- **QQ 官方 bot**、真实 LLM、`mcp_*` 调用属于 **Advanced**，不在 Stable 承诺内。
- Stable 手测步骤见 [minimal-bot/README.md](../minimal-bot/README.md)。

---

## Advanced（test-bot 全配置；需人工或完整环境）

未勾项不表示「产品损坏」，仅未纳入 Stable 发布承诺。

### IM

- [x] **QQ 官方 bot**（`adapter-qq`）：私聊或 @ 触发 AI — 已本地验证
- [x] **微信 iLink**（`adapter-weixin-ilink`）：ClawBot 灰度实机 dogfood（2026-06-25）
  - [x] Remote Console `/weixin-ilink` 扫码 → `data/weixin-ilink/<name>.json` 凭证落盘
  - [x] 私聊文本入站 → 命令 / `@` Agent 回复 → 标准发送链出站
  - [x] 媒体收发（图片 + 语音/文件）
  - [x] Typing indicator（`sendTyping`）长任务期间可见
  - [x] 文档边界：**仅私聊、无群**（见 [weixin-ilink README](../../plugins/adapters/weixin-ilink/README.md)）
  - 实机回归：`L4_SKIP_PLATFORM=0` + 配置 `weixin-ilink` 段后跑 `pnpm check:l4`（可选）
- [x] **toolSearch + Worker**（`ai.agent.toolSearch: true`）：主编排 3 工具（`tool_search` / `run_deferred_task` / `ask_user`）；查 star 走 Worker — `advanced-acceptance.test.ts`、`tool-search-orchestrator.test.ts`；prompt token &lt; 20k — `advanced-acceptance.test.ts`
- [x] **平台 Prompt**：icqq system 含 `# Platform`（经 `resolveAgentPromptMarkdown`）；通用 `buildRichSystemPrompt` 无 `mcp_icqq` 硬编码 — `prompt-discipline.test.ts`、`icqq-agent-prompt.test.ts`、`advanced-acceptance.test.ts`

### Agent

- [x] **cron_add** 端到端：`PersistentCronEngine` 持久化 + 调度触发 runner — `packages/agent/tests/cron-engine.test.ts`（手测：`AI: 用 cron_add 创建 1 分钟后 echo acceptance`）
- [x] **记忆 MCP**：默认关；`ai.memoryMcp: true` 才注册 `server-memory`
- [ ] **ADR 0010 Harness**（手测，见 [TOOLS.md](./TOOLS.md)）：`/compact` 压缩长对话；`/tree` + `/tree N` 分支跳转；`/reset` epoch 归档；`/cmd` `/bindings` `/mcp` 内省
- [ ] **Sub-agent 增量对齐**（手测，见 [TOOLS.md § Sub-agent](./TOOLS.md#sub-agent-编排)）：`spawn_task({ agent: "reviewer", wait: true })` 无 write/bash；fork 子任务能引用主会话最近意图；fresh reviewer system 不含主会话 tool 链；超长结果写入 `data/artifacts/subagent/{taskId}.md`

### MCP Client

- [ ] 启动日志 `ai.mcpServers` / memory server 条目（按配置；手测 test-bot 启动）
- [x] **mcp_filesystem_*** 工具注册（`McpRegistry` + 实机已验）
- [x] **杀 MCP 子进程后下一轮仍可对话**：僵死连接 `isHealthy` 失败后 `connect` / `ensureConnected` 重连 — `mcp-registry.test.ts`（`reconnects when cached connection fails health check`）；手测：kill `npx` MCP 子进程后再发一条 IM 消息

### MCP Server（`@zhin.js/mcp`）

- [x] 外部 `tools/list`（`POST /mcp`）
- [ ] 端到端 `tools/call`（如 `github_star`）— 按需

### P1（可选）

- [ ] streamable-http / sse MCP endpoint
- [ ] 其他 P1 项见历史记录

---

## 记录

| 日期 | 执行人 | 结果 | 备注 |
|------|--------|------|------|
| 2026-05-18 | Agent | Advanced 部分通过 | Vitest 119 项 |
| 2026-05-18 | 你 | QQ + LLM `mcp_*` 通过 | — |
| 2026-06-01 | Plan 1 | Stable/Advanced 分档 | 对外承诺以 Stable 为准 |
| 2026-06-01 | Plan 3 | Advanced 四项 Vitest + ZhinAgent 拆分 | `index.ts` &lt;600 行；`turn-pipeline` / `prompt-assembly` / `tool-orchestration` |
| 2026-06-25 | liuchunlang | weixin-ilink 实机 dogfood 通过 | ClawBot 灰度；#486 关闭 |
