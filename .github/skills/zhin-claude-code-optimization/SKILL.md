---
name: zhin-claude-code-optimization
description: 'Optimize Zhin.js AI agent system by applying architectural patterns learned from Claude Code source analysis. Use when asked to "optimize agent", "improve AI performance", "add cost tracking", "improve compaction", "add tool caching", "optimize memory", "learn from Claude Code", "improve prompt pipeline", "streaming tools", "concurrent execution", "security hardening", or "buildTool pattern". 基于 Claude Code 架构分析优化 Zhin.js AI 引擎。'
argument-hint: 'Describe the optimization area: compaction, memory, streaming, cost-tracking, tool-search, prompt-pipeline, permission-audit, file-cache, security, buildTool, or full-audit.'
user-invocable: true
---

# Zhin.js AI 引擎优化技能（基于 Claude Code 架构分析）

基于对 Claude Code 源码（`vendor/claude-code/src/`）的深度分析，系统化地将其经过验证的架构模式迁移到 Zhin.js AI 引擎中。

**适用前提**：`vendor/claude-code/` 子模块已存在，可直接参考源码。

## 架构层级概览（Claude Code 六层）

```
┌─────────────────────────────────────────────┐
│  CLI & TUI (main.tsx, React Ink, REPL)      │ ← 不在 Zhin 迁移范围
├─────────────────────────────────────────────┤
│  Agent 循环 (query.ts, AsyncGenerator)      │ ← 对应 ZhinAgent.runStream()
│  StreamingToolExecutor + 并发调度           │
├─────────────────────────────────────────────┤
│  工具系统 (42 内置 + MCP + buildTool())     │ ← 对应 ToolFeature + builtin-tools
├─────────────────────────────────────────────┤
│  记忆系统 (3 层 Agentic Search, 非 RAG)    │ ← Zhin 仅有 ConversationMemory
├─────────────────────────────────────────────┤
│  上下文压缩 (5 级管线 + 断路器 + 九段摘要) │ ← Zhin 仅有单遍压缩
├─────────────────────────────────────────────┤
│  权限 & 安全 (YOLO + Shadow AI + 反蒸馏)   │ ← Zhin 有层级权限但无 AI 审查
└─────────────────────────────────────────────┘
```

## 核心差距矩阵

| # | 优化领域 | Claude Code 模式 | Zhin.js 现状 | 优先级 | 收益 |
|---|----------|-----------------|-------------|--------|------|
| 1 | 五级压缩管线 | Snip → Micro → Collapse → Auto → Reactive | 单遍合并压缩 | P0 | 长对话 token 节省 40-60% |
| 2 | 九段式结构化摘要 | 分析模板 9 区域覆盖 | 通用 LLM summarize | P0 | 压缩后信息保留率 ↑ |
| 3 | 三层 Agentic 记忆 | 索引常驻 + 话题按需 + 历史搜索 | DB 存储 + topic 链 | P0 | 跨会话上下文延续 |
| 4 | 成本追踪 | 每调用 token+USD+cache 计量 | 完全缺失 | P0 | 计费可见性 |
| 5 | 流式工具执行器 | AsyncGenerator + 并发安全标记 | 串行同步逐工具 | P1 | 工具执行效率 ↑ |
| 6 | buildTool 工厂 | fail-closed 默认值 + 分类器输入 | 手动 addTool | P1 | 工具安全一致性 |
| 7 | 工具搜索缓存 | Memoize + 版本失效 | 每次重排 | P1 | 延迟降低 |
| 8 | 文件状态缓存 | LRU + 路径归一化 | 缺失 | P1 | 避免重复读文件 |
| 9 | 类型安全 Prompt | Branded type + 三段组装 | 硬编码字符串 | P2 | 可维护性 |
| 10 | YOLO 自动审批 | LLM 分类器 + classifierApprovable | 静态权限层级 | P2 | 用户体验 ↑ |
| 11 | 安全加固 | Shadow AI + 反蒸馏 + 拒绝断路器 | 基础权限检查 | P2 | 安全合规性 |
| 12 | 技能发现去重 | realpath + 身份哈希 | Set 判名 | P3 | 符号链接健壮性 |

## 优化流程

### 第 0 步：确定优化范围

询问用户要优化哪个领域，或执行全量审计：

| 范围 | 触发词 | 涉及文件 |
|------|--------|---------|
| 三级压缩 | "compaction", "压缩", "token" | `packages/ai/src/compaction.ts` |
| 成本追踪 | "cost", "成本", "token计费" | `packages/ai/src/providers/`, `packages/agent/` |
| 工具搜索 | "tool search", "工具缓存" | `packages/agent/src/zhin-agent/`, `packages/core/src/built/tool.ts` |
| 文件缓存 | "file cache", "文件缓存" | 新建 `packages/ai/src/file-state-cache.ts` |
| Prompt 管线 | "prompt", "系统提示词" | `packages/agent/src/zhin-agent/` |
| 权限审计 | "permission", "权限", "审计" | `packages/core/src/built/tool.ts` |
| 全量审计 | "全量", "full", "完整优化" | 以上全部 |

### 第 1 步：三级压缩体系（P0）

**目标**：将 Zhin 的单遍压缩改为三级递进策略，参考 Claude Code `services/compact/`。

**Claude Code 模式**：
```
TIER 1: Auto-Compact — token 超阈值时，分叉 agent 生成摘要（≤20K token）
                       恢复阶段重注入高价值文件/技能（≤50K token）
TIER 2: Micro-Compact — 仅清理旧 tool_result 内容，保留文本块
                        时间衰减策略，越老的 tool 结果越先清理
TIER 3: Session Memory — 后台子进程定期提取 key findings
                        持久化到 .md 文件，跨会话可用
```

**Zhin 实施步骤**：

1. **阅读现有压缩代码**：`packages/ai/src/compaction.ts`
   - 理解当前的 `adaptiveChunkAndCompact()` 实现
   - 记录当前参数：BASE_CHUNK_RATIO(40%), SAFETY_MARGIN(20%)

2. **新增 Micro-Compact 层**：在 `packages/ai/src/` 下新建 `micro-compact.ts`
   - 参考：`vendor/claude-code/src/services/compact/microCompact.ts`
   - 定义可压缩的 tool 类型集合（file_read, bash, grep, web_fetch 等）
   - 对超出时间窗口的 tool_result 替换为 `[旧工具结果已清理]`
   - 保留 user/assistant 文本块不动
   - 在主压缩前先执行 micro-compact，减少主压缩负担

3. **增强 Auto-Compact**：修改 `packages/ai/src/compaction.ts`
   - 参考：`vendor/claude-code/src/services/compact/autoCompact.ts`
   - 添加压缩后恢复机制：重注入最近修改的文件内容和活跃技能
   - 添加连续失败断路器（MAX_CONSECUTIVE_FAILURES = 3）
   - 添加压缩结果缓存，避免重复压缩相同片段

4. **新增 Session Memory 层**：在 `packages/ai/src/` 下新建 `session-memory-compact.ts`
   - 参考：`vendor/claude-code/src/services/compact/sessionMemoryCompact.ts`
   - 定期（每 N 次 tool 调用）后台提取关键发现
   - 持久化到数据库或文件（复用现有 `conversation-memory.ts` 表结构）
   - 下次会话恢复时自动注入

**关键常量（参考 Claude Code）**：
```typescript
// micro-compact
const COMPACTABLE_TOOLS = new Set(['file_read', 'bash', 'grep', 'web_fetch', 'web_search'])
const TIME_BASED_CLEARED_MESSAGE = '[旧工具结果已清理]'

// auto-compact
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const POST_COMPACT_TOKEN_BUDGET = 50_000
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// session-memory
const SESSION_MEMORY_MIN_TOKENS = 10_000
const SESSION_MEMORY_MAX_TOKENS = 40_000
```

### 第 2 步：成本追踪系统（P0）

**目标**：为每次 LLM 调用记录 token 用量和 USD 成本。

**Claude Code 模式**：
```typescript
// 中心化状态存储
type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalCostUSD: number
}
// 按模型名分别追踪
// 支持会话级持久化
```

**Zhin 实施步骤**：

1. **定义成本类型**：在 `packages/ai/src/types.ts` 中新增
   ```typescript
   export interface TokenUsage {
     inputTokens: number
     outputTokens: number
     totalTokens: number
     costUSD?: number
   }
   
   export interface ModelCostConfig {
     inputPricePerMToken: number   // USD per million tokens
     outputPricePerMToken: number
   }
   ```

2. **Provider 返回 usage**：修改 `BaseProvider.chat()` / `stream()` 返回值
   - 参考各 Provider SDK 的 usage 字段（OpenAI: `response.usage`, Anthropic: `response.usage`）
   - 在 `ProviderResponse` 中添加 `usage?: TokenUsage`

3. **新建 cost-tracker**：`packages/ai/src/cost-tracker.ts`
   - 参考：`vendor/claude-code/src/cost-tracker.ts`
   - 维护 `Map<string, ModelUsage>` 按模型分别追踪
   - 提供 `addUsage(model, usage)`, `getTotalCost()`, `getModelUsage()` API
   - 在 ZhinAgent 主循环中每次 LLM 调用后更新

4. **暴露成本接口**：在 `packages/agent/` 中
   - ZhinAgent 新增 `getCostSummary()` 方法
   - 通过事件触发 `agent:cost-update` 供 UI/日志消费

### 第 3 步：工具搜索缓存（P1）

**目标**：避免每次请求都重新排序/过滤工具列表。

**Claude Code 模式**：
```typescript
// memoize 工具描述查找
const getToolDescriptionMemoized = memoize(async (name, tools) => {
  return tool?.prompt({...})
}, (name) => name)

// 工具集变化时失效
function maybeInvalidateCache(tools) {
  const key = getDeferredToolsCacheKey(tools)
  if (cachedKey !== key) { memoized.cache.clear(); cachedKey = key }
}
```

**Zhin 实施步骤**：

1. **阅读现有工具过滤**：`packages/agent/src/zhin-agent/` 中的 keyword 匹配逻辑

2. **添加缓存层**：在 `packages/core/src/built/tool.ts` 的 ToolFeature 中
   - 新增 `#descriptionCache: Map<string, string>` 带版本号
   - `add()`/`remove()` 时递增版本号并清空缓存
   - `getDescription(name)` 先查缓存

3. **ZhinAgent 侧缓存**：在 agent 主循环中
   - 缓存上一轮的工具列表快照（名称集合的 hash）
   - 仅当 hash 变化时重新执行过滤/排序

### 第 4 步：文件状态缓存（P1）

**目标**：LRU 缓存最近读取的文件内容，避免重复 I/O。

**Claude Code 模式**：
```typescript
class FileStateCache {
  private cache: LRUCache<string, FileState>  // 路径归一化 + 大小驱逐
  constructor(maxEntries = 100, maxSizeBytes = 25 * 1024 * 1024)
}
```

**Zhin 实施步骤**：

1. **新建**：`packages/ai/src/file-state-cache.ts`
   - 参考：`vendor/claude-code/src/utils/fileStateCache.ts`
   - 使用 `Map` + 手动 LRU 逻辑（避免新依赖）或引入 `lru-cache`
   - 路径用 `path.resolve()` + `path.normalize()` 归一化
   - 按字节大小驱逐，上限 25MB

2. **集成到 builtin-tools**：`packages/agent/src/builtin-tools.ts`
   - `read_file` 工具先查缓存
   - `write_file` / `edit_file` 后更新缓存
   - Compaction 时可序列化缓存传递给子进程

### 第 5 步：类型安全 Prompt 管线（P2）

**目标**：将 system prompt 从硬编码字符串改为类型安全的组装管线。

**Claude Code 模式**：
```typescript
// Branded type
type SystemPrompt = readonly string[] & { readonly __brand: 'SystemPrompt' }
// 三段组装：defaultPrompt + userContext + systemContext
```

**Zhin 实施步骤**：

1. **定义 Prompt 类型**：在 `packages/ai/src/` 中
   ```typescript
   export type SystemPrompt = readonly string[] & { readonly __brand: 'SystemPrompt' }
   export function asSystemPrompt(parts: readonly string[]): SystemPrompt
   ```

2. **三段组装**：重构 ZhinAgent 的 prompt 构建
   - `defaultPrompt`: 基础人设 + 框架约束
   - `userContext`: 用户名、工作目录、当前时间
   - `activeContext`: 激活的技能指令、bootstrap 文件

3. **支持 customPrompt/appendPrompt**：
   - `customPrompt` 替换整个 defaultPrompt
   - `appendPrompt` 追加到末尾（不影响缓存 key）

### 第 6 步：权限审计日志（P2）

**目标**：记录每次工具调用的权限决策，支持事后审计。

**Zhin 实施步骤**：

1. **定义审计记录**：
   ```typescript
   interface ToolAuditEntry {
     timestamp: number
     toolName: string
     caller: { platform?: string; userId?: string; permissionLevel: string }
     decision: 'allow' | 'deny'
     reason: string
     args?: Record<string, unknown>  // 脱敏后
   }
   ```

2. **在 ToolFeature 中拦截**：`canAccessTool()` 决策后记录日志
   - 使用环形缓冲区（最近 1000 条），避免内存增长
   - 通过 logger 输出 DEBUG 级别日志
   - 提供 `getAuditLog()` API 供管理界面查询

### 第 7 步：技能发现去重优化（P3）

**Claude Code 模式**：使用 `realpath()` 解析符号链接，基于 inode 去重。

**Zhin 实施步骤**：

1. 在 `discoverWorkspaceSkills()` / `discoverWorkspaceTools()` 中：
   - 对每个发现的文件调用 `fs.realpathSync()` 获取真实路径
   - 使用真实路径而非原始路径做去重
   - 可防止 symlink / pnpm link 导致的重复注册

## 完成标准

每个优化领域完成后应满足：

- [ ] 有对应的单元测试验证核心逻辑
- [ ] 不引入新的 runtime 依赖（优先使用 Node.js 内建或已有依赖）
- [ ] 与现有 API 向后兼容（新增而非修改）
- [ ] 有简短的 JSDoc 注释说明设计意图和参考来源
- [ ] `pnpm test` 无新增失败

## 参考源码映射

| Zhin 目标文件 | Claude Code 参考 |
|--------------|-----------------|
| `packages/ai/src/micro-compact.ts` | `vendor/claude-code/src/services/compact/microCompact.ts` |
| `packages/ai/src/compaction.ts` | `vendor/claude-code/src/services/compact/autoCompact.ts` |
| `packages/ai/src/session-memory-compact.ts` | `vendor/claude-code/src/services/compact/sessionMemoryCompact.ts` |
| `packages/ai/src/cost-tracker.ts` | `vendor/claude-code/src/cost-tracker.ts` |
| `packages/ai/src/file-state-cache.ts` | `vendor/claude-code/src/utils/fileStateCache.ts` |
| `packages/core/src/built/tool.ts` | `vendor/claude-code/src/tools/ToolSearchTool/` |
| `packages/agent/src/zhin-agent/` | `vendor/claude-code/src/QueryEngine.ts` |
