# 命令系统

命令是用户与机器人交互的主要方式。使用 `MessageCommand` 创建命令，由 `CommandFeature` 统一管理。

::: tip 与 AI 触发前缀区分
群/频道里以 `/` 开头的消息默认走 **CommandFeature**（`ai.trigger.ignorePrefixes` 含 `/`），**不会**触发 @ Agent。内置运维命令同样以 `/` 开头，需 **master** 或配置中的 **trusted** 用户方可执行。
:::

## 内置 IM 运维命令（ADR 0010）

`@zhin.js/agent` 在启用 AI 时注册一批 **斜杠命令**，供维护者在 IM 里运维会话与内省运行时状态（实现见 `register-management-tools.ts`、`register-introspection-commands.ts`）。完整行为说明见 [AI 模块 — IM 运维与内省](/advanced/ai#im-运维与内省命令)。

### 会话

| 命令 | 说明 |
|------|------|
| `/compact` | 手动 L2 压缩当前 epoch（yaml：`ai.agent.compaction`） |
| `/tree` | 列出当前会话树分支点 |
| `/tree N` | 跳转到第 N 个分支点并从此继续 |
| `/reset` | 归档当前 epoch；下次 @ 新上下文（`im_transcripts` 旁听行保留） |

### 运维

| 命令 | 说明 |
|------|------|
| `/models` | 列出已发现/配置的可用模型 |
| `/health` | AI Provider 健康检查 |

### 内省

| 命令 | 说明 |
|------|------|
| `/cmd` | 已注册 IM 命令列表 |
| `/bots` | Bot 与在线状态（含 adapter 列） |
| `/bindings` | `ai.agents` 绑定 |
| `/tools` | 已注册 ZhinTool |
| `/mcp` | MCP Client 连接状态 |

内省命令支持 **`[filter] [page]`**（例：`/tools github 2`）；单页仍过长时按行拆成多条 IM 消息。完整列表：`GET /api/introspection/{commands|bots|bindings|tools|mcp}`（Bearer，query：`page`、`filter`、`pageSize`）。

Console 亦可查询会话树：`GET /api/agent/sessions/:sessionKey/tree`、`POST .../leaf`（Bearer Token）。示例项目清单见 [test-bot TOOLS.md](https://github.com/zhinjs/zhin/blob/main/examples/test-bot/TOOLS.md)。

zhin-package 管理：`zhin packages` — 见 [CLI 命令参考](/reference/cli)。

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

```
