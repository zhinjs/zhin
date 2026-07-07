# ADR 0025：Adapter 驱动的 AI 结构化出站 JSON

## 状态

Accepted

## 背景

- 协作群（ADR 0023）需要 AI 输出 `@` peer 时生成**平台可识别的 at segment**，而非正文假 `@researcher`。
- 各 IM 平台出站能力不同（OneBot keyboard、QQ markdown、Discord embed 等），Rich Segment 已有 adapter policy，但缺少 **AI 侧 JSON 契约**。
- 模型 JSON 遵从率不稳定，需 parser fallback。

## 决策

### D1. 双层 DSL（hybrid）

| 层 | 内容 |
|----|------|
| Core `ZhinAiOutboundPayload` | `text` / `mentions` / `segments` / `extensions` — 平台无关 |
| Adapter `extensions` | 对齐各 SDK 文档子集（如 `onebot.keyboard`、`qq.markdown`） |

`segments` 数组元素与 IM **`Segment[]` 同形**（`{ type, data, platform? }`），见 [Segment 内容模型 SSOT](../architecture/segment-content-model.md)。**废弃** `{ kind, mode, data }` DSL。

**禁止**让 AI 直接输出平台原生 segment 数组；Adapter 负责 `extensions` → `MessageElement[]`。

### D2. structured_only 生效范围

仅在以下场景注入 schema 并尝试 JSON 解析：

- 协作 Cell 活跃
- 入站含 handoff / `@` 意图
- 工具参数要求结构化出站
- Adapter 声明非空 `aiOutboundExtensions`

普通闲聊仍纯文本，零改动。

### D3. 解析 fallback 链（协作 Cell）

1. JSON parse → `mentions` → at segment（主路径）
2. JSON 失败 → 正文假 `@role` / `@endpointId` 兜底重写
3. 仍失败 → 纯文本 + `stage: ai_outbound` warn

### D4. Adapter 静态契约

仿 `outboundRichSegmentPolicy`：

- `Adapter.aiOutboundCapabilities`
- `Adapter.aiOutboundExtensions`

CI：`pnpm check:ai-outbound` 校验声明 extensions 的 adapter 含契约测试。

## 实现位置

- Core：`packages/im/core/src/built/ai-outbound/`
- Agent：`packages/im/agent/src/collaboration/structured-ai-outbound.ts`
- 协作迁移：[`collaboration-outbound.ts`](../../packages/im/agent/src/collaboration/collaboration-outbound.ts) 委托 core DSL

## 相关 ADR

- [0023 — GroupCell 多 Endpoint 协作](./0023-group-cell-multi-endpoint-agents.md)
- [0024 — Five-Agent Pipeline](./0024-five-agent-aop-pipeline.md)
