# @zhin.js/command

Zhin Plugin Runtime 的约定式 Command Feature。它发现 `commands/**/*.ts(x)`，将插件树
路径与文件路径投影为命令，并用 `segment-matcher` 同时匹配纯文本和 canonical IM segments。

静态命令文件名可为 ASCII kebab（`hello.ts`）或 Unicode 名（`赞我.ts`）；动态参数文件
（`[name].ts` 等）仍限 ASCII。详见 [命令创作指南](../../../docs/authoring/commands.md)。

## Authoring

```ts
// commands/gh/issue/list.ts -> gh issue list
// commands/赞我.ts -> 赞我
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'List GitHub issues',
  alias: ['issues'],                 // 可多词；子插件仍保留 owner 前缀
  permit: ['adapter(icqq)', 'role(master)'], // 数组 AND；未过则静默未命中
  // shortcut: { '列 issue': {} },   // 全局整句，可打破命名空间
  execute: ({ args }) => `issues:${args.join(',')}`,
});
```

最后一个文件名可以用 Next.js 风格方括号声明参数形态，类型与默认值在 `defineCommand({ params })` 中声明（`type` 必填，`default` 可选且有默认值时文件名必须用双方括号）：

```text
commands/gh/pr/[[title]].ts   -> gh pr [title]    （params: { title: { type: 'string', default: 'defaultTitle' } }）
commands/upload/[asset].ts    -> upload <asset>   （params: { asset: { type: 'image' } }）
commands/search/[...kw].ts    -> search <...kw>   （params: { kw: { type: 'text' } }，运行时 params.kw 为数组；元素粒度随类型：text 逐消息段，word/string 逐词，number/boolean 逐词转换）
```

文本类型包括 `string`、`word`、`text`、`number`、`integer`、`float`、`boolean`；结构化
类型包括 `mention`、`image`、`face`、`reply`、`forward`、`dice`、`rps`。结构化类型
直接从对应 segment 取值，不能声明默认值。

`execute()` 收到冻结的 `CommandContext`：

- `params`：路由参数的类型化结果。
- `args`：匹配后剩余文本按空白切分的兼容视图。
- `segments`：匹配后剩余的结构化段，媒体和 mention 不会丢失。
- `config` / `use()` / `owner` / `generation`：owner-scoped Runtime 上下文。
- `input`：派发来源；IM 中为满足 `CommandMessage` 的 Runtime `Message`。
- `adapter` / `endpoint`：适配器实例 id 与 endpoint 名。
- `scene`：`{ id, type, name? }` 场景对象。
- `sender`：`{ id, name?, role: string[] }` 发送者对象。
- `interaction`：可选的 `UserInteraction`。用 `ask()` 获取单个类型化结论，或用
  `sequence()` 连续收集多个结论；请求可声明 `title`、`description`、`tip` 与校验规则。

可选声明字段：

- `alias`：替换全部本地静态段并重挂 owner 前缀（不打破子插件命名空间）。
- `permit`：内置 DSL（`adapter|group|private|channel|user|role`）；失败为静默未命中。
- `shortcut`：全局整句精确匹配 → 预填 `params`（可打破命名空间）。

单文件插件可在 `setup({ addCommand })` 中调用
`addCommand('hello', defineCommand(...))`。它与目录发现共用 CommandIndex；拆成文件后
可获得单命令 HMR。

## Runtime

definition 在 import 时不注册全局状态。Feature provider 在 generation prepare 阶段完成
发现、校验和 `CommandIndex` 投影；静态路由优先于动态路由，同形动态路由在启动期拒绝。
生产 manifest 指向 `lib/provider.js`。

验证：

```bash
pnpm --filter @zhin.js/command build
pnpm --filter @zhin.js/command test
```

完整用户契约见[命令创作指南](../../../docs/authoring/commands.md)，架构迁移背景见
[Plugin Runtime 原位迁移](../../../docs/architecture/target-implementation/in-place-migration.md)。
