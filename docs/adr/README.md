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
| [0023](./0023-group-cell-multi-endpoint-agents.md) | GroupCell 多 Endpoint Agent 协作 |
| [0024](./0024-five-agent-aop-pipeline.md) | Five-Agent Pipeline（Superseded） |
| [0025](./0025-adapter-ai-outbound-json.md) | Adapter 驱动的 AI 结构化出站 JSON |
| [0026](./0026-retire-scenario-specific-pipeline-harnesses.md) | 废弃场景专用 Pipeline Harness |
| [0027](./0027-agent-run-orchestration-kernel.md) | Agent Run Orchestration Kernel |

## 相关

- [架构索引](../architecture/)
- [Harness 检查来源](../architecture/harness-engineering-sources.md)
- [贡献指南 — 文档 SSOT](../contributing#文档-ssot-同步清单)
