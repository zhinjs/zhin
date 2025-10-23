# 配置热重载

## 概述

Zhin.js 支持配置文件的热重载。当配置文件发生变化时，框架会智能地应用配置变更：

- **监听目录管理**：自动添加新的插件目录监听，移除不再需要的目录监听
- **插件生命周期管理**：自动加载新插件，卸载移除的插件
- **并发控制**：使用锁机制确保配置变更按顺序处理，避免竞态条件
- **数据库配置**：检测数据库配置变更（需要重启）

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
    └─ 检测数据库配置变更
    ↓
更新 previousConfig
    ↓
完成，释放锁
```

### 锁机制

使用 `configChangeLock` 属性实现配置变更的串行化：

```typescript
private configChangeLock: Promise<void> | null = null;
private previousConfig: AppConfig | null = null;

private async handleConfigChange(newConfig: AppConfig): Promise<void> {
  // 等待上一次配置变更处理完成
  if (this.configChangeLock) {
    await this.configChangeLock;
  }

  // 创建新的锁
  this.configChangeLock = this.applyConfigChanges(newConfig);
  
  try {
    await this.configChangeLock;
  } finally {
    this.configChangeLock = null;
  }
}
```

## 使用场景

### 场景 1：添加新的插件目录

**修改前的配置：**
```typescript
export default defineConfig({
  plugin_dirs: [
    './src/plugins',
    'node_modules'
  ],
  plugins: ['http', 'console']
})
```

**修改后的配置：**
```typescript
export default defineConfig({
  plugin_dirs: [
    './src/plugins',
    './src/custom-plugins',  // 新增
    'node_modules'
  ],
  plugins: ['http', 'console']
})
```

**效果：**
- 框架自动开始监听 `./src/custom-plugins` 目录
- 该目录下的插件可以被热重载

### 场景 2：启用新插件

**修改前的配置：**
```typescript
export default defineConfig({
  plugin_dirs: ['./src/plugins'],
  plugins: ['http']
})
```

**修改后的配置：**
```typescript
export default defineConfig({
  plugin_dirs: ['./src/plugins'],
  plugins: ['http', 'console']  // 新增 console 插件
})
```

**效果：**
- 框架自动加载 `console` 插件
- 无需重启应用

### 场景 3：禁用插件

**修改前的配置：**
```typescript
export default defineConfig({
  plugin_dirs: ['./src/plugins'],
  plugins: ['http', 'console', 'database-admin']
})
```

**修改后的配置：**
```typescript
export default defineConfig({
  plugin_dirs: ['./src/plugins'],
  plugins: ['http', 'console']  // 移除 database-admin
})
```

**效果：**
- 框架自动卸载 `database-admin` 插件
- 调用插件的 `dispose()` 方法清理资源
- 从依赖映射中移除

### 场景 4：更新日志级别

**修改前的配置：**
```typescript
export default defineConfig({
  log_level: LogLevel.INFO,
  plugins: ['http']
})
```

**修改后的配置：**
```typescript
export default defineConfig({
  log_level: LogLevel.DEBUG,  // 改为 DEBUG
  plugins: ['http']
})
```

**效果：**
- 日志级别立即生效
- 开始输出 DEBUG 级别日志

## 注意事项

### 数据库配置不支持热重载

数据库配置变更需要重启应用：

```typescript
// 修改数据库配置
export default defineConfig({
  database: {
    dialect: 'mysql',  // 从 sqlite 改为 mysql
    host: 'localhost',
    port: 3306
  }
})
```

框架会输出警告：
```
[WARN] Database configuration changed, but hot reload is not supported. Please restart the app.
```

### 插件加载顺序

插件卸载和加载是按顺序执行的：

1. 先卸载移除的插件
2. 再加载新增的插件
3. 等待新插件就绪后才完成配置变更

### 插件依赖关系

如果插件 B 依赖插件 A，确保：

1. 不要单独移除插件 A（会导致插件 B 出错）
2. 先加载依赖项，再加载依赖它的插件
3. 建议使用 `useContext` 来声明依赖关系

## 最佳实践

### 1. 渐进式配置变更

**不推荐：**
```typescript
// 一次性修改大量配置
export default defineConfig({
  plugin_dirs: ['./new-dir-1', './new-dir-2', './new-dir-3'],
  plugins: ['new-1', 'new-2', 'new-3', 'new-4', 'new-5']
})
```

**推荐：**
```typescript
// 分步骤修改配置
// 第一步：添加一个新目录
export default defineConfig({
  plugin_dirs: ['./src/plugins', './new-dir-1'],
  plugins: ['http']
})

// 第二步：启用一个新插件
export default defineConfig({
  plugin_dirs: ['./src/plugins', './new-dir-1'],
  plugins: ['http', 'new-1']
})
```

### 2. 使用配置验证

通过 Schema 定义配置结构，框架会自动验证：

```typescript
const MyPluginSchema = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(5000),
  retries: Schema.number().min(0).max(5).default(3)
})

// 配置错误会在变更时被检测
export default defineConfig({
  plugins: {
    'my-plugin': {
      apiKey: 'xxx',
      timeout: 'invalid',  // ❌ 类型错误，会被拒绝
      retries: 10          // ❌ 超出范围，会被拒绝
    }
  }
})
```

### 3. 监控配置变更日志

框架会输出详细的配置变更日志：

```
[INFO] App configuration changed
[INFO] Updating log level: INFO -> DEBUG
[INFO] Adding watch directory: src/custom-plugins
[INFO] Loading plugin: my-new-plugin
[INFO] Plugin my-new-plugin loaded successfully
[INFO] Configuration changes applied successfully
```

### 4. 使用环境变量

支持在配置文件中使用环境变量：

```typescript
export default defineConfig({
  log_level: process.env.LOG_LEVEL === 'debug' 
    ? LogLevel.DEBUG 
    : LogLevel.INFO,
  
  plugins: process.env.ENABLE_ADMIN === 'true'
    ? ['http', 'console', 'admin']
    : ['http', 'console']
})
```

修改环境变量并保存配置文件即可触发热重载。

## 故障排查

### 问题 1：插件未能卸载

**症状：**
- 修改配置移除插件后，插件仍在运行

**可能原因：**
1. 插件名称匹配失败
2. 插件未正确实现 `dispose()` 方法

**解决方案：**
```typescript
// 在插件中正确实现清理逻辑
useContext('http', (http) => {
  const dispose = http.router.get('/api/test', handler)
  
  // 返回清理函数
  return () => {
    dispose()
  }
})
```

### 问题 2：配置变更未生效

**症状：**
- 修改配置文件保存后，没有任何变化

**可能原因：**
1. 配置文件格式错误
2. 上一次配置变更未完成

**解决方案：**
1. 检查配置文件语法
2. 等待上一次变更完成（查看日志中的 "Waiting for previous config change"）

### 问题 3：频繁配置变更导致性能问题

**症状：**
- 快速连续修改配置导致应用响应缓慢

**解决方案：**
- 框架已经实现了串行化处理，但建议避免在短时间内频繁修改配置
- 使用防抖保存配置文件（编辑器功能）

## API 参考

### App 类新增方法

#### handleConfigChange(newConfig: AppConfig)

处理配置变更的入口方法。

**参数：**
- `newConfig`: 新的配置对象

**返回：**
- `Promise<void>`

**特性：**
- 自动等待上次变更完成
- 使用锁机制防止并发

#### applyConfigChanges(newConfig: AppConfig)

应用配置变更的核心逻辑。

**参数：**
- `newConfig`: 新的配置对象

**返回：**
- `Promise<void>`

**内部流程：**
1. 对比新旧配置
2. 更新日志级别
3. 更新监听目录
4. 更新插件加载
5. 检测数据库配置变更

#### updateWatchDirs(oldDirs: string[], newDirs: string[])

更新监听目录。

**参数：**
- `oldDirs`: 旧的监听目录列表
- `newDirs`: 新的监听目录列表

**返回：**
- `Promise<void>`

**逻辑：**
- 移除不再需要的目录
- 添加新的监听目录

#### updatePlugins(oldPlugins: string[], newPlugins: string[])

更新插件加载。

**参数：**
- `oldPlugins`: 旧的插件列表
- `newPlugins`: 新的插件列表

**返回：**
- `Promise<void>`

**逻辑：**
- 先卸载移除的插件
- 再加载新增的插件
- 等待新插件就绪

#### unloadPlugin(pluginName: string)

卸载指定插件。

**参数：**
- `pluginName`: 插件名称

**返回：**
- `Promise<void>`

**逻辑：**
1. 查找插件实例
2. 调用 `dispose()` 清理资源
3. 从依赖映射中移除

## 总结

配置热重载是 Zhin.js 的重要特性，它使得开发和运维更加灵活：

- ✅ 无需重启即可调整插件配置
- ✅ 安全的并发控制，避免竞态条件
- ✅ 智能的差异检测，只更新变化的部分
- ✅ 完整的日志记录，方便调试和监控

遵循最佳实践，可以充分利用这一特性提升开发效率。
