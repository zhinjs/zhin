# @zhin.js/plugin-sensitive-filter

敏感词过滤插件，用于过滤不符合中国国情的敏感内容。

## 功能特性

- ✅ **多类别敏感词库**：政治、暴力、色情、违禁品、诈骗、违法违规等多个类别
- ✅ **智能过滤**：自动检测并替换敏感词为 `*` 字符
- ✅ **拦截模式**：可选择直接拦截包含敏感词的消息
- ✅ **日志记录**：自动记录检测到的敏感词和过滤结果
- ✅ **自定义词库**：支持添加自定义敏感词
- ✅ **灵活配置**：可按类别启用/禁用敏感词过滤

## 安装

```bash
pnpm add @zhin.js/plugin-sensitive-filter
```

## 使用方法

### 基础使用

在配置文件中启用插件：

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: [
    'database',  // 敏感词过滤插件依赖数据库
    'sensitive-filter'
  ]
})
```

### 配置选项

插件支持以下配置选项：

```typescript
interface SensitiveFilterOptions {
  /** 是否启用政治敏感词过滤（默认: true） */
  political?: boolean
  
  /** 是否启用暴力恐怖词汇过滤（默认: true） */
  violence?: boolean
  
  /** 是否启用色情低俗词汇过滤（默认: true） */
  porn?: boolean
  
  /** 是否启用违禁品词汇过滤（默认: true） */
  prohibited?: boolean
  
  /** 是否启用诈骗相关词汇过滤（默认: true） */
  fraud?: boolean
  
  /** 是否启用其他违法违规词汇过滤（默认: true） */
  illegal?: boolean
  
  /** 自定义敏感词列表 */
  custom?: string[]
  
  /** 替换字符（默认: "*"） */
  replacement?: string
  
  /** 是否直接拦截包含敏感词的消息（默认: false） */
  block?: boolean
}
```

### 自定义配置

修改 `src/index.ts` 中的配置：

```typescript
const config: SensitiveFilterOptions = {
  political: true,
  violence: true,
  porn: true,
  prohibited: false,  // 禁用违禁品词汇过滤
  fraud: true,
  illegal: true,
  custom: ['自定义敏感词1', '自定义敏感词2'],
  replacement: "█",  // 使用不同的替换字符
  block: true,  // 直接拦截包含敏感词的消息
}
```

## 工作原理

### 过滤流程

1. **拦截发送消息**：使用 `plugin.beforeSend()` 钩子拦截所有即将发送的消息
2. **敏感词检测**：使用正则表达式匹配敏感词
3. **内容过滤**：
   - **替换模式**（默认）：将敏感词替换为 `*` 字符
   - **拦截模式**：直接拦截消息并返回警告
4. **日志记录**：将检测结果保存到数据库

### 示例效果

**替换模式**：
```
输入: "这是一条包含敏感词的消息"
输出: "这是一条包含***的消息"
```

**拦截模式**：
```
输入: "这是一条包含敏感词的消息"
输出: "⚠️ 消息包含敏感词，已被拦截。检测到: 敏感词"
```

## 敏感词分类

插件包含以下敏感词分类：

### 1. 政治敏感词
涉及政治敏感话题的词汇，如：法轮功、达赖、台独、藏独等

### 2. 暴力恐怖词汇
涉及暴力、恐怖主义的词汇，如：恐怖主义、爆炸、炸弹等

### 3. 色情低俗词汇
涉及色情、低俗内容的词汇，如：色情、淫秽、裸体等

### 4. 违禁品词汇
涉及毒品、赌博、枪支等违禁品的词汇

### 5. 诈骗相关词汇
涉及网络诈骗、传销等欺诈行为的词汇

### 6. 其他违法违规词汇
涉及翻墙、假证、作弊等违法违规行为的词汇

## 数据库表结构

插件会自动创建 `sensitive_logs` 表记录过滤日志：

```typescript
{
  id: number              // 自增主键
  content: string         // 原始内容
  filtered_content: string  // 过滤后内容
  detected_words: string[]  // 检测到的敏感词列表
  user_id: string         // 用户ID
  adapter: string         // 适配器名称
  bot: string            // 机器人名称
  timestamp: Date        // 时间戳
}
```

## 注意事项

1. **依赖数据库**：本插件需要数据库支持来记录日志，请确保已启用 `database` 插件
2. **性能考虑**：敏感词库较大时可能影响性能，建议按需启用分类
3. **误判问题**：简单的关键词匹配可能存在误判，建议根据实际情况调整词库
4. **合规使用**：请根据当地法律法规和平台规则合理使用本插件

## 最佳实践

### 1. 按场景启用分类

```typescript
// 公开群聊：启用所有过滤
const publicGroupConfig = {
  political: true,
  violence: true,
  porn: true,
  prohibited: true,
  fraud: true,
  illegal: true,
}

// 私聊：只启用必要过滤
const privateConfig = {
  political: false,
  violence: false,
  porn: true,
  prohibited: true,
  fraud: true,
  illegal: false,
}
```

### 2. 自定义词库管理

```typescript
// 添加行业特定敏感词
const config = {
  custom: [
    '公司机密信息',
    '内部文档',
    '未公开产品',
  ]
}
```

### 3. 日志分析

定期查询日志分析敏感词趋势：

```typescript
import { useContext } from 'zhin.js'

useContext('database', async (db) => {
  const logs = db.model('sensitive_logs')
  
  // 查询最近检测到的敏感词
  const recent = await logs.select()
    .orderBy('timestamp', 'desc')
    .limit(10)
  
  console.log('最近检测到的敏感词:', recent)
})
```

## 开发

```bash
# 构建
pnpm build

# 开发模式
pnpm dev
```

## 许可证

MIT

---

**警告**：本插件仅用于内容过滤和安全防护，请遵守相关法律法规，不要用于非法用途。
