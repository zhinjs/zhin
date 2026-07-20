# 命令系统

命令是用户与机器人交互的主要方式。一个命令就是 `commands/` 目录下的一个 `.ts` 文件，默认导出 `defineCommand(...)`；运行时按目录结构自动生成命令名，用户以 `/` 前缀触发。

::: tip 与 AI 触发区分
入站消息以 `/` 开头时先走命令索引（`CommandIndex`）匹配；**未命中**任何命令时才会交给 AI（如已启用）。命令命中且 `execute` 返回了内容，框架会自动回复该内容。
:::

## 第一个命令

在项目根目录创建 `commands/ping.ts`：

```typescript
// commands/ping.ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '测试连通性',
  execute: () => 'Pong!',
})
```

用户发送 `/ping`，机器人回复 `Pong!`。无需手动注册——`zhin runtime start` 会扫描 `commands/` 目录并自动挂载、热重载。

## 目录约定

- `commands/` 是固定目录名，位于**项目根**或**插件包根**。
- 目录名与文件（去扩展名）只认小写字母、数字、连字符：正则 `[a-z0-9][a-z0-9-]*`，支持 `.ts` / `.tsx`。
- **嵌套目录生成子命令**，层级以空格连接：

```
commands/
  ping.ts            → /ping
  user/
    list.ts          → /user list
    ban.ts           → /user ban
```

- 同名命令（同一 qualified 名被注册两次）会在启动时直接报错，不会静默覆盖。
- 字面文件**优先于**动态参数文件：`commands/user/list.ts` 与 `commands/user/[name:string].ts` 并存时，`/user list` 永远命中前者。

## 参数：动态文件段

命令参数用**文件名**声明，格式为 `[name:type=default].ts`：

```typescript
// commands/echo/[text:string].ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '回显一段文本',
  execute({ params }) {
    return `你说：${params.text}`
  },
})
```

| 文件 | 命令 | 说明 |
|------|------|------|
| `[url:string].ts` | `... <url>` | 必填 string 参数 |
| `[count:number].ts` | `... <count>` | 必填 number 参数（运行时解析失败则命令不命中） |
| `[force:boolean].ts` | `... <force>` | 必填 boolean 参数（只接受 `true` / `false`） |
| `[url:string=].ts` | `... [url]` | 带默认值（这里是空串）→ 参数**可选** |

类型只有三种：`string` / `number` / `boolean`。默认值写在 `=` 之后，且必须能解析为对应类型，否则启动报错。

::: warning 动态段的两个硬约束
- **整条命令路径只允许一个动态文件段，且必须在末尾**。`commands/a/[x:string].ts/b.ts` 这类「动态段后面还有段」的写法不会被正确识别。
- **目录段不支持动态参数**——`commands/[id]/profile.ts` 中的 `[id]` 目录不会被发现（目录段只认字面名）。需要动态参数时，把它放到最后的文件名里。
:::

**`args` 兜底**：动态参数之外的剩余输入不会丢失。匹配时框架从最长的命令名开始逐词匹配，`execute` 会拿到命令词之后的全部剩余词：

```typescript
// commands/say.ts
export default defineCommand({
  execute({ args }) {
    // /say 今天 天气 不错 → args = ['今天', '天气', '不错']
    return args.join(' ')
  },
})
```

## 命令上下文

`execute` 收到一个冻结的上下文对象：

| 字段 | 说明 |
|------|------|
| `params` | 解析后的动态参数（`Record<string, string \| number \| boolean>`），键名即文件名里的 `name` |
| `args` | 命令词之后剩余的词数组（兜底自由文本） |
| `input` | 触发本条命令的 Runtime `Message`（`content` / `sender` / `target` / `metadata` / `$reply`），非 IM 触发时可能为 `undefined` |
| `config` | 本插件实例的配置（`schema.json` 默认值 + `zhin.config.yml` 的 `plugins.<instanceKey>` 覆盖） |
| `owner` / `generation` | 所属插件实例快照与当前运行代次 |
| `use(token)` | 取 Host Resource（见 [插件系统](./plugins#host-resources)） |

```typescript
export default defineCommand({
  description: '查看当前会话信息',
  execute({ input }) {
    if (!input) return '此命令需要在会话中触发'
    return `target=${input.target} sender=${input.sender ?? '未知'}`
  },
})
```

## 返回值

`execute` 的返回值是 `SendContent`，框架会代你回复（返回 `undefined` 则不回复）：

| 形态 | 写法 | 说明 |
|------|------|------|
| 纯文本 | `return 'Pong!'` | 最常用 |
| 组件渲染 | `return component('status-card', props)` | 交给 `components/` 里注册的组件渲染（如 Satori 卡片） |
| 原始段 | `return raw(segment)` | 需要平台原生消息段时 |
| 数组 | `return ['第一行', component(...)]` | 混合多段 |

```typescript
// commands/card.ts（出自 examples/minimal-bot）
import { defineCommand } from '@zhin.js/command'
import { component } from '@zhin.js/core/runtime'

export default defineCommand({
  description: '渲染状态卡片',
  execute: () => component('status-card', {
    title: 'minimal-bot',
    lines: [{ label: 'RSS', value: '42MB' }],
  }),
})
```

也可以在 `execute` 内直接 `await input.$reply(...)` 主动回复（此时让 `execute` 返回 `undefined`，避免重复回复）。

## 命令命名：bare 与 qualified

命令的最终名字 = **插件实例路径** + **本地路径**：

- **项目根** `commands/` → bare 名：`commands/ping.ts` → `/ping`。
- **插件包** `commands/` → 自动带 **instanceKey 前缀**：qrcode 插件（instanceKey 为 `qrcode`）的 `commands/scan/[url:string].ts` → `/qrcode scan <url>`。
- 同一插件挂多个实例（如 `icqq` / `icqq-2`），各自的命令前缀互不冲突。

instanceKey 来自项目 `package.json` 的 `zhin.plugins[].instanceKey`，同时它也是 `zhin.config.yml` 里 `plugins.<instanceKey>` 的配置键。

## 权限

新命令系统（Plugin Runtime）**没有内置的声明式权限字段**。需要权限控制时，在 `execute` 内基于 `input.sender` 与 `config`（例如配置里的 master 列表）自行判断：

```typescript
export default defineCommand<MyConfig>({
  execute({ config, input }) {
    const masters = (config as { masters?: string[] }).masters ?? []
    if (!masters.includes(String(input?.sender))) return '仅管理员可用'
    // ...
  },
})
```

::: info legacy 路径
旧的 `usePlugin()` + `MessageCommand`（含 `.permit()`、内置 `/endpoint` 等运维命令）属于旧 Feature registry，由 `zhin dev` 路径提供；新项目请使用本文的 `defineCommand` 约定目录写法。
:::

## 完整示例

一个带必填参数、使用配置的命令（形态参考 `plugins/utils/rss`）：

```
commands/
  subscribe/
    [url:string].ts
```

```typescript
// commands/subscribe/[url:string].ts
import { defineCommand } from '@zhin.js/command'

interface Config {
  maxPerGroup?: number
}

export default defineCommand<Config>({
  description: '订阅一个 RSS/Atom 源',
  async execute({ params, config, input }) {
    const url = String(params.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return '请提供有效的 HTTP/HTTPS 地址'
    // …持久化、推送等逻辑…
    return `已订阅：${url}（会话 ${input?.target ?? 'unknown'}）`
  },
})
```

## 下一步

- [插件系统](./plugins) — `definePlugin`、约定目录全表与 Host Resources
- [中间件与消息调度](./middleware) — 在命令之前拦截/包裹消息
- [消息如何流转](./message-flow) — 入站/出站全链路
- [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) — 可运行的最小命令示例
