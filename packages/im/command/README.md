# @zhin.js/command

Zhin Plugin Runtime 的约定式 Command Feature。它发现 `commands/**/*/index.ts(x)`，只把文件
相对路径投影为用户路由，并用 `segment-matcher` 同时匹配纯文本和 canonical IM segments。

静态命令目录可为 ASCII kebab（`hello/`）或 Unicode 名（`赞我/`）；动态参数目录
（`[name]/` 等）仍限 ASCII。每个路由目录只识别 `index.ts(x)`，同目录其他文件是 helper。详见[命令创作指南](../../../docs/authoring/commands.md)。

## Authoring

```ts
// commands/gh/issue/list/index.ts -> gh issue list
// commands/赞我/index.ts -> 赞我
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'List GitHub issues',
  alias: ['issues'],                 // 可多词；owner 不参与用户路由
  permit: ['adapter(icqq)', 'role(master)'], // 数组 AND；失败返回 denied
  // shortcut: { '列 issue': {} },   // 全局整句
  execute: ({ args }) => `issues:${args.join(',')}`,
});
```

最后一个文件名可以用 Next.js 风格方括号声明参数形态，类型与默认值在 `defineCommand({ params })` 中声明（`type` 必填，`default` 可选且有默认值时文件名必须用双方括号）：

```text
commands/gh/pr/[[title]]/index.ts   -> gh pr [title]    （params: { title: { type: 'string', default: 'defaultTitle' } }）
commands/upload/[asset]/index.ts    -> upload <asset>   （params: { asset: { type: 'image' } }）
commands/search/[...kw]/index.ts    -> search <...kw>   （params: { kw: { type: 'text', rest: true } }，运行时 params.kw 为数组；元素粒度随类型：text 逐消息段，word/string 逐词，number/boolean 逐词转换）
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

- `alias`：替换全部本地静态段；owner 不参与用户路由。
- `permit`：内置 DSL（`adapter|group|private|channel|user|role`）；失败为 denied，委托 PermissionHost。
- `shortcut`：全局整句精确匹配 → 预填 `params`。

单文件插件可在 `setup({ addCommand })` 中调用
`addCommand('hello', defineCommand(...))`。它与目录发现共用 CommandIndex；拆成文件后
可获得单命令 HMR。


## 集中声明参数、选项与帮助

**列出指令**：在 Bot 会话中发送 `菜单`，列出根插件的指令和直接子插件；`菜单 <插件实例键>` 查看子插件，嵌套实例用 `菜单 foo.bar`。菜单逐层浏览，不一次展开全树。账号设有命令前缀时同样要加前缀，如 `/菜单`。项目根配置的顶层 `menuKeyword` 可修改关键词，`false` 或空字符串关闭；默认关键词为 `菜单`，不是 `help`。详见[指令菜单](../../../docs/authoring/commands.md#查看已加载的指令菜单)。

安装 `@zhin.js/html-renderer` 后，菜单发出带原始文本备用内容的 HTML 段，复用统一发送链的图片渲染和平台策略。渲染失败或平台无法消费图片时保留原文本；无渲染器时直接返回文本。Command Feature 不调用渲染器，也不新增 Core 或样式组件依赖。

菜单每页最多 30 项（指令与子插件合计），`菜单 --page 2` 或 `菜单 rss --page 2` 翻页，图片与文本返回同一页。三列分区、内置背景与图标不需要外部素材；根配置 `menuStyle` 可设置 `title`、`subtitle`、六位 hex `accentColor` 以及 HTTP(S)／PNG/JPEG/WebP data URL 的 `backgroundImage`。同时支持原生 Markdown 与原生按钮时附加翻页控件：首页禁用上一页、末页禁用下一页，单页省略控件；不支持时保留文本导航。回调复用原会话、当前 generation 的 JSX 按钮机制。完整配置和边界见上述指令菜单文档。

目录提供静态命令路径。静态 `commands/remind/index.ts` 可集中声明任意数量的位置参数；
现有 `commands/foo/[id]/index.ts` 仍绑定同名 `params.id`，后面的参数无需额外动态目录。

```ts
export default defineCommand({
  description: '创建提醒',
  params: {
    minutes: { type: 'integer', min: 1, max: 1440, description: '分钟数' },
    note: { type: 'text', default: '休息一下', description: '提醒内容' },
  },
  options: {
    count: { type: 'integer', alias: 'c', default: 1, min: 1, max: 10 },
    quiet: { type: 'boolean', default: false },
  },
  execute: ({ params, options }) => `${params.minutes}:${params.note}:${options.count}`,
});
```

`params` 按声明顺序消费输入；参数类型和 `options` 类型自动推导到 `execute`。
`optional: true` 无默认值时为 `T | undefined`；`rest: true` 为只读数组且必须最后声明。
`type: 'text'` 保留文本中的引号、空格和换行，消费连续文本；它应放在其他标量参数之后。
`min` / `max` 表示数值范围或文本长度；`choices`、`pattern` 与同步 `validate(value, session)`
提供约束。动态默认值与 shortcut 预填也经过同样校验。非法声明在加载前拒绝。

选项支持 `--count 2`、`--count=2`、`-c 2`；布尔 `--quiet` 为 true，
`--quiet=false` 为 false。选项可在参数之间出现；负数不是选项。`--` 结束选项解析，
后面的内容作为参数。未知/重复选项拒绝。`remind --help` 从同一声明生成帮助，包含
Endpoint 前缀及显式插件命名空间，不执行命令；同一权限声明仍约束帮助读取。

`dispatch()` 返回 `status`：`unmatched`（继续普通消息处理）、`invalid`（`issues` +
`help`）、`denied`（权限拒绝）、`executed`。后三者 `matched: true`，只有 `executed`
包含业务结果。可靠静态路径匹配后才提示错误；纯动态路由的模糊聊天保持未匹配。
受限命令没有可鉴权主体时拒绝，Host 可通过 `dispatch` 提供真实 `PermissionSubject`；
`execute(name)` 无主体不能绕过权限。审批与命令准入独立。

真实消费者：[二维码](../../../plugins/utils/qrcode/README.md)、
[代码运行](../../../plugins/utils/code-runner/README.md)。

动态目录的路径形态无法被 TypeScript 读取。使用无默认值的 `[[id]]` 时，声明
`params.id.optional: true`；使用 `[...items]` 时声明 `params.items.rest: true`，
让执行参数的可选性、数组类型与运行时一致。目录绑定的参数应放在 `params` 第一项。

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
