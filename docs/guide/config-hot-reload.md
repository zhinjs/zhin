# 配置热重载

## 概述

Zhin.js 支持配置文件的热重载。当配置文件发生变化时，框架会智能地应用配置变更：

- **监听目录管理**：自动添加新的插件目录监听，移除不再需要的目录监听
- **插件生命周期管理**：自动加载新插件，卸载移除的插件
- **插件智能重载**：当检测到具体插件的配置项变更时，自动重载该插件以应用新配置
- **数据库热重启**：检测数据库配置变更，自动重启数据库连接并通知插件
- **并发控制**：使用锁机制确保配置变更按顺序处理，避免竞态条件

## 工作原理

### 配置变更流程

```
配置文件修改
    ↓
Config 触发 'change' 事件
    ↓
App.handleConfigChange()
    ↓
等待上次变更完成 (configChangeLock)
    ↓
App.applyConfigChanges()
    ├─ 更新日志级别
    ├─ 更新监听目录 (updateWatchDirs)
    ├─ 更新插件加载 (updatePlugins)
    ├─ 更新 HMR 配置
    ├─ 检测数据库配置变更 (重启并 dispatch 'database.ready')
    └─ 检测插件配置变更 (reloadPluginsOnConfigChange)
    ↓
完成，释放锁
```

### 智能插件重载

框架会深度比较新旧配置中每个插件的配置项：

```typescript
// 伪代码逻辑
for (const plugin of plugins) {
  if (JSON.stringify(oldConfig[plugin.name]) !== JSON.stringify(newConfig[plugin.name])) {
    // 配置变了，重载插件！
    await hmrManager.reload(plugin.filename);
  }
}
```

这意味着你无需手动重启应用，甚至无需手动修改插件文件，只需调整配置文件，插件就会自动以新配置重启。

## 使用场景

### 场景 1：调整插件参数

**修改前的配置：**
```typescript
export default defineConfig({
  plugins: ['http'],
  http: {
    port: 8080
  }
})
```

**修改后的配置：**
```typescript
export default defineConfig({
  plugins: ['http'],
  http: {
    port: 9090 // 修改端口
  }
})
```

**效果：**
- 框架检测到 `http` 插件的配置发生变化。
- 自动卸载 `http` 插件（关闭旧端口）。
- 重新加载 `http` 插件（监听 9090 端口）。
- 服务无缝切换。

### 场景 2：数据库切换

**修改配置：**
```typescript
// 从 sqlite 切换到 mysql
export default defineConfig({
  database: {
    dialect: 'mysql',
    // ...
  }
})
```

**效果：**
- 框架检测到 `database` 配置变更。
- 自动停止旧数据库连接。
- 创建并启动新数据库连接。
- 广播 `database.ready` 事件。
- 依赖数据库的插件（如 `test-plugin`）会通过 `onDatabaseReady` 钩子自动响应，重新获取 Model 或执行初始化逻辑。

### 场景 3：添加/移除插件

同原文档，自动加载新插件或卸载旧插件。

## 最佳实践

### 1. 使用配置验证
插件应使用 `defineSchema` 定义配置结构，这不仅用于类型检查，也能确保配置变更的比较是准确的。

### 2. 响应数据库事件
如果插件依赖数据库，务必使用 `onDatabaseReady` 钩子，而不是在顶层直接使用。这样可以确保在数据库热重启时，插件能正确重新连接。

```typescript
// ✅ 正确做法
onDatabaseReady((db) => {
  const model = db.model('users');
  // ...
});

// ❌ 错误做法（数据库重启后会失效）
const db = useDatabase();
const model = db.model('users');
```

## 故障排查

### 问题：配置修改后没反应
1. 检查日志，看是否有 `[App] Configuration changed` 消息。
2. 检查 `zhin.config.ts` 语法是否正确。
3. 如果是数据库配置，检查是否触发了 `database.ready` 事件。

### 问题：插件重载后状态丢失
这是预期行为。HMR 的本质是销毁旧实例、创建新实例。如果需要持久化状态，请使用数据库或外部存储。
