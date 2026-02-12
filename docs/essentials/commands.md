# 命令系统

命令是用户与机器人交互的主要方式。使用 `MessageCommand` 创建命令，由 `CommandFeature` 统一管理。

## 基础命令

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello')
    .desc('打个招呼')
    .action(() => '你好！')
)
```

`addCommand` 是 CommandFeature 注入到插件上的扩展方法，返回一个 dispose 函数用于移除命令。

## 命令参数

```typescript
// 必需参数
addCommand(
  new MessageCommand('echo <message:string>')
    .action((_, result) => result.params.message)
)

// 可选参数
addCommand(
  new MessageCommand('greet [name:string]')
    .action((_, result) => {
      const name = result.params.name
      return name ? `你好，${name}！` : '你好！'
    })
)

// 剩余参数
addCommand(
  new MessageCommand('say [...content:text]')
    .action((_, result) => {
      return result.params.content.join(' ')
    })
)
```

### 参数类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `string` | 单个字符串（空格分隔） | `<name:string>` |
| `number` | 数字 | `<count:number>` |
| `text` | 文本（包含空格） | `[...content:text]` |

## 命令描述

```typescript
addCommand(
  new MessageCommand('status')
    .desc('查看状态', '显示系统运行状态')
    .usage('status')
    .examples('status')
    .action(() => '系统正常')
)
```

## Action 函数

```typescript
addCommand(
  new MessageCommand('test')
    .action((message, result) => {
      // message: 消息对象（包含 $sender、$channel、$adapter 等）
      console.log('发送者:', message.$sender?.id)
      console.log('频道:', message.$channel)
      
      // result: 匹配与解析结果
      console.log('参数:', result.params)
      
      return '处理完成'
    })
)
```

## 权限控制

```typescript
addCommand(
  new MessageCommand('ban <user:string>')
    .desc('封禁用户')
    .permit('admin')  // 需要 admin 权限
    .action((_, result) => {
      return `已封禁 ${result.params.user}`
    })
)
```

## 异步命令

```typescript
addCommand(
  new MessageCommand('weather <city:string>')
    .action(async (_, result) => {
      const data = await fetchWeather(result.params.city)
      return `${result.params.city}: ${data.temp}°C`
    })
)
```

## Tool 与 Command 互转

Zhin.js 支持 Tool 和 Command 之间的自动转换，使同一个功能既能被用户通过命令调用，也能被 AI Agent 通过工具调用。

### Tool 自动生成 Command

注册工具时，设置 `command` 选项即可同时生成对应的命令：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

addTool({
  name: 'get_weather',
  description: '查询天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
    },
    required: ['city'],
  },
  // 同时生成命令 "get_weather <city:string>"
  command: { pattern: 'weather <city:string>' },
  execute: async (args) => {
    return await fetchWeather(args.city)
  },
})
```

### 手动转换

```typescript
import { toolToCommand, commandToTool } from 'zhin.js'

// Tool -> Command
const command = toolToCommand(myTool)

// Command -> Tool
const tool = commandToTool(myCommand)
```

## 完整示例

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

// 简单命令
addCommand(
  new MessageCommand('ping')
    .desc('测试延迟')
    .action(() => 'Pong!')
)

// 带参数
addCommand(
  new MessageCommand('echo <message:string>')
    .desc('回显消息')
    .action((_, result) => result.params.message)
)

// 多个参数
addCommand(
  new MessageCommand('add <a:number> <b:number>')
    .desc('计算和')
    .action((_, result) => {
      const { a, b } = result.params
      return `${a} + ${b} = ${a + b}`
    })
)

// 剩余参数
addCommand(
  new MessageCommand('我才是[...content:text]')
    .action((_, result) => {
      const text = result.params.content.join(' ')
      return `好好好，你是${text.replace(/[你|我]/g, m => m === '你' ? '我' : '你')}`
    })
)
```
