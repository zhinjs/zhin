# 命令帮助系统增强完成 ✅

## 📋 更新概览

成功为 `MessageCommand` 添加了帮助系统，现在命令可以包含描述、用法和示例信息，并在控制台 Web 界面中展示。

## 🔧 实施细节

### 1. MessageCommand 类增强

在 `/Users/liuchunlang/IdeaProjects/zhin/packages/core/src/command.ts` 中添加了以下方法：

```typescript
export class MessageCommand<T extends keyof RegisteredAdapters = keyof RegisteredAdapters> {
    #callbacks: MessageCommand.Callback<T>[] = [];
    #desc: string[] = [];
    #usage: string[] = [];
    #examples: string[] = [];
    #permissions: string[] = [];
    #checkers: MessageCommand.Checker<T>[] = []
    
    get help() {
        return [
            this.pattern,
            ...this.#desc,
            ...this.#usage,
            ...this.#examples
        ].join("\n");
    }
    
    desc(...desc: string[]) {
        this.#desc.push(...desc)
        return this as MessageCommand<T>;
    }
    
    usage(...usage: string[]) {
        this.#usage.push(...usage)
        return this as MessageCommand<T>;
    }
    
    examples(...examples: string[]) {
        this.#examples.push(...examples)
        return this as MessageCommand<T>;
    }
}
```

### 2. HTTP API 更新

在 `/Users/liuchunlang/IdeaProjects/zhin/plugins/services/http/src/index.ts` 的插件详情 API 中更新了命令信息的导出：

**修改前：**
```typescript
const commands = plugin.commands.map((cmd) => ({
  name: cmd.pattern,
}));
```

**修改后：**
```typescript
const commands = plugin.commands.map((cmd) => ({
  name: cmd.pattern,
  desc: (cmd as any).help ? (cmd as any).help.split('\n').slice(1).filter((line: string) => 
    !line.startsWith('用法:') && !line.startsWith('示例:') && line.trim()
  ) : [],
  usage: (cmd as any).help ? (cmd as any).help.split('\n').filter((line: string) => 
    line.startsWith('用法:')
  ).map((line: string) => line.replace('用法:', '').trim()) : [],
  examples: (cmd as any).help ? (cmd as any).help.split('\n').filter((line: string) => 
    line.startsWith('示例:')
  ).map((line: string) => line.replace('示例:', '').trim()) : [],
  help: (cmd as any).help || '',
}));
```

### 3. 前端 TypeScript 接口更新

在 `/Users/liuchunlang/IdeaProjects/zhin/plugins/services/console/client/src/pages/dashboard-plugin-detail.tsx` 中更新了类型定义：

```typescript
interface PluginDetail {
  // ... other fields
  commands: Array<{
    name: string
    desc?: string[]
    usage?: string[]
    examples?: string[]
    help?: string
  }>
  // ... other fields
}
```

### 4. 前端 UI 展示优化

更新了命令列表的展示，现在可以显示完整的帮助信息：

```tsx
<Flex direction="column" gap="2" className="max-h-60 overflow-y-auto">
  {plugin.commands.map((cmd, index) => (
    <Box key={index} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
      <Flex direction="column" gap="2">
        <Code size="2" weight="bold">{cmd.name}</Code>
        
        {cmd.desc && cmd.desc.length > 0 && (
          <Flex direction="column" gap="1">
            {cmd.desc.map((desc, i) => (
              <Text key={i} size="1" color="gray">{desc}</Text>
            ))}
          </Flex>
        )}
        
        {cmd.usage && cmd.usage.length > 0 && (
          <Flex direction="column" gap="1">
            <Text size="1" weight="bold" color="blue">用法:</Text>
            {cmd.usage.map((usage, i) => (
              <Code key={i} size="1" variant="soft">{usage}</Code>
            ))}
          </Flex>
        )}
        
        {cmd.examples && cmd.examples.length > 0 && (
          <Flex direction="column" gap="1">
            <Text size="1" weight="bold" color="green">示例:</Text>
            {cmd.examples.map((example, i) => (
              <Code key={i} size="1" variant="soft" color="green">{example}</Code>
            ))}
          </Flex>
        )}
      </Flex>
    </Box>
  ))}
</Flex>
```

## 🎯 使用示例

### 基本用法

```typescript
import { MessageCommand, addCommand } from 'zhin.js';

addCommand(
  new MessageCommand("zt")
    .desc("查看系统状态", "显示操作系统、CPU、内存、运行时和框架的完整状态信息")
    .usage("zt")
    .examples("zt")
    .action(() => {
      // ... command implementation
    })
);
```

### 复杂示例

```typescript
addCommand(
  new MessageCommand("perf.stats")
    .desc("查看实时性能统计", "显示格式化的实时性能数据")
    .usage("perf.stats")
    .examples("perf.stats")
    .action(() => {
      const stats = performanceMonitor.stats;
      // ... format and return stats
    })
);
```

### 多行描述示例

```typescript
addCommand(
  new MessageCommand("help")
    .desc(
      "获取帮助信息",
      "显示所有可用命令的列表",
      "或显示特定命令的详细帮助"
    )
    .usage(
      "help",
      "help <command>"
    )
    .examples(
      "help",
      "help zt",
      "help perf.stats"
    )
    .action((_, result) => {
      // ... implementation
    })
);
```

## 📊 已更新的命令

在 `test-plugin.ts` 中为以下命令添加了完整的帮助信息：

1. **`zt`** - 查看系统状态
   - 描述：显示操作系统、CPU、内存、运行时和框架的完整状态信息
   - 用法：`zt`
   - 示例：`zt`

2. **`mem`** - 查看内存详情
   - 描述：显示进程的详细内存使用情况，包括 RSS、堆内存、外部内存等
   - 用法：`mem`
   - 示例：`mem`

3. **`heap`** - 生成堆快照
   - 描述：生成 V8 堆内存快照文件，用于内存分析
   - 用法：`heap`
   - 示例：`heap`

4. **`memtop`** - 实时内存监控
   - 描述：显示进程的实时内存使用趋势（需要 --expose-gc 标志）
   - 用法：`memtop`
   - 示例：`memtop`

5. **`perf`** - 查看性能监控报告
   - 描述：查看性能监控报告，显示应用的性能统计信息
   - 用法：`perf`
   - 示例：`perf`

6. **`perf.full`** - 查看完整性能监控报告
   - 描述：查看完整性能监控报告，显示详细的性能统计和分析
   - 用法：`perf.full`
   - 示例：`perf.full`

7. **`perf.stats`** - 查看实时性能统计
   - 描述：查看实时性能统计，显示格式化的实时性能数据
   - 用法：`perf.stats`
   - 示例：`perf.stats`

## 🎨 UI 效果

在控制台 Web 界面的插件详情页面中，命令现在会显示：

- **命令名称**（粗体显示）
- **描述**（灰色文本，可多行）
- **用法**（蓝色标签 + 代码块）
- **示例**（绿色标签 + 代码块）

每个命令都在一个独立的圆角卡片中展示，背景为浅灰色（暗黑模式下为深灰色），提供了清晰的视觉层次和良好的可读性。

## ✅ 核心优势

### 1. 链式 API
- 流畅的 API 设计，可以链式调用
- 方法返回 `this`，支持方法链

### 2. 多行支持
- 每个方法都接受多个参数
- 可以添加多行描述、用法和示例

### 3. 自动整合
- `help` getter 自动整合所有帮助信息
- 按照 pattern → desc → usage → examples 的顺序组织

### 4. API 透明
- HTTP API 自动解析和提供结构化的帮助信息
- 分离描述、用法和示例字段

### 5. UI 友好
- 前端自动渲染不同类型的帮助信息
- 使用不同的颜色和样式区分不同部分

## 🚀 测试方法

### 1. 启动应用

```bash
cd examples/test-bot
tsx src/index.ts
```

### 2. 访问控制台

打开浏览器访问 `http://localhost:8086`（或你配置的端口）

### 3. 查看插件详情

1. 进入 "插件" 页面
2. 点击 "test-plugin" 查看详情
3. 在 "命令" 区域查看所有命令的详细帮助信息

### 4. 验证 API

```bash
# 获取插件详情（需要基本认证）
curl -u username:password http://localhost:8086/api/plugins/test-plugin
```

你会看到类似这样的响应：

```json
{
  "success": true,
  "data": {
    "commands": [
      {
        "name": "zt",
        "desc": [
          "查看系统状态",
          "显示操作系统、CPU、内存、运行时和框架的完整状态信息"
        ],
        "usage": ["zt"],
        "examples": ["zt"],
        "help": "zt\n查看系统状态\n显示操作系统、CPU、内存、运行时和框架的完整状态信息\n用法:zt\n示例:zt"
      }
      // ... more commands
    ]
  }
}
```

## 📚 最佳实践

### 1. 描述要简洁明了
```typescript
.desc("命令简短描述", "可选的详细说明")
```

### 2. 用法要完整
```typescript
.usage("command", "command <arg>", "command [optional]")
```

### 3. 示例要实用
```typescript
.examples("command", "command hello", "command --flag")
```

### 4. 保持一致性
所有命令都应该提供至少：
- 一行描述
- 一个用法示例
- 一个实际示例

## 🎉 总结

命令帮助系统现已完全集成到 Zhin.js 中：

✅ **链式 API** - 流畅的方法链调用  
✅ **结构化数据** - 分离的描述、用法、示例字段  
✅ **自动解析** - HTTP API 自动提取帮助信息  
✅ **美观展示** - Web 界面友好的 UI 渲染  
✅ **易于使用** - 简单直观的 API 设计  

开发者现在可以轻松地为命令添加完整的帮助信息，用户也可以在 Web 控制台中方便地查看命令文档！🚀

---

**实施日期**: 2025-11-25  
**版本**: Zhin.js @next  
**状态**: ✅ 完成并可用

