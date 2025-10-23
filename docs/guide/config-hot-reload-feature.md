# 配置热重载功能

## 新增功能

### 智能配置变更处理

实现了配置文件热重载功能，当配置文件发生变化时，框架会智能地应用配置变更：

1. **并发控制**
   - 使用 `configChangeLock` 实现配置变更的串行化
   - 确保同一时间只有一个配置变更在处理
   - 后续变更会等待前一个变更完成

2. **监听目录管理**
   - 自动对比新旧配置的 `plugin_dirs`
   - 添加新的监听目录
   - 移除不再需要的监听目录

3. **插件生命周期管理**
   - 智能对比新旧配置的 `plugins` 列表
   - 自动卸载移除的插件（调用 `dispose()` 清理资源）
   - 自动加载新增的插件
   - 等待新插件就绪后才完成配置变更

4. **日志级别动态更新**
   - 检测 `log_level` 配置变更
   - 立即应用新的日志级别

5. **数据库配置变更检测**
   - 检测数据库配置是否变更
   - 输出警告提示需要重启（数据库配置不支持热重载）

## 实现细节

### App 类新增属性

```typescript
class App {
  private configChangeLock: Promise<void> | null = null;
  private previousConfig: AppConfig | null = null;
}
```

### 核心方法

#### handleConfigChange(newConfig)
- 配置变更的入口方法
- 等待上一次变更完成
- 创建新的锁并执行配置应用

#### applyConfigChanges(newConfig)
- 配置应用的核心逻辑
- 对比新旧配置
- 按顺序执行各项更新

#### updateWatchDirs(oldDirs, newDirs)
- 更新文件监听目录
- 智能差异比较

#### updatePlugins(oldPlugins, newPlugins)
- 更新插件加载状态
- 先卸载，再加载
- 等待就绪

#### unloadPlugin(pluginName)
- 卸载指定插件
- 清理资源
- 从依赖映射移除

### 配置变更流程

```
配置文件保存
    ↓
Config.on('change') 触发
    ↓
App.handleConfigChange() 调用
    ↓
等待 configChangeLock (如果有)
    ↓
App.applyConfigChanges() 执行
    ├─ 更新日志级别
    ├─ updateWatchDirs()
    ├─ updatePlugins()
    └─ 检测数据库配置
    ↓
更新 previousConfig
    ↓
释放锁
```

## 使用示例

### 场景 1：添加新插件

```typescript
// 修改前
export default defineConfig({
  plugins: ['http']
})

// 修改后
export default defineConfig({
  plugins: ['http', 'console']
})

// 效果：自动加载 console 插件，无需重启
```

### 场景 2：移除插件

```typescript
// 修改前
export default defineConfig({
  plugins: ['http', 'console', 'admin']
})

// 修改后
export default defineConfig({
  plugins: ['http', 'console']
})

// 效果：自动卸载 admin 插件，释放资源
```

### 场景 3：更新监听目录

```typescript
// 修改前
export default defineConfig({
  plugin_dirs: ['./src/plugins']
})

// 修改后
export default defineConfig({
  plugin_dirs: ['./src/plugins', './src/custom-plugins']
})

// 效果：开始监听新目录，支持该目录下插件的热重载
```

## 日志输出

框架会输出详细的配置变更日志：

```
[INFO] App configuration changed
[INFO] Updating log level: INFO -> DEBUG
[INFO] Removing watch directory: old-plugins
[INFO] Adding watch directory: src/custom-plugins
[INFO] Unloading plugin: old-plugin
[INFO] Plugin old-plugin unloaded successfully
[INFO] Loading plugin: new-plugin
[INFO] Plugin new-plugin loaded successfully
[INFO] Configuration changes applied successfully
```

## 注意事项

1. **数据库配置不支持热重载**
   - 修改数据库配置后会显示警告
   - 需要手动重启应用

2. **插件依赖关系**
   - 确保依赖的插件先加载
   - 不要移除被其他插件依赖的插件

3. **配置验证**
   - 通过 Schema 自动验证配置
   - 无效配置会被拒绝

4. **性能考虑**
   - 避免频繁修改配置
   - 框架已实现串行化处理，防止并发问题

## 相关文档

- [配置热重载指南](../docs/guide/config-hot-reload.md)
- [Schema 系统](../docs/guide/schema-system.md)
- [最佳实践](../docs/guide/best-practices.md)
