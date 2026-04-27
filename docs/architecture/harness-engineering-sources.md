# Harness Engineering — 本仓库依据索引

面向 Agent 的 **Harness**（非 *hardness*）：模型之外的约束、反馈与可机读制品，使 Coding / 仓库 Agent 可靠工作。

## 英文一手与权威解读（链接稳定）

| 来源 | 说明 |
|------|------|
| [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/) | Codex / agent-first 环境与反馈循环 |
| [Martin Fowler — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) | Guides + sensors、可.harness 的代码库 |
| [Martin Fowler — Harness Engineering memo](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html) | Context / Architecture / GC 三分类与 OpenAI 对照 |

## 中文系统综述

团队内部整理的 Harness 综述（多源交叉：OpenAI、Anthropic、Stripe、Fowler 等）见对话/知识库中的知乎长文；原专栏 URL 在自动化请求下常返回 **403**，**不以爬虫抓取为依赖**。

## 与本仓库落地文档的对应

| Harness 主题 | Zhin 文档 |
|--------------|-----------|
| Tier1 常驻上下文 | [AGENTS.md](../../AGENTS.md) |
| IM / 队列 / 出站不变量 | [im-queue-outbound-invariants.md](./im-queue-outbound-invariants.md) |
| Prompt 分段与 debug 形状 | [agent-context-blocks.md](./agent-context-blocks.md) |
| IM `SendOptions` ↔ 队列事件字段 | [queue-im-field-contract.md](./queue-im-field-contract.md) |
