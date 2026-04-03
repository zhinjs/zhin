# Claude Code 架构速查（Zhin 优化参考）

## 三级压缩常量

```typescript
// Auto-Compact 阈值
AUTOCOMPACT_BUFFER_TOKENS = 13_000        // 触发余量
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000  // UI 警告
MAX_CONSECUTIVE_FAILURES = 3              // 熔断阈值

// 压缩后恢复预算
POST_COMPACT_TOKEN_BUDGET = 50_000        // 总恢复预算
POST_COMPACT_MAX_FILES = 5               // 最多恢复文件数
POST_COMPACT_MAX_PER_FILE = 5_000        // 单文件上限
POST_COMPACT_MAX_PER_SKILL = 5_000       // 单技能上限
POST_COMPACT_SKILLS_BUDGET = 25_000      // 技能总预算

// Micro-Compact
COMPACTABLE_TOOLS = Set(['file_read', 'bash', 'grep', 'glob', 'web_search', 'web_fetch', 'file_edit', 'file_write'])
IMAGE_MAX_TOKEN_SIZE = 2_000

// Session Memory
SESSION_MEMORY_MIN_TOKENS = 10_000
SESSION_MEMORY_MAX_TOKENS = 40_000
SESSION_MEMORY_MIN_TEXT_BLOCKS = 5
```

## 成本追踪模型

```typescript
type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number    // Prompt cache 创建
  cacheReadInputTokens: number        // Prompt cache 命中
  totalCostUSD: number
  contextWindow: number
  maxOutputTokens: number
}

// 定价：input × inputRate + output × outputRate + cacheCreate × inputRate + cacheRead × inputRate × 0.1
```

## 工具搜索模式

```typescript
// 快速路径：select:ToolName → 直接匹配
// 慢速路径：keyword → 评分排序 → top-N

// MCP 工具名解析：mcp__server__action → ['server', 'action']
// 普通工具名：CamelCase → ['camel', 'case']

// Memoize + 版本失效
const memoized = memoize(getDesc, keyFn)
function invalidate(tools) {
  if (hash(tools) !== cachedHash) { memoized.cache.clear() }
}
```

## 文件状态缓存

```typescript
class FileStateCache {
  // LRU: max 100 entries, 25MB 字节上限
  // Key: path.normalize(filePath)
  // Value: { content, timestamp, isPartialView? }
  // isPartialView = true → 必须 re-read 才能 write
}
```

## 权限规则累积

```
源: user > project > local > flag > policy > cli > command > session
行为: deny > allow > ask
决策: 先检查 deny 规则 → 再检查 allow 规则 → 默认 ask
拒绝追踪: HARD_LIMIT=10, SOFT_LIMIT=5, TIME_WINDOW=60s
```

## System Prompt 三段式

```
Final = [
  customSystemPrompt || defaultSystemPrompt,
  ...extras,
  appendSystemPrompt
]

// Branded type 防止裸 string[] 赋值
type SystemPrompt = readonly string[] & { __brand: 'SystemPrompt' }
```

## Compaction 压缩提示模板结构

```
<analysis>
  1. 主要请求和意图
  2. 关键技术概念
  3. 文件和代码段
  4. 错误和修复
  5. 问题解决过程
  6. 所有用户消息（逐字引用）
  7. 待处理任务
  8. 当前工作
  9. 下一步（附逐字引用）
</analysis>
```

## 源码路径映射

| 领域 | Claude Code 路径 |
|------|-----------------|
| 三级压缩 | `vendor/claude-code/src/services/compact/` |
| 成本追踪 | `vendor/claude-code/src/cost-tracker.ts` |
| 工具搜索 | `vendor/claude-code/src/tools/ToolSearchTool/` |
| 文件缓存 | `vendor/claude-code/src/utils/fileStateCache.ts` |
| 权限系统 | `vendor/claude-code/src/utils/permissions/` |
| Prompt 组装 | `vendor/claude-code/src/utils/queryContext.ts` |
| Query 管线 | `vendor/claude-code/src/QueryEngine.ts` |
| 技能发现 | `vendor/claude-code/src/skills/loadSkillsDir.ts` |
