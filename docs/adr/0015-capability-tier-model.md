---
sidebar: false
---

# 能力分档模型（Stable / Platform Stable / Advanced / Experimental）

定义 Zhin.js 对外能力承诺的四档体系、CI 绑定与适配器升档规则。

## 状态

已接受（2026-06-10）· **已实现**（文档、`scripts/sync-adapter-docs.mjs`、`scripts/run-stable-smoke.mjs`）

## 背景

2026-06 之前文档使用二元 **Stable / Advanced**，且 Stable 几乎等同于 `minimal-bot` + Sandbox。大量已有 `integration.test.ts` 的 IM 适配器、Feature 体系（cron）、MCP Client 基础能力被标为 Advanced，导致：

- 对外叙事与工程证据脱节；
- 用户误以为 Zhin 是「纯 AI 框架、无传统命令、无多平台承诺」；
- 维护者不敢升档，怕扩大 support 面。

## 决策

### D1 — 四档定义

| 档位 | 含义 | CI / 示例 |
|------|------|------------|
| **Stable（Core）** | 黄金路径：Sandbox + Agent + Feature + MCP Client 契约 | `pnpm check:stable` Core 批次；[minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) |
| **Platform Stable** | 主流 IM 适配器；框架侧入站/出站 integration 有 CI | `pnpm check:stable` Platform 批次；档位权威来源 `ADAPTER_META` |
| **Advanced** | opt-in 复杂度或未纳入 Stable smoke 的能力 | `toolSearch`、MCP Mesh、多 Endpoint；[test-bot ACCEPTANCE](https://github.com/zhinjs/zhin/blob/main/examples/test-bot/ACCEPTANCE.md) |
| **Experimental** | 协议/平台仍在变；无全量对外承诺 | OneBot12、Milky、Satori、Email、GitHub |

**Platform Stable 边界**：框架保证 Adapter 契约（normalize、sendMessage 链路、integration）；**平台账号、风控、部署差异由用户自担**。实机 smoke 可选：`L4_SKIP_PLATFORM=0` + 环境变量。

### D2 — 权威来源

| 资产 | 路径 |
|------|------|
| 适配器档位 | `scripts/sync-adapter-docs.mjs` → `ADAPTER_META` |
| 用户文档 | [能力分档](../essentials/capability-tiers.md)、[平台适配器索引](../adapters/index.md) |
| Stable smoke | `scripts/run-stable-smoke.mjs`（Core / Platform 分两批 Vitest，避免隔离泄漏） |
| L4 参考 | `pnpm check:l4`；[full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) |

### D3 — 适配器升档至 Platform Stable 条件

须同时满足：

1. `plugins/adapters/<slug>/tests/integration.test.ts` 存在且通过；
2. 包内 README 含「前置条件」「最小配置」；
3. 加入 `run-stable-smoke.mjs` 的 `platformStableTests`；
4. 更新 `ADAPTER_META` 并运行 `pnpm sync:adapter-docs`。

降档或保持 Experimental：无 integration、或协议/API 频繁破坏性变更。

### D4 — Stable（Core）能力范围

除 Sandbox 外，下列能力属 **Stable 承诺**（不要求用户开 Advanced 开关）：

- **命令系统**：`MessageCommand`、`CommandFeature`（与 AI 共用 Dispatcher）；
- **Feature 体系**：Tool、Skill、cron、数据库抽象；
- **MCP Client 基础**：注册、重连（`mcp-registry.test.ts`）；配置默认关闭，非「能力未实现」；
- **Agent 基础**：`agentLoop`、`spawn_task`、exec 策略、Bootstrap 文件。

下列仍为 **Advanced**（默认关或复杂度高）：

- `ai.agent.toolSearch`（deferred Worker）；
- MCP Server / Agent Mesh / `remoteAgents`；
- 多 Endpoint 同进程厨房水槽配置；
- Assistant Runtime（`assistant.enabled`）。

### D5 — GUI 边界

管理面 UI **不在** Host 端口内嵌；官方 GUI 为 **[Remote Console](../console-remote.md)**（`zhin-console` 已与 [console/requirements.md](../console/requirements.md) 对齐）。

### D6 — 产品边界（聊天 / 生活助手）

Zhin **不对标** coding-agent / IDE 助手：

- **不做**：plan mode、以改代码/改仓库为主轴的 Agent UX、pi 式终端 coding harness。
- **要做**：IM 聊天与生活助手（对话、记忆、cron、Home、通知）；[Assistant Runtime](../architecture/assistant-runtime.md) 为 opt-in 延伸。
- **RAG / 知识库**：可计划为 Advanced，非当前 Stable 承诺。
- **pi ADR 0010**：仅借鉴 compaction、会话树、Skills 包管理等**会话层**机制；显式排除 plan mode（见 ADR 0010「不在本 ADR 范围」）。

MCP Server 允许外部 IDE **调用** Zhin 工具，不将 Zhin 定义为写代码产品。

## 后果

- README / 文档须使用四档术语，避免「多平台 IM = Advanced」一类过时表述；
- 升档须同步 CI，不得仅改 markdown；
- `check:stable` 变长；Core 与 Platform 分两批执行；
- 无代码 RAG / 多流水线拖拽 GUI **不在**本 ADR；RAG 若做则单独 ADR，归 Advanced。
- plan mode / coding-agent 产品形态 **永久不在** Zhin 产品范围；Issue/PR 引入此类能力应先更新 ADR。

## 相关

- [能力分档（用户向）](../essentials/capability-tiers.md)
- [ADR 0014 — 稳定性增强路线图](./0014-stability-enhancement-roadmap.md)
- [Harness 工程](../contributing/harness-engineering.md)
