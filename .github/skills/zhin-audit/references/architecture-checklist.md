# 架构检查清单

逐项检查，标记状态：✅ 通过 / ⚠️ 需关注 / ❌ 发现问题

## 1. 分层约束 [高]

- [ ] **依赖方向**
  合法的依赖方向（单向向上）：
  ```
  basic/ (logger, database, schema, cli)
    ↑
  packages/kernel (可依赖: basic/*)
    ↑
  packages/ai (可依赖: kernel, basic/logger)
    ↑
  packages/core (可依赖: ai, kernel, basic/*)
    ↑
  packages/agent (可依赖: core, ai)
    ↑
  packages/zhin (可依赖: 所有 packages/*)
  ```
  - 检查每个包的 `package.json` dependencies
  - 验证无反向依赖（如 kernel 依赖 core）

- [ ] **IM 概念隔离**
  - `packages/kernel/` 禁止引用：`Adapter`, `Bot`, `Message`, `Command`
  - `packages/ai/` 禁止引用：`Adapter`, `Bot`, `Message`（IM 特有）
  - 搜索：`import.*from.*@zhin.js/core` 出现在 kernel/ai 中

- [ ] **类型定义位置**
  - 所有 IM 类型在 `packages/core/src/types.ts`
  - 内核类型在 `packages/kernel/src/`
  - AI 类型在 `packages/ai/src/`
  - 无跨层类型泄漏

## 2. AsyncLocalStorage [高]

- [ ] **usePlugin() 调用位置**
  - 验证：只在模块顶层同步上下文中调用
  - 搜索 `usePlugin()` 出现在 `async function` 内部的情况
  - 搜索 `usePlugin()` 出现在 `setTimeout`/`setInterval` 回调中的情况

- [ ] **上下文传播完整性**
  - 文件：`packages/core/src/plugin.ts`（`pluginAls`）
  - 文件：`packages/core/src/built/dispatcher.ts`（`outboundReplyAls`）
  - 验证：跨 `await` 边界上下文不丢失
  - 验证：`Promise.all`/`Promise.race` 中上下文正确

- [ ] **getPlugin() 防护**
  - 验证：上下文缺失时抛出明确错误（不是 undefined）
  - 验证：错误消息包含调用位置信息

## 3. Plugin 生命周期 [中]

- [ ] **启动顺序**
  - `start()` 流程：注册 Context → 挂载 → 广播 mounted → 启动子插件
  - 验证：部分 Context 挂载失败时的回滚策略
  - 验证：子插件启动失败不影响父插件

- [ ] **停止顺序**
  - `stop()` 流程：停止子插件 → 停止适配器 → 卸载 Context → 清理 disposables
  - 验证：停止顺序与启动顺序相反
  - 验证：多次调用 `stop()` 幂等

- [ ] **热重载一致性**
  - 验证：`reload()` = `stop()` + 清缓存 + `start()`
  - 验证：旧模块引用全部释放
  - 验证：`import(?t=...)` 时间戳防缓存有效

- [ ] **循环依赖**
  - 搜索：`provide()` 的 `mounted()` 中调用 `inject()`
  - 验证：不存在 A → B → A 的 Context 依赖链
  - 检查 `useContext()` 多依赖等待是否有死锁风险

## 4. 事件系统 [中]

- [ ] **传播模式使用**
  - `emit()`：仅自身监听器 → 用于私有事件
  - `dispatch()`：向上冒泡 + 向下广播 → 用于消息事件
  - `broadcast()`：仅向下 → 用于配置变更
  - 验证：每个事件使用了正确的传播模式

- [ ] **事件命名冲突**
  - 搜索所有 `emit(`, `dispatch(`, `broadcast(` 的事件名
  - 验证：插件自定义事件不与内置事件冲突
  - 建议：插件事件使用 `pluginName.eventName` 格式

- [ ] **监听器数量**
  - 检查是否有对同一事件注册过多监听器
  - 验证：`MaxListenersExceededWarning` 是否被正确处理

## 5. 适配器与消息链 [中]

- [ ] **入站消息链**
  ```
  平台 → Adapter/Bot → Adapter.emit('message.receive')
    → MessageDispatcher.dispatch → 根插件 middleware
    → 命令匹配 / AI 处理
  ```
  - 验证：所有适配器遵循统一入站路径
  - 验证：不绕过 MessageDispatcher

- [ ] **出站消息链**
  ```
  Message.$reply / Adapter.sendMessage
    → renderSendMessage → before.sendMessage → bot.$sendMessage
  ```
  - 验证：所有发送路径经过 `before.sendMessage` 钩子
  - 验证：不直接调用 `bot.$sendMessage` 绕过钩子

- [ ] **Bot 接口完整性**
  - 每个适配器的 Bot 实现：
    - `$connect()` / `$disconnect()`
    - `$sendMessage()` 返回消息 ID
    - `$recallMessage()` 
    - `$formatMessage()` 包含 `$recall` 方法

## 6. 包结构约定 [低]

- [ ] **目录语义**
  - `src/` → 服务端 TypeScript 源码
  - `lib/` → 服务端编译产物
  - `client/` → 浏览器端源码
  - `dist/` → 浏览器端编译产物

- [ ] **导入路径**
  - 所有 `.ts` 导入使用 `.js` 后缀
  - `moduleResolution: "bundler"`（除 console 插件用 `nodenext`）
  - 无相对路径引用其他包（使用 `@zhin.js/*`）

- [ ] **类型扩展**
  - 新增 Context → 扩展 `Plugin.Contexts`
  - 新增适配器 → 扩展 `RegisteredAdapters`
  - 新增数据模型 → 扩展 `Models`
  - 统一在 `declare module 'zhin.js'` 中
