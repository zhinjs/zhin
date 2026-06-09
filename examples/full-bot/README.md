# full-bot（L4 全维度参考）

在 [`minimal-bot`](../minimal-bot/)（Stable）之上叠加 L4 能力：**硬编排**、**语义记忆**、**MCP Agent Mesh**、**Sandbox + NapCat + KOOK** 三适配器。

维护者厨房水槽仍见 [`../test-bot`](../test-bot/)。

## 与 minimal-bot / test-bot

| 示例 | 定位 |
|------|------|
| minimal-bot | Stable 黄金路径，`pnpm check:stable` |
| **full-bot** | L4 参考，`pnpm check:l4` |
| test-bot | 厨房水槽，全平台/全插件 |

## 快速开始

```bash
# 仓库根已 pnpm install && pnpm build
cd examples/full-bot
cp .env.example .env
pnpm dev
```

- Host 默认 `http://127.0.0.1:8069`
- Remote Console API Base + Token 与 `.env` 中 `HTTP_TOKEN` 一致
- NapCat/KOOK：见 [ACCEPTANCE.md](./ACCEPTANCE.md) 可选实机段

## L4 配置要点

- Missions 硬编排内置（无 `ai.orchestration` 配置项）
- `ai.memory.semantic.enabled: true`（`autoConsolidate: false`，由 skill 触发）
- `ai.remoteAgents` loopback 指向本机 `/mcp`
- `@zhin.js/mcp` 插件 + Bearer 鉴权

详见 [`zhin.config.yml`](./zhin.config.yml) 与 [`ACCEPTANCE.md`](./ACCEPTANCE.md)。

## 记忆分层

- **纲领**：[`data/memory/global/MEMORY.md`](./data/memory/global/MEMORY.md)
- **可检索事实**：`memory_entries` 表 + `memory_search` / `memory_upsert`
- **提炼 skill**：[`skills/memory-consolidate/SKILL.md`](./skills/memory-consolidate/SKILL.md)

## 文档

- [Agent Mesh](../../docs/advanced/agent-mesh.md)
- [学习路径 — L4](../../docs/essentials/learning-paths.md)
