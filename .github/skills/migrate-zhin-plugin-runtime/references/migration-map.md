# 迁移映射

## 能力

| 旧写法 | 新 SSOT |
|---|---|
| `addCommand(new MessageCommand(...))` | `commands/**/*.ts` + `defineCommand()` |
| `addMiddleware(fn)` | `middlewares/*.ts` + `defineMiddleware()` |
| `plugin.on('message.*.receive')` / `plugin.on('message.receive')` | 有序链：`middlewares/*.ts` + `target: 'inbound'`；fire-and-forget：`handlers/message/receive.ts` + `defineHandler()`（路径段用 `.` 拼 localName） |
| `plugin.on('before.sendMessage')` | `middlewares/*.ts` + `target: 'outbound'` |
| `addComponent(fn)` | `components/*.ts(x)` + `defineComponent()` |
| `addTool()` / Tool registry | `tools/*.ts` + `defineAgentTool()` |
| `addCron(new Cron(...))` | `plugin.ts` setup + `scheduleHostToken.register()`，或 `agent/schedules/*.ts` + `defineSchedule()` |
| Skill registry | `agent/skills/<name>.md`（插件包**禁止**顶层 `skills/`，见 `check:no-package-skills`） |
| Agent registry | `agents/<name>.agent.md` |
| MCP registry | `mcp/*.ts` + MCP Feature definition |
| Console entry route metadata | `pages/*.tsx` + `definePage()` |
| 自定义 nav/footer 注册 | `pages/$nav.tsx` / `pages/$footer.tsx` |
| 模块级 Plugin 注册 | `package.json#zhin` + `definePlugin()` entry |
| 全局可变能力 registry | generation-scoped Feature projection |

## 上下文与依赖

| 旧写法 | 新 SSOT |
|---|---|
| `usePlugin()` / `getPlugin()` | `setup(context)` 的 `context`；能力里用执行上下文 |
| `provide(ctx)`（在入口） | `setup` 内 `context.resources.provide(token, v)`（Scope） |
| `inject(name)`（在能力里） | `execute` 内 `context.use(token)`（CapabilityContext，无 `.resources`） |
| `useContext('database', cb)` | `databaseHostToken`（先 `has` 再 `use`） |
| `useContext('router', cb)` | `httpHostToken` / Host 提供的 router 资源 |
| `useContext('web', cb)` | `pages/*.tsx` + `definePage()` |
| `declareConfig(name, Schema)` | `schema.json` 声明字段 + `context.config.get()` |
| `plugin.onDispose(fn)` | `context.lifecycle.add(fn)` 或从 `setup()` 返回 disposer |
| 模块级共享状态 | owner Resource（`createToken` + `provide`） |

Host 资源（database / schedule / outbound / agentTools…）都是**可选**的：一律先
`context.resources.has(token)` 再 `use(token)`，否则精简安装下装配会直接失败。

## 一个完整对照

```ts
// 旧：入口里命令式注册 + 模块级共享状态
import { MessageCommand, usePlugin } from 'zhin.js';

const plugin = usePlugin();
const hits = new Map<string, number>();

plugin.addCommand(new MessageCommand('hit').action(async (message) => {
  const n = (hits.get(message.$sender.id) ?? 0) + 1;
  hits.set(message.$sender.id, n);
  return `hit ${n}`;
}));
```

```ts
// 新 plugin.ts：只装配，状态成为 Resource
import { createToken, definePlugin } from 'zhin.js/plugin-runtime';

export const hitsToken = createToken<Map<string, number>>('demo.hits');

export default definePlugin({
  name: 'demo',
  setup(context) {
    const hits = new Map<string, number>();
    context.resources.provide(hitsToken, hits);
    return () => hits.clear();
  },
});
```

```ts
// 新 commands/hit.ts：文件路径即路由（依赖 zhin.js 时从门面导入，勿再装 @zhin.js/command）
import { defineCommand } from 'zhin.js/command';
import { hitsToken } from '../plugin.js';

export default defineCommand({
  description: 'Count hits per user',
  async execute(context) {
    const hits = context.use(hitsToken);        // 能力上下文：直接 use，无 .resources
    const n = (hits.get(context.input.sender.id) ?? 0) + 1;
    hits.set(context.input.sender.id, n);
    return `hit ${n}`;
  },
});
```

注意 `Message` 字段差异：新运行时用 `content` / `sender` / `target` / `metadata`，
没有 `$raw` / `$channel` / `$sender`。

## Command 路由

```text
gh issue list
  -> commands/gh/issue/list.ts

gh pr <title:string=defaultTitle>
  -> commands/gh/pr/[[title]].ts
     （defineCommand({ params: { title: { type: 'string', default: 'defaultTitle' } } })）
```

命令文件名用 Next.js 风格方括号声明参数形态（`[name]` 必需 / `[[name]]` 可选 /
`[...name]` 捕获所有 / `[[...name]]` 可选捕获所有）；类型与默认值不再写在文件名里，
统一在 `defineCommand({ params })` 中声明（`type` 必填，`default` 可选，有 `default`
时文件名必须用双方括号）。matcher 模式串 DSL（`<name:type>` / `[name:type=default]`）不变。

新 action 接收 `CommandContext`：旧 `message` 对应 `context.input`，旧
`result.params/result.args` 对应 `context.params/context.args`。

## Plugin 与配置

- Root 项目和每个 Plugin package 都可拥有同一套能力目录。
- `plugins/*` 只表示当前 monorepo 携带的一级 child package；逻辑子树由 manifest mount。
- child 可来自 workspace 或 npm，但都必须同时存在 package dependency 与 `zhin.plugins`。
- 每个 package 的 `schema.json` 只声明自己的字段；Root 按 Plugin instance tree 物化配置。
- 旧闭包读取的数据库、env 或共享连接应提升为 owner Resource/Context，再由能力执行上下文读取。

## 不能自动迁移

- callback 捕获入口文件局部变量或隐式 Plugin Context。
- 动态 MessageCommand pattern、matcher、权限链或运行时条件注册。
- 注册与 disposer 依赖分支执行顺序。
- ComponentContext 或模板字符串空白可能被代码生成改变。
- 同一能力由旧 registry 与新目录双写。

逐条的处理办法（含改写示例）见 [人工诊断处理](./manual-diagnostics.md)。
遇到这些情况时，先为旧行为补测试，再把依赖改成显式 config/resource/context，最后迁移能力。
