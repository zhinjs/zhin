---
sidebar: false
---

# ADR 0017: RAG v0 — 本地知识库检索

## 状态

已实现（2026-06-13）· PR #506

## 背景

生活助手场景需要检索本地文档（FAQ、说明书、菜谱、规章制度）。用户不想每次都把整个文件粘贴到对话中，需要 Agent 自动按需检索。

**与 semantic memory 的区别**：semantic memory 存储碎片事实（用户偏好、历史事件），knowledge 存储结构化文档（Markdown/PDF 目录）。两者互补，不互相替代。

**产品定位**：RAG 是 Advanced 能力，服务聊天/生活助手场景。明确不做：plan mode、代码库索引、coding-agent 式 repo RAG。

## 决策

### D1 — 工具名：`knowledge_search`

使用 `knowledge_search` 作为工具名（而非 `rag_search` 或 `document_search`），强调「知识检索」语义。

### D2 — 纯本地文件目录，无外部依赖

知识库目录通过 `ai.knowledge.baseDir` 配置（默认 `knowledge`），相对于项目根目录。支持 `.md` 和 `.txt` 文件。

不做向量数据库、不做嵌入模型、不做远程知识源。v0 目标是「够用且零配置」。

### D3 — 段落级分块 + 关键词匹配

分块策略：
- 按双换行（`\n\n`）拆分段落
- 超过 `maxChunkSize`（默认 1000 字符）的段落按单换行继续拆分
- 超长单行按字符强制拆分
- 每个 chunk 附带源文件路径

搜索策略：
- 关键词匹配（`String.includes`），不使用 TF-IDF 或 BM25
- 按匹配数排序，返回 top-K（默认 5）
- 支持 `file` 参数过滤特定文件

选择关键词匹配而非向量搜索的理由：
1. 零外部依赖（不需要 embedding 模型）
2. 对中文短文档足够有效
3. 启动即用，无需索引构建步骤

### D4 — 启动时懒索引 + TTL 缓存

- 首次 `knowledge_search` 调用时扫描目录并分块索引
- 索引带 60 秒 TTL 缓存，新增/修改文件下次查询时自动发现
- 缓存条件：`cacheTime > 0 && (now - cacheTime) < cacheTtl`（空目录也走缓存）

### D5 — 与 semantic memory 并行（非合并）

| 维度 | knowledge_search | semantic memory |
|------|-----------------|-----------------|
| 存储 | 文件系统（原始 Markdown） | 数据库 `memory_entries` 表 |
| 检索 | 关键词匹配 | 向量相似度（未来） |
| 写入 | 编辑文件 | `memory_upsert` 工具 |
| 更新 | 文件修改后下次查询自动发现 | 实时 |
| 适用 | 结构化文档 | 碎片事实 |

v0 不做两者合并。未来可考虑：knowledge 文件变更时自动写入 semantic memory。

### D6 — 配置契约

```yaml
ai:
  knowledge:
    baseDir: knowledge    # 相对于项目根目录，默认 "knowledge"
```

最小配置，无其他参数。分块大小、缓存 TTL 等内部参数不暴露到配置层。

### D7 — 不做的事项

| 不做 | 原因 |
|------|------|
| 向量搜索 / 嵌入模型 | v0 目标是零依赖、零配置 |
| PDF 解析 | 增加依赖复杂度，v0 仅支持文本 |
| Console 知识库管理 UI | v0 仅文件系统，v1 考虑 Console 上传 |
| 代码库索引 | 不在产品边界内（coding-agent 场景） |
| 远程知识源（URL、API） | v0 仅本地文件 |
| chunk 大小/重叠可配置 | 内部参数，无需暴露 |

## 参考

- [ADR 0015 D6 产品边界](/adr/0015-capability-tier-model)
- [capability-tiers RAG 状态](/essentials/capability-tiers#rag--知识库)
- [配置文档 / 本地知识库](/essentials/configuration#本地知识库-knowledge-search-工具)
- 实现：`packages/im/agent/src/builtin/knowledge-search-tool.ts`
