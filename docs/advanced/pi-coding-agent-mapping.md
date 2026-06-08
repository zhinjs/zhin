# pi coding-agent → Zhin.js API 对照

对照 [pi `packages/coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) 与 Zhin [ADR 0010](../adr/0010-pi-coding-agent-harness-alignment.md)。Zhin **不**依赖 `@earendil-works/pi-coding-agent`；本表描述干净室等价能力。

## Harness 能力

| pi coding-agent | Zhin.js |
|-----------------|---------|
| L1 micro + L2 LLM compaction | `transformContext` → `autoCompactAgentMessagesIfNeeded` |
| `keepRecentTokens` | `ai.agent.compaction.keepRecentTokens`（默认 20000） |
| `/compact` | IM：`/compact`；配置：`ai.agent.compaction.*` |
| 溢出恢复 | `agentLoop` `onContextOverflow` |
| 消息级会话树 | `agent_messages.parent_id` + `active_leaf_message_id` |
| `/tree` `/fork` | IM：`/tree`、`/tree N`、`/fork N` |
| Skills 目录 | `skills/`、`~/.zhin/skills/`、`.agents/skills/`（向上至 git root） |
| `pi install` | `zhin packages install npm:…` / `git:…` |
| `ExtensionAPI.registerTool` | Plugin `addTool` / `toolService.addTool` |
| `on('tool_call')` | `ctx.ai.onBeforeToolCall` / `onAfterToolCall` |
| 自定义 compaction extension | `ctx.ai.onTransformContext`（在内置压缩之后链式执行） |
| `registerCommand` | Plugin `addCommand` / `MessageCommand` |

## 刻意不等价

| pi | Zhin |
|----|------|
| 终端独立进程 / `--mode rpc` | IM 常驻 bot（`zhin dev` / `zhin start` + Adapter） |
| `createAgentSession`（终端会话文件） | `ZhinAgent` + `session_key` / DB `agent_messages` |
| 项目 `trust.json` | IM sender 角色 + exec/file policy |
| 终端 TUI `/tree` 可视化 | IM 文本列表 + Console API |
| 内置 sub-agents | `spawn_task` / `run_deferred_task` |
| 无 MCP 哲学 | 内置 MCP 客户端 |
| `data/skills` | **已删除**；用 `skills/` 或 `.agents/skills/` |
| IM 出站 | 仍走 Adapter 链（ADR 0004） |

## Plugin 钩子示例

```typescript
import { usePlugin } from 'zhin.js';

const { useContext } = usePlugin();

useContext('ai', (ai) => {
  if (!ai) return;
  const off = ai.onBeforeToolCall(({ toolCall }) => {
    if (toolCall.name === 'bash') return { allowed: false, reason: 'demo' };
  });
  return off;
});
```

## CLI 示例

```bash
# zhin-package
zhin packages install npm:@scope/my-zhin-tools
zhin packages list
```
