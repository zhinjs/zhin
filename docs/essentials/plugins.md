# 插件系统

插件是 Zhin.js 的最小功能单元。每个 `.ts` 文件就是一个插件，通过 `usePlugin()` 获取插件 API。

## 创建插件

在 `src/plugins/` 目录创建文件：

```typescript
// src/plugins/my-plugin.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, logger } = usePlugin()

logger.info('插件已加载')

addCommand(
  new MessageCommand('test')
    .desc('测试命令')
    .action(() => '测试成功')
)
```

在 `zhin.config.yml` 中启用：

```yaml
plugins:
  - my-plugin
```

## usePlugin API

`usePlugin()` 返回当前插件的完整 API：

```typescript
const {
  // 命令系统
  addCommand,      // 添加命令（CommandFeature 扩展）
  
  // 中间件
  addMiddleware,   // 添加消息中间件
  
  // 组件系统
  addComponent,    // 添加消息组件（ComponentFeature 扩展）
  
  // 工具系统
  addTool,         // 添加 AI 工具（ToolFeature 扩展）
  
  // 技能系统
  declareSkill,    // 声明 Skill 元数据（SkillFeature 扩展）
  
  // 定时任务
  addCron,         // 添加定时任务（CronFeature 扩展）
  
  // 配置
  addConfig,       // 注册插件配置项（ConfigFeature 扩展）
  
  // 数据库
  defineModel,     // 定义数据库模型（DatabaseFeature 扩展）
  
  // 上下文与服务
  useContext,       // 等待上下文就绪并执行回调
  provide,          // 注册服务/上下文
  inject,           // 注入已注册的服务
  
  // 生命周期
  onMounted,       // 插件挂载完成回调
  onDispose,       // 插件卸载回调
  
  // 工具属性
  logger,          // 日志对象
  root,            // 根插件实例
  name,            // 插件名称
  filePath,        // 插件文件路径
} = usePlugin()
```

::: tip
上面的 `addCommand`、`addTool`、`declareSkill`、`addCron`、`addConfig` 等方法都是由对应的 Feature 注入到插件上的扩展方法。详见 [Feature 系统](/advanced/features)。
:::

## 生命周期

```typescript
const { onMounted, onDispose } = usePlugin()

onMounted(() => {
  console.log('插件启动')
})

onDispose(() => {
  console.log('插件卸载，清理资源')
})
```

热重载时，框架会依次执行 `onDispose` -> 重新加载文件 -> `onMounted`。

## 使用数据库

```typescript
import { usePlugin } from 'zhin.js'

// 1. 声明模型类型
declare module 'zhin.js' {
  interface Models {
    users: {
      id: number
      name: string
    }
  }
}

const { defineModel, useContext } = usePlugin()

// 2. 定义模型（数据库启动前即可调用）
defineModel('users', {
  id: { type: 'integer', primary: true },
  name: { type: 'string' }
})

// 3. 使用模型（数据库就绪后）
useContext('database', async (db) => {
  const users = db.models.get('users')
  const result = await users.select()
  console.log(result)
})
```

## 注册工具（AI 可调用）

插件可以注册工具，供 AI Agent 调用：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

addTool({
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
    },
    required: ['city'],
  },
  execute: async (args) => {
    const data = await fetchWeather(args.city)
    return { temp: data.temp, desc: data.description }
  },
})
```

也可以使用链式 DSL 风格：

```typescript
import { usePlugin, ZhinTool } from 'zhin.js'

const { addTool } = usePlugin()

addTool(
  new ZhinTool('get_weather')
    .desc('查询指定城市的天气')
    .param('city', 'string', '城市名称', true)
    .execute(async (args) => {
      return await fetchWeather(args.city)
    })
)
```

详见 [工具与技能](/advanced/tools-skills)。

## 声明技能（Skill）

当插件提供了多个相关工具时，可以声明一个 Skill 将它们语义化分组：

```typescript
const { declareSkill } = usePlugin()

declareSkill({
  description: '天气查询服务，支持国内外城市天气和未来天气预报',
  keywords: ['天气', '气温', '下雨', '预报'],
  tags: ['weather', '生活服务'],
})
```

声明后，AI Agent 会在匹配到关键词时优先选择此 Skill 下的工具。

## 提供服务

```typescript
const { provide } = usePlugin()

provide({
  name: 'myService',
  description: '我的服务',
  value: {
    doSomething() {
      return 'done'
    }
  },
  dispose: (service) => {
    // 清理资源
  }
})
```

## 注入服务

```typescript
const { inject } = usePlugin()

const myService = inject('myService')
if (myService) {
  myService.doSomething()
}
```

## 等待上下文就绪

`useContext` 会在指定的服务/上下文就绪后执行回调，并在上下文销毁时自动清理：

```typescript
const { useContext } = usePlugin()

// 等待数据库就绪
useContext('database', (db) => {
  // db 可用
})

// 等待多个上下文
useContext('database', 'router', (db, router) => {
  // 两者都就绪
})
```

## 插件配置

通过 `addConfig` 向主配置文件注册插件自己的配置项：

```typescript
const { addConfig, inject } = usePlugin()

// 注册默认配置（如果配置文件中没有，会自动写入默认值）
addConfig('my-plugin', { apiKey: '', timeout: 5000 })

// 读取配置
const config = inject('config')
const myConfig = config?.get('my-plugin')
```

## 完整示例

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 声明类型
declare module 'zhin.js' {
  interface Models {
    todos: {
      id: number
      text: string
      done: boolean
    }
  }
}

const {
  defineModel,
  addCommand,
  addTool,
  useContext,
  onMounted,
  onDispose,
  logger
} = usePlugin()

// 挂载时执行
onMounted(() => {
  logger.info('插件已启动')
})

// 定义模型
defineModel('todos', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
  done: { type: 'boolean', default: false }
})

// 注册 AI 工具
addTool({
  name: 'add_todo',
  description: '添加一条待办事项',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '待办内容' },
    },
    required: ['text'],
  },
  execute: async (args) => {
    // 实际实现...
    return { success: true }
  },
})

// 使用数据库
useContext('database', (db) => {
  const todos = db.models.get('todos')
  
  addCommand(
    new MessageCommand('todo <text:string>')
      .desc('添加待办')
      .action(async (_, result) => {
        await todos.insert({ text: result.params.text })
        return '已添加'
      })
  )
  
  addCommand(
    new MessageCommand('todos')
      .desc('查看待办')
      .action(async () => {
        const list = await todos.select()
        return list.map(t => `${t.id}. ${t.text}`).join('\n')
      })
  )
})

// 卸载时清理
onDispose(() => {
  logger.info('插件已卸载')
})
```
