# Zhin vs Claude Code 差距分析

## P0: 三级压缩

### 现状
- `packages/ai/src/compaction.ts`: 单遍 adaptive chunk + LLM summarize + merge
- 参数：BASE_CHUNK_RATIO=40%, MIN_CHUNK_RATIO=15%, SAFETY_MARGIN=20%
- 优点：逐块压缩 + 合并，有自适应分块
- 缺点：无增量清理（每次全量重压缩），无恢复机制，无后台记忆提取

### 差距
1. **缺 Micro-Compact**：tool_result 不会被单独清理，全部进入主压缩
2. **缺恢复机制**：压缩后不重注入高价值文件/技能
3. **缺 Session Memory**：跨会话无法延续上下文
4. **缺熔断器**：连续压缩失败无保护

### 实施文件
- 新建：`packages/ai/src/micro-compact.ts`
- 修改：`packages/ai/src/compaction.ts`（加恢复 + 熔断）
- 新建：`packages/ai/src/session-memory-compact.ts`

---

## P0: 成本追踪

### 现状
- Provider 的 `chat()`/`stream()` 返回 `AIStreamEvent`，无 usage 字段
- ZhinAgent 无任何成本计量
- 无法回答"这次对话花了多少钱"

### 差距
1. **Provider 不返回 usage**：OpenAI/Anthropic SDK 都提供 usage，但 Zhin 未提取
2. **无中心化 cost store**：无处累计成本
3. **无会话级持久化**：关闭后成本信息丢失

### 实施文件
- 修改：`packages/ai/src/providers/*.ts`（提取 usage）
- 新建：`packages/ai/src/cost-tracker.ts`
- 修改：`packages/agent/src/zhin-agent/index.ts`（每次调用后 addUsage）

---

## P1: 工具搜索缓存

### 现状
- `packages/agent/src/zhin-agent/` 每次请求都重新执行 keyword 匹配
- `packages/core/src/built/tool.ts` ToolFeature 有 `byName` Map 索引，但无描述缓存
- TF-IDF 关键词匹配是纯计算型，有优化空间

### 差距
1. **无 Memoize**：工具描述/匹配结果不缓存
2. **无版本失效**：工具集变化时无法精准失效
3. **无直接选择快速路径**：不支持 `select:ToolName` 模式

### 实施文件
- 修改：`packages/core/src/built/tool.ts`（加描述缓存 + 版本号）
- 修改：`packages/agent/src/zhin-agent/`（加匹配结果缓存）

---

## P1: 文件状态缓存

### 现状
- `builtin-tools.ts` 的 `read_file` 每次都从磁盘读取
- 无路径归一化（同一文件不同路径可能重复读取）

### 差距
1. **无 LRU 缓存**：重复读同一文件浪费 I/O
2. **无路径归一化**：`./foo/../bar` 和 `./bar` 不会命中同一缓存
3. **无 isPartialView 标记**：自动注入的部分内容可能被写回

### 实施文件
- 新建：`packages/ai/src/file-state-cache.ts`
- 修改：`packages/agent/src/builtin-tools.ts`（read_file/write_file 集成缓存）

---

## P2: 类型安全 Prompt

### 现状
- ZhinAgent 硬编码 system prompt 字符串
- 不同模型的 prompt 通过 if/else 分支切换
- 无类型保护防止裸字符串误赋值

### 差距
1. **无 Branded Type**：SystemPrompt 与 string 不可区分
2. **无三段组装**：default + user context + system context 混在一起
3. **无 custom/append 支持**：用户无法干预 prompt 内容

### 实施文件
- 新建：`packages/ai/src/system-prompt.ts`
- 修改：`packages/agent/src/zhin-agent/`（重构 prompt 构建）

---

## P2: 权限审计

### 现状
- `packages/core/src/built/tool.ts` 有 5 级权限层级 + `canAccessTool()`
- 拒绝时仅返回 false，无日志
- 无审计追踪

### 差距
1. **无审计日志**：决策不可追溯
2. **无拒绝频率追踪**：无法检测异常行为
3. **无多源规则**：规则来源单一（代码定义）

### 实施文件
- 修改：`packages/core/src/built/tool.ts`（加审计记录）
