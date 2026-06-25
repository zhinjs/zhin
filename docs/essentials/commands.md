# 命令系统

命令是用户与机器人交互的主要方式。使用 `MessageCommand` 创建命令，由 `CommandFeature` 统一管理。

::: tip 与 AI 触发前缀区分
群/频道里以 `/` 开头的消息默认走 **CommandFeature**（`ai.trigger.ignorePrefixes` 含 `/`），**不会**触发 @ Agent。内置运维命令同样以 `/` 开头，需 **master** 或配置中的 **trusted** 用户方可执行。
:::

## 内置 IM 运维命令（ADR 0010）

`@zhin.js/core` 注册 **Endpoint 运行时管理**（`registerEndpointManagementCommands`）；`@zhin.js/agent` 在启用 AI 时注册会话运维与内省命令（实现见 `register-management-tools.ts`、`register-introspection-commands.ts`）。完整行为说明见 [AI 模块 — IM 运维与内省](/advanced/ai#im-运维与内省命令)。

### Endpoint 管理（core）

| 命令 | 说明 |
|------|------|
| `/endpoint add [adapter]` | 添加 endpoint（adapter 交互或 schema 向导） |
| `/endpoint remove <adapter> <name>` | 从配置移除 |
| `/endpoint edit <adapter> <name>` | 编辑配置 |
| `/endpoint start <adapter> <name>` | 连接 |
| `/endpoint stop <adapter> <name>` | 断开（保留配置） |
| `/endpoint cancel` | 取消进行中的添加/绑定 |
| `/endpoint help` | 帮助 |

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
| `/endpoints` | Endpoint 与在线状态（含 adapter 列；由 core 注册） |
| `/bindings` | `ai.agents` 绑定 |
| `/tools` | 已注册 ZhinTool |
| `/mcp` | MCP Client 连接状态 |

内省命令支持 **`[filter] [page]`**（例：`/tools github 2`）；单页仍过长时按行拆成多条 IM 消息。完整列表：`GET /api/introspection/{commands|endpoints|bindings|tools|mcp}`（Bearer，query：`page`、`filter`、`pageSize`）。

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
// 单词参数（不含空格，如子命令、QQ 号、UUID）
addCommand(
  new MessageCommand('/icqq <action:word> [requestId:text]')
    .action((_, result) => {
      const { action, requestId } = result.params
      // /icqq approve dff51432-... → action=approve, requestId=dff51432-...
    })
)

// 贪婪文本（吃掉当前文本段剩余内容，含空格）
addCommand(
  new MessageCommand('echo <message:text>')
    .action((_, result) => result.params.message)
)

// 可选参数
addCommand(
  new MessageCommand('greet [name:word]')
    .action((_, result) => {
      const name = result.params.name
      return name ? `你好，${name}！` : '你好！'
    })
)

// 剩余参数（跨多个词/段）
addCommand(
  new MessageCommand('say [...content:text]')
    .action((_, result) => {
      return result.params.content.join(' ')
    })
)
```

### 参数类型

命令模式由 [`segment-matcher`](https://github.com/zhinjs/segment-matcher) 解析。**没有 `:string` 类型**；旧文档里的 `:string` 应改为下表中的实际类型。

| 类型 | 说明 | 示例 |
|------|------|------|
| `word` | 单个词（不含空格）；多参数时只取第一个 token | `<action:word>`、`[name:word]` |
| `text` | 贪婪匹配当前文本段剩余内容（可含空格）；也可用引号 `'...'` / `"..."` 界定边界 | `<message:text>`、`[requestId:text]` |
| `number` | 整数或小数 | `<count:number>` |
| `integer` | 整数 | `<index:integer>` |
| `float` | 必须带小数点的浮点数 | `<ratio:float>` |
| `boolean` | `true` / `false` | `<force:boolean>` |
| `face` / `image` / `at` 等 | 对应消息段类型 | `<emoji:face>` |

::: warning 常见踩坑
- **`:string` 无效** — 不会匹配任何文本，命令表现为「完全不触发」。单词用 **`word`**。
- **`<param:text>` 是贪婪的** — `cmd <a:text> [b:text]` 会把整句都塞进 `a`，后面的 `b` 永远为空。子命令 + 后续 ID 应写 `<action:word> [id:text]`。
- **多个 `:text` 连用** — 只有第一个会吃到剩余文本；需要「后面所有词」时用 `[...rest:text]`。
:::

默认类型：参数未写类型时等价于 `text`（`<name>` = `<name:text>`）。

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
  new MessageCommand('ban <user:word>')
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
  new MessageCommand('weather <city:word>')
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
  new MessageCommand('echo <message:text>')
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
