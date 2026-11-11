---
sidebar: false
---

# 架构决策记录（ADR）索引

本目录收录 Zhin.js 的架构决策记录（Architecture Decision Records, ADR）。每份 ADR 记录一项关键架构边界、背景动机、演进取舍与代码落盘位置。

## 现存 ADR 列表（0034–0052）

### 服务插件与平台适配器契约

| ADR | 标题 | 状态 | 核心落盘模块 |
| --- | --- | --- | --- |
| [ADR 0034](./0034-activity-feedback-service-plugin.md) | Activity Feedback 服务插件 | Accepted / Implemented | `plugins/services/activity-feedback/`、`@zhin.js/core` |
| [ADR 0035](./0035-comment-reply-adapter-contract.md) | 评论型平台适配器契约（Bilibili 先行） | Accepted（Experimental 实现） | `plugins/adapters/bilibili/`、`plugins/adapters/github/` |
| [ADR 0044](./0044-adapter-capability-profile.md) | 适配器能力画像——规范在 zhin，能力由适配器注入，功能按能力组合 | Implemented | `@zhin.js/im-contract`、`@zhin.js/adapter`、`@zhin.js/core` |

### 受控落地、群运营与自我演进

| ADR | 标题 | 状态 | 核心落盘模块 |
| --- | --- | --- | --- |
| [ADR 0036](./0036-controlled-landing-phase0.md) | 受控落地第 0 期——决策审计、控制面与危险工具硬闸 | Implemented | `@zhin.js/agent`（`decision-events`、`scene-control`、`security/`）、`@zhin.js/console` |
| [ADR 0037](./0037-controlled-landing-phase1-group-ops.md) | 受控落地第 1 期——群运营闭环 | Implemented | `@zhin.js/agent`（`group-ops/`、欢迎/公告/日程唤醒/群管冷却） |
| [ADR 0038](./0038-continuous-input-merge.md) | 连续输入合流——高热群与弹幕 | Implemented | `@zhin.js/agent`（入站合流窗口）、`@zhin.js/harness`（Mailbox 合流策略） |
| [ADR 0039](./0039-group-ops-rules.md) | 动态群管规则——批准一次的违规阶梯 | Implemented | `@zhin.js/agent`（`group-ops/` 违规阶梯与硬闸审批） |
| [ADR 0040](./0040-controlled-self-change.md) | 受控自我进化——变更草稿、审批生效与重启回报 | Implemented | `@zhin.js/agent/src/self-change/`、`basic/cli` |

### 提示词缓存与上下文 Token 预算

| ADR | 标题 | 状态 | 核心落盘模块 |
| --- | --- | --- | --- |
| [ADR 0041](./0041-prompt-segments-and-message-headers.md) | 提示词分段组装与消息头 | Implemented | `@zhin.js/agent`（Prompt Section Assembler、消息头格式） |
| [ADR 0042](./0042-first-turn-token-budget.md) | 压低首轮 token——固定前缀瘦身与少走回合 | Implemented | `@zhin.js/agent`（固定前缀裁剪与延迟工具披露） |
| [ADR 0043](./0043-history-token-budget.md) | 历史只存对话——按 token 预算的历史窗口与引用消息 | Implemented | `@zhin.js/ai`、`@zhin.js/agent`（Token 预算滑窗与历史净化） |
| [ADR 0045](./0045-current-message-runtime-context.md) | 当前消息的运行时上下文放在正文之后——让历史前缀可缓存 | Implemented | `@zhin.js/agent`（后缀注入 `[Turn context]`，跨轮 Prefix Cache 稳定） |

### 个人会话、AI Provider 图与多 Agent 协作 Harness

| ADR | 标题 | 状态 | 核心落盘模块 |
| --- | --- | --- | --- |
| [ADR 0046](./0046-personal-session-model-policy.md) | Personal Session model policy | Partially Superseded（Personal Session 有效；Model Catalog/Policy 被 ADR 0047 取代） | `@zhin.js/agent/personal-session`（有效）；模型目录与策略已迁至 `@zhin.js/ai/provider` |
| [ADR 0047](./0047-ai-provider-subscriptions-and-decision-models.md) | AI Provider 订阅接入与多决策模型 | Implemented（Accepted，S0–S4 已合入 main） | `@zhin.js/ai/src/provider/`、`@zhin.js/ai/src/providers/`、`@zhin.js/agent/src/decision/` |
| [ADR 0048](./0048-agent-harness.md) | Agent Harness——从流程到协作 | Implemented（Accepted，H0–H5 已全部完成） | `@zhin.js/harness`、`@zhin.js/core`（`venue/`）、`@zhin.js/agent`、`@zhin.js/a2a` |

### Console：访问控制、三级功能配置与运维

| ADR | 标题 | 状态 | 核心落盘模块 |
| --- | --- | --- | --- |
| [ADR 0049](./0049-console-rbac.md) | Console 访问控制——数据库里的用户、角色与权限 | Accepted | `@zhin.js/console-protocol`、`@zhin.js/host-http`、`basic/cli`（`console/iam/`） |
| [ADR 0050](./0050-layered-feature-config.md) | 功能配置三级覆盖——全局 < 适配器 < 账号 | Accepted | `@zhin.js/runtime`、`@zhin.js/plugin-runtime`、`@zhin.js/core`、`basic/cli` |
| [ADR 0051](./0051-console-terminal.md) | Console 终端——宿主 Shell 与 SSH | Accepted | `basic/cli`（`console/terminal/`）、`@zhin.js/host-http` |
| [ADR 0052](./0052-console-information-architecture.md) | Console 信息架构——状态、功能、运维、访问控制分区 | Accepted | Console 前端（`zhinjs/console`） |

---

## 早期奠基 ADR 摘要（代码中引用的历史架构契约）

早期架构演进中确立的基石契约直接固化在核心包与[系统架构 SSOT](../concepts/architecture.md) 中，关键编号如下：

- **ADR 0001 — Plugin Runtime 唯一入口与能力目录约定**：确立 `plugin.ts` + `definePlugin()` 与命名能力目录（`commands/`、`adapters/`、`components/`、`handlers/`、`middlewares/`、`tools/`、`skills/`、`agents/` 等）为唯一插件模型，移除 `usePlugin()` / `getPlugin()` / `zhin.js/node`（落地于 `@zhin.js/plugin-runtime`、`@zhin.js/runtime`）。
- **ADR 0008 — Canonical ConversationEventStore**：确立 `conversation_events` 为跨会话事件的权威落盘表，支撑统一会话审计、历史重建与游标消费（落地于 `packages/im/zhin/src/setup/register-chat-message-store.ts` 与 `basic/cli`）。
- **ADR 0009 — AgentLoop 与 ContextRepository 解耦**：将无 IM 概念的 `agentLoop` 与上下文仓储沉淀至 `@zhin.js/ai`，与上层 `@zhin.js/agent` 的 IM 编排和权限门禁解耦。
- **ADR 0010 — 会话上下文 Compaction（摘要压缩）**：在 `@zhin.js/ai` 中引入基于 Token 水位线的历史会话自动摘要与压缩机制，防止长对话撑爆上下文窗口。
- **ADR 0019 — 安装体积分层（IM 核心 ≤10MB）**：默认安装 `zhin.js` 仅包含 IM 核心（生产 `node_modules` ≤10MB，由 `pnpm check:install-size` 门禁守护）；AI 能力按需加装 `@zhin.js/agent` + `zod` + `ai` + `@ai-sdk/*`。
- **ADR 0024 — 多 Agent 编排演进（已被 ADR 0048 取代）**：早期五角色矩阵与 Workroom Kernel 探索；其冗余状态机与 `packages/im/workroom` 已在 [ADR 0048](./0048-agent-harness.md) 中正式退役，由 `@zhin.js/harness`（Actor / Mail / Mailbox / Engagement / Authority / GuardKernel）与 `@zhin.js/core` `venue/` 统一取代。
