# miniclawd 对照与可借鉴点

本文对照 [miniclawd](https://github.com/nicksanders/miniclawd)（路径：`/Users/liuchunlang/miniclawd`）在**记忆、工具错误处理、可观测性、调度与子任务**上的做法，给出 zhin 可借鉴的改进方向。

---

## 1. 记忆与上下文（Memory）

### miniclawd 的做法

- **存储**：工作区下 `memory/` 目录
  - **长期记忆**：`memory/MEMORY.md`（单文件，AI 可读可写）
  - **每日笔记**：`memory/YYYY-MM-DD.md`（按日期，支持 `appendToday`）
- **接口**：`MemoryStore`
  - `readLongTerm()` / `writeLongTerm(content)`
  - `readToday()` / `appendToday(content)`
  - `getRecentMemories(days)`：最近 N 天的每日笔记内容
  - `getMemoryContext()`：拼成一段给模型的字符串
- **注入时机**：在 `ContextBuilder.buildSystemPrompt()` 里，把 `getMemoryContext()` 的结果以固定段落注入系统提示：
  - 格式：`# Memory\n\n## Long-term Memory\n{MEMORY.md}\n\n## Today's Notes\n{YYYY-MM-DD.md}`
  - 并在 Identity 里写明：「When remembering something, write to {workspace}/memory/MEMORY.md」

这样模型既能看到「长期记忆 + 今天笔记」，又知道该往哪里写。

### zhin 现状与可借鉴点

- zhin 已有**会话记忆**（ConversationMemory、可选 DB）和 **read_memory / write_memory**（当前指向 AGENTS.md 等）。
- **可借鉴**：
  1. **增加文件制长期记忆**：在数据目录或工作区下增加 `memory/MEMORY.md` + `memory/YYYY-MM-DD.md`，与 miniclawd 一致。
  2. **统一注入**：在 `buildRichSystemPrompt()` 中增加可选「Memory」段：若存在 `memory/MEMORY.md` 或当日笔记，则读取并拼成「Long-term / Today's Notes」注入，并在 SOUL/AGENTS 中说明「重要事项请写入 memory/MEMORY.md」。
  3. **read_memory / write_memory**：可扩展为同时支持「AGENTS 相关记忆」与「memory/MEMORY.md」；或保留现有语义，另增「长期记忆」路径，由引导文案说明用途。

---

## 2. 工具错误处理（Tool error handling）

### miniclawd 的做法

- **文件工具**（`src/tools/fs.ts`）返回**结构化、可操作的错误文案**，便于模型区分并重试：
  - `read_file`：`Error: File not found: ${path}` / `Error: Not a file: ${path}` / `Error: Permission denied: ${path}`
  - `write_file`：`Error: Permission denied: ${path}`，成功则 `Successfully wrote N bytes to ${path}`
  - `edit_file`：
    - `Error: File not found: ${path}`
    - `Error: old_text not found in file. Make sure it matches exactly.`
    - `Warning: old_text appears ${count} times. Please provide more context to make it unique.`
    - `Error: Permission denied: ${path}`
  - `list_dir`：`Error: Directory not found` / `Error: Not a directory` / `Error: Permission denied`
- **工具注册表**（`registry.ts`）：执行失败时 `logger.error({ error, tool, params }, "Error executing tool")`，再向模型返回 `Error executing ${name}: ${error}`，保证日志有上下文、模型看到简短错误信息。

### zhin 现状与可借鉴点

- zhin 的 `read_file` / `write_file` / `edit_file` 已有部分区分（如 edit 的 old_string 未找到/多次匹配），但 **read_file / write_file** 仍多为通用 `Error: ${e.message}`。
- **可借鉴**：
  1. **read_file**：对 `ENOENT` → `Error: File not found: ${path}`；非文件 → `Error: Not a file: ${path}`；`EACCES` → `Error: Permission denied: ${path}`；其余再 fallback 到 `Error reading file: ${e.message}`。
  2. **write_file**：同样区分 `EACCES` 等，成功时保留类似「Wrote N bytes to path」的明确反馈。
  3. **edit_file**：已较好，可保持并统一前缀为 `Error:` / `Warning:`，便于模型解析。
  4. **list_dir**：若尚未区分「目录不存在 / 非目录 / 权限」，可补上与 miniclawd 一致的三种错误文案。
  5. 所有内置工具执行处：在 catch 里用 logger 记录 `{ tool, params, err }`，再返回上述结构化字符串，便于排查且不向模型泄露堆栈。

---

## 3. 可观测与调试（Observability）

### miniclawd 的做法

- **统一 logger**：`pino` + 开发环境 `pino-pretty`，`LOG_LEVEL` 控制级别（默认 dev=debug、prod=info）。
- **关键节点打点**：
  - 调度：任务开始 / 完成 / 失败（带 jobId、name、error）；Heartbeat 无任务时 debug。
  - 工具：执行时 `logger.debug({ tool, args }, "Executing tool")`；registry 捕获到异常时 `logger.error({ error, tool, params }, "Error executing tool")`。
  - 子 agent：spawn、开始任务、完成、失败（带 taskId、label、error）。
  - 主循环：处理消息、系统消息等用 `logger.info`。
- 无单独 trace 格式，但**结构化字段**（jobId、tool、taskId、error）便于用日志系统过滤和排错。

### zhin 现状与可借鉴点

- zhin 使用 `@zhin.js/logger`，调度器、技能加载等已有部分日志。
- **可借鉴**：
  1. 在**工具执行入口**统一打点：执行前 `logger.debug({ tool: name, params })`，失败时 `logger.error({ tool: name, params, err })`，与 miniclawd 的 registry 行为一致。
  2. **调度**：确认每次 job 执行（开始/成功/失败/跳过）都有带 jobId、name、lastStatus、lastError 的日志，便于和 `scheduler list` 对照。
  3. 若需要「按会话/请求追踪」：可为每次 agent 调用生成 requestId/sessionId，在相关日志里带上该 id，便于后续做简单 trace 导出（如按会话导出为 JSON）。

---

## 4. 调度与任务状态（Scheduler）

### miniclawd 的做法

- **JobState**：`nextRunAtMs`、`lastRunAtMs`、`lastStatus`（`ok` | `error` | `skipped`）、`lastError`。
- 执行后更新状态并持久化；CLI 列出任务时可展示上次结果；失败时保留 `lastError` 便于排查。

### zhin 现状

- zhin 的 `JobState` 与持久化已包含 `lastRunAtMs`、`lastStatus`、`lastError`，行为与 miniclawd 对齐。
- **可选**：CLI `cron list` 或 status 时增加一列「上次状态 / 上次错误摘要」，便于用户一眼看到任务是否常败。

---

## 5. 子任务 / 后台 Agent（Subagent）

### miniclawd 的做法

- **spawn 工具**：用户或主 agent 调用 `spawn({ task, label?, originChannel, originChatId })`，返回「子任务已启动，完成后会通知」。
- **SubagentManager**：
  - 为每次 spawn 创建独立上下文：专用 system prompt + 仅带部分工具（read_file, write_file, list_dir, exec, web_search, web_fetch）的 ToolRegistry。
  - 在独立循环中跑子 agent（maxIterations=15），不阻塞主对话。
  - 完成后通过 MessageBus 向主 channel 投递结果（或失败信息），实现「后台跑完再通知」。

适用于：耗时任务、多步检索+写作、需要单独上下文的子目标。

### zhin 现状与可借鉴点

- zhin 当前没有「spawn 子 agent 后台执行并回告」的通用能力。
- **可借鉴**（中长期）：
  1. 新增 **spawn** 类工具：接收任务描述 + 可选 label，在后台启动一次性的「轻量 agent 运行」（复用现有 ZhinAgent 或简化版 loop），工具集可限制为文件/执行/网络等，不暴露敏感或重工具。
  2. 完成后通过现有会话/频道机制回写一条消息（如「[后台任务] label: 结果摘要或错误」），主会话可继续对话而不被长任务阻塞。
  3. 实现时可参考 miniclawd 的 `SubagentManager` + `SpawnTool` 的职责划分：Tool 只负责参数与调用 manager；manager 负责创建上下文、运行循环、上报结果。

---

## 6. 小结表

| 能力           | miniclawd 做法                         | zhin 可借鉴点 |
|----------------|----------------------------------------|----------------|
| 长期记忆       | memory/MEMORY.md + 每日 YYYY-MM-DD.md | 增加 memory/ 目录与 MEMORY.md/每日笔记，并在 system prompt 中注入 Memory 段 |
| 工具错误       | 结构化 Error/Warning 文案 + 错误类型   | read_file/write_file/list_dir 区分 ENOENT/EACCES/非文件/非目录；工具执行处统一 logger |
| 可观测         | pino + 关键节点结构化日志              | 工具执行前后/失败打点；调度 job 状态在 list 或 status 中可见 |
| 调度状态       | JobState.lastStatus / lastError 持久化 | 已有，可选：CLI 展示上次状态与错误摘要 |
| 后台子任务     | spawn + SubagentManager + MessageBus   | 中长期：新增 spawn 类工具 + 轻量后台 agent + 结果回告 |

按上述顺序实现：先补**记忆文件 + 注入**和**工具错误结构化**，再加强**日志与可观测**，最后再考虑 **spawn 子 agent**，可以逐步缩小与 miniclawd 的差距并保持 zhin 自身架构一致。
