# 性能检查清单

逐项检查，标记状态：✅ 通过 / ⚠️ 需关注 / ❌ 发现问题

## 1. 内存泄漏 [高]

- [ ] **事件监听器清理**
  - 重点文件：`packages/core/src/plugin.ts`
  - 检查：所有 `on()` 注册是否返回 dispose 函数
  - 检查：`#disposables` Set 是否在 `stop()` 时完整清理
  - 检查：是否有循环引用阻止 GC

- [ ] **定时器清理**
  - 搜索：`setInterval(`, `setTimeout(`
  - 验证：每个定时器在插件卸载时调用 `clearInterval`/`clearTimeout`
  - 重点：`Cron` 任务的 `dispose()` 是否被调用

- [ ] **文件监听器清理**
  - 搜索：`fs.watch(`, `fs.watchFile(`
  - 重点文件：`packages/core/src/plugin.ts` 中的 `watchFile()`
  - 验证：监听器在模块重载时关闭旧实例

- [ ] **WebSocket 连接**
  - 搜索：`ws.on(`, `socket.on(`
  - 验证：连接断开时移除所有监听器
  - 检查：是否有重连逻辑导致监听器累积

- [ ] **闭包引用**
  - 检查大对象闭包捕获：中间件、命令回调
  - 验证：回调不持有不必要的外部引用

## 2. 无界集合 [高]

- [ ] **Plugin.#tools Map**
  - 文件：`packages/core/src/plugin.ts`
  - 检查：工具注册后是否有对应移除逻辑
  - 检查：与 ToolService 的同步机制

- [ ] **Plugin.#middlewares 数组**
  - 文件：`packages/core/src/plugin.ts`
  - 检查：热重载时旧中间件是否被清除

- [ ] **Plugin.#featureContributions Map**
  - 文件：`packages/core/src/plugin.ts`
  - 检查：Feature 卸载时是否从 Map 中移除

- [ ] **消息缓存/历史**
  - 搜索：AI 相关的消息历史存储
  - 重点：`packages/ai/src/` 中的 Memory/Session
  - 验证：是否有最大长度限制或 Compaction 机制

- [ ] **日志缓冲区**
  - 文件：`basic/logger/src/`
  - 检查：是否有内存中的日志缓冲区无限增长

## 3. 热路径优化 [中]

- [ ] **消息分发路径**
  - 文件：`packages/core/src/built/dispatcher.ts`
  - 检查：`extractText()` 是否被重复调用（应缓存结果）
  - 检查：命令匹配是否使用高效数据结构

- [ ] **序列化开销**
  - 搜索：`JSON.stringify(`, `JSON.parse(`
  - 检查：热路径中是否有不必要的序列化
  - 重点：消息内容的反复解析

- [ ] **正则表达式**
  - 搜索：`new RegExp(`
  - 验证：正则表达式是否在热路径外预编译
  - 检查：是否有 ReDoS 风险的正则（嵌套量词）

- [ ] **同步 I/O**
  - 搜索：`readFileSync`, `writeFileSync`, `existsSync`
  - 验证：热路径中不使用同步文件操作
  - 排除：启动时的配置读取（可接受）

## 4. 异步错误处理 [中]

- [ ] **Fire-and-forget Promise**
  - 搜索：`void this.`, 未 `await` 的 async 调用
  - 重点文件：`packages/core/src/adapter.ts`
  - 验证：是否有 `.catch()` 兜底或全局错误处理

- [ ] **未处理的 rejection**
  - 搜索：`.then(` 后没有 `.catch(`
  - 验证：`process.on('unhandledRejection')` 是否注册

- [ ] **超时控制**
  - 搜索：外部 HTTP 请求、数据库查询
  - 验证：是否设置合理的超时时间
  - 检查：WebSocket 是否有心跳/超时断开

## 5. 并发控制 [低]

- [ ] **并发请求**
  - 检查适配器连接是否有并发限制
  - 验证：批量消息发送是否控制并发数

- [ ] **竞态条件**
  - 检查共享状态的并发修改
  - 重点：Plugin 树的动态修改（添加/移除子插件）
