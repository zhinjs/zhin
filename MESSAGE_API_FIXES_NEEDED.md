# Message API 修复清单

## 🔍 问题说明

文档中大量使用了旧的 Message API（不带 `$` 前缀），需要全部更新为新的 API（带 `$` 前缀）。

## ✅ 正确的 Message API

根据 `packages/core/src/message.ts` 的定义，Message 接口应该使用：

```typescript
export interface MessageBase {
    $id: string;              // ✅ 使用 $id
    $adapter: string;         // ✅ 使用 $adapter
    $bot: string;             // ✅ 使用 $bot
    $content: MessageElement[]; // ✅ 使用 $content
    $sender: MessageSender;   // ✅ 使用 $sender
    $reply(content:SendContent, quote?:boolean|string):Promise<string>; // ✅ 使用 $reply
    $channel: MessageChannel; // ✅ 使用 $channel
    $timestamp: number;       // ✅ 使用 $timestamp
    $raw: string;             // ✅ 使用 $raw
}
```

## ❌ 错误用法 → ✅ 正确用法

| 错误 | 正确 |
|------|------|
| `message.raw` | `message.$raw` |
| `message.sender` | `message.$sender` |
| `message.reply()` | `message.$reply()` |
| `message.content` | `message.$content` |
| `message.channel` | `message.$channel` |
| `message.adapter` | `message.$adapter` |
| `message.bot` | `message.$bot` |
| `message.timestamp` | `message.$timestamp` |
| `message.id` | `message.$id` |

## 📊 需要修复的文档

根据 grep 结果，以下文档包含错误的 Message API 用法：

### 高优先级（guide 目录）

- ✅ **docs/guide/quick-start.md** - 已修复
- ✅ **docs/guide/getting-started.md** - 已修复
- ✅ **docs/guide/concepts.md** - 已修复
- ❌ **docs/guide/best-practices.md** - 待修复（10处）
- ❌ **docs/guide/architecture.md** - 待修复（1处）

### 中优先级（official 和 plugin 目录）

- ⚠️ **docs/official/adapters.md** - 部分修复（还有11处）
- ❌ **docs/plugin/middleware.md** - 待修复（23处）
- ❌ **docs/plugin/lifecycle.md** - 待修复（3处）
- ❌ **docs/plugin/index.md** - 待修复（7处）
- ❌ **docs/plugin/development.md** - 待修复（3处）

### 低优先级（examples 和 api 目录）

- ❌ **docs/examples/real-world.md** - 待修复（15处）
- ❌ **docs/examples/index.md** - 待修复（22处）
- ❌ **docs/examples/basic-usage.md** - 待修复（14处）
- ❌ **docs/examples/advanced-usage.md** - 待修复（8处）
- ❌ **docs/api/types.md** - 待修复（3处）
- ❌ **docs/api/plugin.md** - 待修复（6处）
- ❌ **docs/api/index.md** - 待修复（6处）
- ❌ **docs/api/events.md** - 待修复（21处）
- ❌ **docs/api/core.md** - 待修复（2处）
- ❌ **docs/adapter/message-handling.md** - 待修复（5处）
- ❌ **docs/adapter/event-handling.md** - 待修复（6处）

## 🔧 批量修复策略

### 方法 1：使用 sed/perl 批量替换

```bash
# 替换 message.raw -> message.$raw
find docs -name "*.md" -type f -exec sed -i '' 's/message\.raw\b/message.$raw/g' {} +

# 替换 message.sender -> message.$sender
find docs -name "*.md" -type f -exec sed -i '' 's/message\.sender\b/message.$sender/g' {} +

# 替换 message.reply( -> message.$reply(
find docs -name "*.md" -type f -exec sed -i '' 's/message\.reply(/message.$reply(/g' {} +

# 替换 message.content -> message.$content
find docs -name "*.md" -type f -exec sed -i '' 's/message\.content\b/message.$content/g' {} +

# 替换 message.channel -> message.$channel
find docs -name "*.md" -type f -exec sed -i '' 's/message\.channel\b/message.$channel/g' {} +

# 替换 message.adapter -> message.$adapter
find docs -name "*.md" -type f -exec sed -i '' 's/message\.adapter\b/message.$adapter/g' {} +

# 替换 message.bot -> message.$bot
find docs -name "*.md" -type f -exec sed -i '' 's/message\.bot\b/message.$bot/g' {} +

# 替换 message.timestamp -> message.$timestamp
find docs -name "*.md" -type f -exec sed -i '' 's/message\.timestamp\b/message.$timestamp/g' {} +

# 替换 message.id -> message.$id
find docs -name "*.md" -type f -exec sed -i '' 's/message\.id\b/message.$id/g' {} +
```

### 方法 2：逐个文件手动修复

按照优先级顺序，使用 search_replace 工具逐个修复。

## ⚠️ 注意事项

1. **避免误替换**：
   - 注意 `message.$reply()` 的括号
   - 注意 `message.adapter` 和 `message.$adapter` 的区别
   - 确保只替换代码块中的内容，不要替换文档说明

2. **验证修复**：
   - 每次修复后 grep 验证
   - 确保语法正确
   - 检查是否有遗漏

3. **特殊情况**：
   - `message.$content.some(...)` - 数组方法
   - `message.$channel.type` - 嵌套属性
   - `message.$sender.name` - 嵌套属性

## 📋 已修复文档

### ✅ 端口错误修复（已完成）

- docs/guide/quick-start.md
- docs/index.md
- docs/guide/getting-started.md
- docs/official/plugins.md
- docs/official/adapters.md
- docs/guide/configuration.md

### ✅ Message API 修复（部分完成）

- docs/guide/quick-start.md - `message.raw` → `message.$raw`
- docs/guide/getting-started.md - 多处修复
- docs/guide/concepts.md - `message.raw` → `message.$raw`
- docs/official/adapters.md - 部分修复

## 🎯 下一步行动

建议使用批量替换命令修复所有文档，然后逐个验证关键文档的正确性。

---

**创建时间：** 2025-01-14
**问题类型：** API 使用错误
**影响范围：** 所有涉及 Message 对象的文档
**严重程度：** 高（代码示例无法运行）

