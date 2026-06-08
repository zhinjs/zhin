# Tools（test-bot 增量 — 识图/出图路由见 agents/vision、agents/draw 与 # Orchestration）

## 会话管理（ADR 0010）

配置见 `zhin.config.yml` → `ai.agent.compaction`（`enabled` / `auto` / `keepRecentTokens`）。

| 命令 | 说明 |
|------|------|
| `/compact` | 手动 L2 压缩当前 epoch |
| `/tree` | 列出 user 分支点 |
| `/tree N` | 跳转到第 N 个分支点并从此继续 |
| `/reset` | 归档 epoch，下次 @ 新上下文（`im_transcripts` 保留） |

## 运维与内省

| 命令 | 说明 |
|------|------|
| `/models` | 列出可用模型 |
| `/health` | AI Provider 健康检查 |
| `/cmd` | 已注册 IM 命令列表 |
| `/bots` | Bot 与在线状态 |
| `/bindings` | `ai.agents` 绑定 |
| `/tools` | 已注册 ZhinTool |
| `/mcp` | MCP Server 连接状态 |

内省命令支持 **`[filter] [page]`**（例：`/tools github 2`）。列表过长时自动拆多条消息；页脚含 REST 与控制台链接。

Host API（Bearer）：`GET /api/introspection/{commands|bots|bindings|tools|mcp}?page=1&filter=...`；会话树：`GET /api/agent/sessions/:sessionKey/tree`、`POST .../leaf`。

## Sub-agent 编排

无新 slash 命令；主 agent 用自然语言 + `spawn_task` 编排。

| 模式 | 说明 |
|------|------|
| `context: fork` | 注入主会话 active_leaf 最近消息（过滤 spawn/tool_search 噪声） |
| `context: fresh` | 空 standalone 上下文（reviewer / planner 默认） |
| `role: reviewer` | 只读审查，无 bash / write_file |

示例 prompt（私聊 @ bot）：

> 先让 researcher 用 fork 模式梳理 `packages/im/agent/src/subagent.ts` 的职责，再 spawn reviewer（fresh）审查其 API 设计，两次都 `wait: true`。

对应工具调用形态：`spawn_task({ agent: "reviewer", task: "...", wait: true, context: "fresh" })`。预设见 `agents/reviewer.agent.md`。

## ICQQ 出图

- Zhin 与 icqq 异机或走 RPC 时：bot 配置 `outboundMedia: base64`（见 `zhin.config.yml` 与 `plugins/adapters/icqq/README.md`）
