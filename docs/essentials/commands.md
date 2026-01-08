# 命令系统

使用 `MessageCommand` 创建命令。

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
      // message: 消息对象
      console.log('用户:', message.user_id)
      
      // result: 解析结果
      console.log('参数:', result.params)
      
      return '处理完成'
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
