# 架构决策记录（ADR）

本目录记录 Zhin.js 重大架构与产品边界决策。新 ADR 使用递增编号 `NNNN-short-title.md`。

| ADR | 标题 |
|-----|------|
| [0001](./0001-use-multi-context-domain-docs.md) | 使用多上下文领域文档 |
| [0002](./0002-centralize-im-inbound-routing.md) | 集中 IM 入站路由 |
| [0003](./0003-centralize-agent-tool-selection-and-context-budget.md) | 集中 Agent 工具选择和上下文预算 |
| [0004](./0004-normalize-queue-outbound-fields-before-im-send.md) | IM 发送前先规范化队列出站字段 |
| [0005](./0005-use-instance-scoped-console-entry-stores.md) | 使用实例作用域的 Console EntryStore |
| [0006](./0006-use-convention-first-config-defaults.md) | 使用约定优先的配置默认值 |
| [0007](./0007-ai-agent-model-harness-yaml-overrides.md) | AI Agent modelHarness YAML 覆盖与合并边界 |
| [0008](./0008-introduce-assistant-runtime.md) | 引入 Assistant Runtime（个人助手 / 路线 A） |
| [0009](./0009-pi-aligned-ai-agent-core.md) | 对齐 pi 的 AI/Agent 核心（Context + stream + agentLoop） |
| [0010](./0010-pi-coding-agent-harness-alignment.md) | 对齐 pi coding-agent Harness（Compaction / 会话树 / 生态） |
| [0011](./0011-missions-harness-alignment.md) | 对齐 Missions Multi-Agent Harness（missions / MissionRunner） |
| [0012](./0012-memory-lifecycle-stability-fixes.md) | 内存与生命周期稳定性修复 |
| [0013](./0013-graceful-shutdown-protocol.md) | Graceful Shutdown 协议 |
| [0014](./0014-stability-enhancement-roadmap.md) | 稳定性增强路线图 |
| [0015](./0015-capability-tier-model.md) | 能力分档模型 |
| [0016](./0016-demo-host-token-scopes.md) | Demo Host Token 作用域（demo.zhin.dev） |
| [0017](./0017-rag-v0-knowledge-search.md) | RAG v0 知识检索 |
| [0018](./0018-ai-sdk-transport-layer.md) | AI SDK Transport Layer |
| [0019](./0019-install-size-layering.md) | 安装体积分层（IM <10MB、peer、TypeBox→Zod） |
| [0020](./0020-speech-pipeline-stt-tts.md) | 语音管线 STT/TTS 与 AI 内容链 |
| [0021](./0021-content-moderation.md) | 内容审查 — 机制在框架，策略在运营者 |
| [0022](./0022-interactive-button-modes.md) | Interactive 按钮 callback / command 双模式 |
| [0023](./0023-group-cell-multi-endpoint-agents.md) | CollaborationScene 多 Endpoint Agent 协作 |
| [0024](./0024-five-agent-aop-pipeline.md) | Five-Agent Pipeline（Superseded） |
| [0025](./0025-adapter-ai-outbound-json.md) | Adapter 驱动的 AI 结构化出站 JSON |
| [0026](./0026-retire-scenario-specific-pipeline-harnesses.md) | 废弃场景专用 Pipeline Harness |
| [0027](./0027-agent-run-orchestration-kernel.md) | Agent Run Orchestration Kernel |
| [0028](./0028-generic-im-scene-agent.md) | Generic IM Scene Agent（Scene 契约 + 破坏性统一） |
| [0029](./0029-deferred-tool-schema-loading.md) | Deferred Tool Schema Loading |
| [0030](./0030-spawn-parallel-subagents.md) | spawn_task 并行子代理与并发治理 |
| [0031](./0031-schedule-facility-replace-cron.md) | Schedule 设施取代 Cron |
| [0035](./0035-a2a-agent-mesh.md) | A2A Agent Mesh（替换 MCP Mesh v1） |
| [0036](./0036-internal-room-collaboration.md) | Internal Room 层内协作（破坏性） |
| [0038](./0038-activity-feedback-schedule-phases.md) | Activity Feedback 资格与 Schedule 三相位 |
| [0039](./0039-eve-aligned-agent-surface-roadmap.md) | Eve 对齐 Agent 创作面 — 边界与分阶段路线 |
| [0040](./0040-http-step-checkpoint-persistence.md) | HTTP Step Checkpoint 持久化与 session.waiting park/resume |
| [0041](./0041-agent-stream-bus-and-session-host-port.md) | AgentStreamBus + Session 拆分 + AgentSessionHostPort |
| [0042](./0042-capability-features-and-on-demand-ingress.md) | Capability Features 与按需 Capability Ingress |
| [0043](./0043-unify-capability-roots.md) | 统一 Capability Root 与声明式文件接口 |
| [0044](./0044-typescript-hmr-plugin-kernel.md) | TypeScript HMR Plugin Kernel |
| [0045](./0045-hierarchical-plugin-config-schema.md) | 层级 Plugin 配置与 schema.json |
| [0046](./0046-convention-pages-and-plugin-navigation.md) | 约定式 pages 与 Plugin 导航树 |
| [0047](./0047-standalone-plugin-and-root-lifecycle-domain.md) | 独立 Plugin 项目与 Root 生命周期域 |
| [0048](./0048-plugin-monorepo-and-feature-provider-packages.md) | Plugin Monorepo 与 Feature Provider 包 |

## 相关

- [架构索引](../architecture/)
- [Harness 检查来源](../architecture/harness-engineering-sources.md)
- [贡献指南 — 文档 SSOT](../contributing#文档-ssot-同步清单)
