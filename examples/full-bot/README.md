# full-bot（L4 全维度参考）

在 [`minimal-bot`](../minimal-bot/)（Stable）之上叠加 L4 能力：**硬编排**、**语义记忆**、**MCP Agent Mesh**、**Sandbox + NapCat + KOOK** 三适配器。

维护者厨房水槽仍见 [`../test-bot`](../test-bot/)。

## 与 minimal-bot / test-bot

| 示例 | 定位 |
|------|------|
| minimal-bot | Stable 黄金路径（**仅 IM**，`ai.enabled: false`） |
| **full-bot** | L4 参考（**含 `@zhin.js/agent` + provider**），`pnpm check:l4` |
| test-bot | 厨房水槽，全平台/全插件；**勿复制到新项目** |

Provider 网关（OpenCode / OpenRouter 等）的 sdk 与 `contextWindow` 预设见 [AI 模块 — 已知 LLM 网关预设](../../docs/advanced/ai.md#已知-llm-网关预设)。L4 契约测试：`examples/full-bot/tests/provider-gateway-contract.test.ts`。

## 依赖

本示例 `package.json` 已声明 `@zhin.js/agent`、`zod`、`ai` 与所用 `@ai-sdk/*`。从 minimal-bot 升级时请对照安装，或运行 `zhin doctor --upgrade-l4`。

## 可选多模态

`zhin.config.yml` 内含注释块 `speech:`、`htmlRenderer:`、`ai.multimodal.audio`。启用前安装 optional peer：

```bash
pnpm add @zhin.js/speech @zhin.js/html-renderer   # 按需
zhin doctor --fix
```

排查 stage 日志见 [AI 内容链可观测](../../docs/advanced/ai-content-chain.md)；Adapter 矩阵见 [Rich Segment 适配器](../../docs/essentials/rich-segment-adapters.md)。

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
- `ai.remoteAgents` loopback `cardUrl` 指向本机 A2A Agent Card（`/a2a/zhin/...`）
- `@zhin.js/a2a` + `@zhin.js/mcp` 插件 + Bearer 鉴权

详见 [`zhin.config.yml`](./zhin.config.yml) 与 [`ACCEPTANCE.md`](./ACCEPTANCE.md)。

## 记忆分层

- **纲领**：[`data/memory/global/MEMORY.md`](./data/memory/global/MEMORY.md)
- **可检索事实**：`memory_entries` 表 + `memory_search` / `memory_upsert`
- **提炼 skill**：[`skills/memory-consolidate/SKILL.md`](./skills/memory-consolidate/SKILL.md)

## 文档

- [Agent Mesh](../../docs/advanced/agent-mesh.md)
- [学习路径 — L4](../../docs/essentials/learning-paths.md)
