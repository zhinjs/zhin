---
"@zhin.js/agent": patch
---

**识图与用量**：识图结果和调用完整可查，结构化用量真正写进数据库，入站媒体被拒说清原因（#1250）。

- 结构化用量表 `agent_usage_turns` / `agent_usage_calls` 之前从来没有写入：用量存储是 Root 私有资源，而 Agent 运行时从 generation 快照的资源表里取它，快照不含 Root 私有绑定，所以一直取不到、静默跳过。现在经 Root 资源解析读取；实例确实没有结构化用量存储（非 SQLite / MySQL / PostgreSQL）时，首个回合打一次 `[ai.usage] usage_store | status: unavailable` 警告。
- 识图预处理（`ai.multimodal.perception`）每次发到识图服务的请求都记为本回合的一次模型调用：进 trace 的 `model_calls`（标「识图」）、`[ai.usage]` 汇总与 `agent_usage_calls`，写实际作答的服务与模型；失败的请求按保守估算计入，缓存命中不算调用。
- trace 不再把 `media_resolution` 截成 120 个字符：新增 `media` 字段，逐项记录结局、原因码、识图服务 / 模型、是否缓存命中和注入的描述（最多 4000 字符，更长时标出已截断与原长度）；`zhin trace` 单列「入站媒体」。
- 已有识图描述时，能协作的回合在描述后附一句框架说明，不要只为了「再看一眼」去问别的 Agent；确实 `ask` / `delegate` 给其他 Agent 时，对方模型能收图片 / 视频 / 文件就把用户的原始媒体一起交过去（受每回合识图上限约束），不再只给文字和链接。
- 入站 URL、base64 与平台引用媒体读不到时不再统一记 `media_validation_failed`：原因码为 `too_large`、`mime_mismatch`、`invalid_data`、`scheme_unsupported`、`host_not_allowed`、`fetch_failed`、`file_unreadable`、`unmaterialized_platform_reference`；`inbound_media_rejected` 日志带 `scene`、消息 id、`scheme`，URL 另带 `host`（不记路径、查询串和内联数据）。新增逐项结果的 `normalizeMediaRefs()`，`normalizeMediaRefsToPayloads()` 行为不变。
