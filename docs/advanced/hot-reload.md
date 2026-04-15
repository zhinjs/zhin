# 热重载

Zhin.js 支持代码和配置的热重载。

## 插件热重载

修改插件代码后自动重载：

```typescript
// src/plugins/my-plugin.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('test')
    .action(() => '测试')
)

// 修改代码后自动重载，无需重启
```

## 配置热重载

修改配置文件后自动应用：

```yaml
# zhin.config.yml
plugins:
  - my-plugin
  - "@zhin.js/http"

# 修改配置后自动重载
```

## 依赖管理

插件依赖自动管理：

```typescript
// 插件 A 依赖数据库
useContext('database', (db) => {
  // 使用数据库
})

// 数据库重启时，插件 A 自动重载
```

## 错误恢复

语法错误自动回滚：

```typescript
// 修改前（正常工作）
addCommand(
  new MessageCommand('test')
    .action(() => '测试')
)

// 修改后（语法错误）
addCommand(
  new MessageCommand('test')
    .action(() => '测试'  // 缺少括号
)

// 自动回滚到修改前的版本
```

## 生命周期

热重载触发生命周期钩子：

```typescript
const { onMounted, onDispose } = usePlugin()

onMounted(() => {
  console.log('插件启动')
})

onDispose(() => {
  console.log('插件卸载')
  // 清理资源
})

// 热重载时：
// 1. 调用 onDispose
// 2. 重新加载代码
// 3. 调用 onMounted
```

## 最佳实践

### 1. 清理资源

```typescript
const { onDispose } = usePlugin()

const timer = setInterval(() => {
  console.log('定时任务')
}, 1000)

onDispose(() => {
  clearInterval(timer)
})
```

### 2. 避免全局状态

```typescript
// ❌ 不推荐
let globalState = 0

// ✅ 推荐
const { provide } = usePlugin()

provide({
  name: 'state',
  value: { count: 0 }
})
```

### 3. 使用依赖注入

```typescript
// ✅ 推荐
const { inject } = usePlugin()

const db = inject('database')
```

