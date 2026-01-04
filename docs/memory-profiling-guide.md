# 插件内存分析指南

## 📊 内存分析工具

`plugin-memory-profiler` 插件提供了一套完整的内存分析工具，帮助你识别哪些插件/适配器占用内存最多。

## 🔧 安装

插件已包含在 `examples/test-bot` 中，无需额外安装。

## 📖 使用方法

### 1. 查看所有插件的内存占用

```bash
mem-profile
```

**输出示例**：
```
📊 插件内存分析报告

总插件数: 21
当前堆内存: 60.89 MB
分析开销: 0.05 MB

────────────────────────────────────────────────────────────

1. adapter-discord
   模块数: 156
   估算大小: 2.34 MB
   功能: 0命令 0组件 0定时 0中间件

2. console
   模块数: 89
   估算大小: 1.12 MB
   功能: 0命令 0组件 0定时 0中间件

3. http
   模块数: 45
   估算大小: 0.67 MB
   功能: 0命令 0组件 0定时 0中间件

... 还有 18 个插件

💡 提示:
- 模块数多 = 依赖多 = 可能内存占用高
- 使用 mem-compare 命令对比加载前后的内存
- 使用 --expose-gc 启动可以强制 GC
```

### 2. 分析特定插件

```bash
mem-compare adapter-discord
```

**输出示例**：
```
📊 插件内存分析: adapter-discord

────────────────────────────────────────────────────────────

加载的模块数: 156
模块列表:
  - index.js
  - Client.js
  - WebSocketManager.js
  - GatewayManager.js
  - RestManager.js
  - CacheManager.js
  - MessageManager.js
  - ChannelManager.js
  - GuildManager.js
  - UserManager.js
  ... 还有 146 个模块

估算大小: 2.34 MB

功能统计:
  命令: 0
  组件: 0
  定时任务: 0
  中间件: 0

当前内存状态:
  RSS: 173.23 MB
  堆总量: 83.45 MB
  堆使用: 60.89 MB
  外部: 2.15 MB

💡 提示:
- 这是估算值，实际内存占用可能不同
- 要精确测量，需要在加载前后分别测量
- 大型依赖（如 discord.js）会显著增加内存
```

### 3. 查看模块缓存统计

```bash
mem-cache
```

**输出示例**：
```
📦 模块缓存统计

总模块数: 487
分组数: 45

────────────────────────────────────────────────────────────

discord.js: 156 个模块
@zhin.js/core: 45 个模块
@zhin.js/database: 23 个模块
koa: 18 个模块
@zhin.js/logger: 12 个模块
ws: 11 个模块
plugin:console: 89 个模块
plugin:http: 45 个模块
... 还有 37 个分组

💡 提示:
- 每个模块都会占用内存
- discord.js 等大型库会加载很多模块
- 使用 mem-compare <插件名> 查看具体插件
```

### 4. 生成堆快照（高级）

```bash
mem-snapshot
```

生成 `.heapsnapshot` 文件，可以用 Chrome DevTools 打开进行详细分析。

**分析步骤**：
1. 执行 `mem-snapshot` 命令
2. 打开 Chrome DevTools（F12）
3. 切换到 **Memory** 标签
4. 点击 **Load** 按钮
5. 选择生成的 `.heapsnapshot` 文件
6. 使用以下视图分析：
   - **Summary**: 查看对象类型占用
   - **Comparison**: 对比多个快照找出内存增长
   - **Containment**: 查看对象引用关系

## 🎯 优化建议

### 1. 识别内存占用大户

运行 `mem-profile` 查看哪些插件模块数最多：

```bash
mem-profile
```

**常见内存占用大户**：
- `discord.js`: ~20-30MB（156+ 模块）
- `@vitejs/plugin-react`: ~10-15MB（开发模式）
- `koa` + 中间件: ~5-10MB
- 其他大型适配器库

### 2. 按需加载

在 `zhin.config.yml` 中只启用需要的插件：

```yaml
plugins:
  # 生产环境
  - "@zhin.js/http"
  - "@zhin.js/adapter-qq"  # 只启用实际使用的适配器
  
  # 开发环境（注释掉）
  # - "@zhin.js/console"
  # - "@zhin.js/adapter-sandbox"
  # - "@zhin.js/adapter-discord"
```

### 3. 使用环境变量

```yaml
plugins:
  - "@zhin.js/http"
  - ${ADAPTER:-@zhin.js/adapter-sandbox}  # 默认 sandbox，生产用环境变量覆盖
```

### 4. 懒加载大型依赖

对于像 `discord.js` 这样的大型库，可以实现懒加载：

```typescript
// 不要在模块顶层导入
// import { Client } from 'discord.js';  ❌

// 在需要时才导入
async function createDiscordClient() {
  const { Client } = await import('discord.js');  ✅
  return new Client({...});
}
```

## 📈 内存基准

| 配置 | 堆内存 | 说明 |
|------|--------|------|
| 最小配置 | ~20MB | 只有 core + process |
| 标准配置 | ~40MB | + http + database + 基础插件 |
| + Console | ~60MB | + Vite 开发服务器 |
| + Discord | ~80MB | + discord.js 库 |
| 多适配器 | 100MB+ | 每个大型适配器 +20-30MB |

## 🔍 高级分析技巧

### 1. 启用 GC 暴露

启动时添加 `--expose-gc` 标志：

```bash
node --expose-gc --import tsx/esm -e "import('zhin.js/setup')"
```

然后可以手动触发 GC：

```typescript
if (global.gc) {
  global.gc();
}
```

### 2. 对比快照

生成多个快照并对比：

```bash
# 启动后立即生成
mem-snapshot  # heap-1.heapsnapshot

# 加载插件后
mem-snapshot  # heap-2.heapsnapshot

# 运行一段时间后
mem-snapshot  # heap-3.heapsnapshot
```

在 Chrome DevTools 中使用 **Comparison** 视图对比快照，找出内存增长的对象。

### 3. 监控内存趋势

定期执行 `zt` 命令查看内存趋势：

```bash
# 每 5 秒执行一次
watch -n 5 'echo "zt" | nc localhost 8086'
```

## 💡 常见问题

### Q: 为什么 `mem-profile` 的估算值不准确？

A: 因为 Node.js 不提供按模块统计内存的 API，我们只能通过模块数量和序列化大小来估算。要获得准确数据，需要：
1. 在加载插件前后分别测量 `process.memoryUsage()`
2. 使用堆快照进行详细分析

### Q: 如何精确测量某个插件的内存占用？

A: 最准确的方法是：
1. 启动应用但不加载该插件，记录内存
2. 加载该插件，再次记录内存
3. 计算差值

或者使用堆快照对比。

### Q: 物理内存（RSS）比堆内存高很多，正常吗？

A: 是的，这是正常的。物理内存包括：
- V8 堆内存
- V8 内部结构
- 原生模块内存
- 系统缓冲区
- 其他运行时开销

通常 RSS 是堆内存的 2-3 倍。

## 🎉 总结

使用这些工具，你可以：
1. ✅ 识别内存占用大的插件
2. ✅ 优化插件加载策略
3. ✅ 监控内存趋势
4. ✅ 诊断内存泄漏

记住：**60-80MB 堆内存对于包含多个适配器的应用是正常的**，不必过度优化。只有在发现内存持续增长（内存泄漏）时才需要深入分析。


