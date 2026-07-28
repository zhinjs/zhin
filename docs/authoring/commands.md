---
title: 命令（defineCommand）
description: commands/ 文件路由、execute 上下文、返回值渲染、master/trusted 权限与 commandPrefix
---

# 命令（defineCommand）

在插件包根目录建一个 `commands/` 目录、往里放一个 `hello.ts`，用户就能在群里敲 `hello` 触发它——**文件路径即命令名**，改完文件热重载立即生效，不用重启进程。这条链路由 `@zhin.js/command` Feature 提供，无需手工注册。

```ts
// commands/hello.ts
import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: '打个招呼',
  execute: () => 'Hello from zhin.',
});
```

## 文件路由

命令名 = 插件在插件树中的路径段 + 文件相对路径段，用空格连接。Root 插件（应用自身）没有前缀。

| 文件 | 所属插件 | 命令名 |
| --- | --- | --- |
| `commands/hello.ts` | root | `hello` |
| `commands/endpoint/list.ts` | `qq` | `qq endpoint list` |
| `commands/endpoint/add/[name:string=].ts` | `qq` | `qq endpoint add [name]` |

先看嵌套：`commands/` 递归扫描，嵌套目录直接映射为子命令段，目录与文件名必须是小写 kebab 风格（`/^[a-z0-9][a-z0-9-]*$/`）。

动态参数段写在文件名里：`[name:type=default].ts`（`.tsx` 亦可）。`type` 仅支持 `string` / `number` / `boolean`，`=default` 可省略——无默认值即必填，帮助里显示 `<name>`；有默认值显示 `[name]`，省略该词时取默认值。运行时按类型解析：`number` 必须是有限数值，`boolean` 只接受 `true` / `false`，解析失败视为「命令不匹配」而不是报错。

路由冲突有两条规则：**静态优先**——`list.ts` 永远赢过 `[name:string].ts`，动态路由之间静态段多者（更具体）优先；**同形拒绝**——同一路由形状重复注册会在启动时报错（`Duplicate runtime Command`）。

真实示例（`plugins/adapters/qq/commands/endpoint/remove/[name:string].ts`，命令定义由[endpoint 管理命令套件](#适配器-endpoint-管理命令套件)生成）：

```ts
import { qqEndpointCommands } from '../../../src/qq-endpoint-commands.js';

export default qqEndpointCommands.remove;
```

## execute 上下文

`execute(context)` 收到一个冻结的 `CommandContext`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `args` | `readonly string[]` | 命令名匹配之后剩余的词（按空白切分） |
| `params` | `Record<string, string \| number \| boolean>` | 动态参数段解析后的类型化值 |
| `config` | `Readonly<TConfig>` | 本插件的配置快照（来自 `zhin.config.yml`） |
| `input` | `TInput` | 调用来源；IM 消息派发时是 Runtime `Message`（带 `$reply`），其它来源（如 Host 调用）可能为 `undefined` |
| `use(token)` | `<T>(token: Token<T>) => T` | 取 Plugin Runtime 资源（见下） |
| `owner` | `PluginNodeSnapshot` | 命令所属插件节点 |
| `generation` | `number` | 当前代际号 |

`use(token)` 读的是插件 `setup()` 时 `resources.provide(...)` 注册的资源，缺失时抛错。上面的 QQ 命令用 `use(qqRuntimeStateToken)` 拿到适配器共享状态——这是命令与适配器协作的标准方式。

## 返回值与组件渲染

`execute` 的返回值（或 `Promise` 解出的值）即回复内容，类型为 `SendContent`。它可以是字符串（直接作为文本回复）、`component(name, props)`（调用[组件](./middleware-components.md#definecomponent)渲染，`zhin.js/core/runtime` 导出）、`raw(payload)`（原样下线的 wire 段，如 `{ type: 'html', data: { html, width } }`），也可以是这三者组成的**数组**表示多段消息。返回 `undefined` 则不回复——命令自己已通过 `input.$reply(...)` 回复，或主动静默。

IM 入站的完整链路：

```mermaid
flowchart LR
    A[适配器入站消息] --> B[inbound 中间件]
    B --> C{剥离 commandPrefix}
    C -->|不匹配| D[未命中处理 / AI]
    C -->|匹配| E[CommandIndex.dispatch<br/>最长前缀匹配]
    E --> F[execute context]
    F -->|返回值| G["$replyFrom(owner, value)"]
    G --> H[OutboundRenderer<br/>component/raw 展开]
    H --> I[outbound 中间件]
    I --> J[平台 Endpoint 发送]
```

派发时从整句消息里做**最长前缀匹配**：按词从长到短尝试匹配命令名，命中后剩余的词进入 `args`。因此 `qq endpoint remove mybot` 会命中 `qq endpoint remove`，`args` 为空、`params.name === 'mybot'`。

## master / trusted 权限模式

框架层发送者角色为三档：`user` → `trusted` → `master`（`master` 隐含 `trusted`）。角色由适配器实例配置解析：

```yaml
# zhin.config.yml
plugins:
  qq:
    master: '10001'        # 顶层 master（endpoint owner）
    endpoints:
      - name: main
        appid: ${QQ_APPID}
        master: '10001'    # endpoints[i] 可逐项覆盖
```

`master` / `trusted` 名单由 Core 的角色解析读取（`resolveSenderRoles`，`packages/im/core/src/built/ai-trigger.ts`），`role(master)`、`role(trusted)` 这类 permit 以及 [Agent 工具](./agent-tools.md)的 `permissions` 都基于同一套角色。

命令自身不内置权限声明，权限判断写在 `execute` 里。以 endpoint 管理命令的通用判定为例（`isEndpointOperator`，`packages/im/adapter/src/endpoint-commands.ts`）：

```ts
export function isEndpointOperator(config: unknown, input: unknown): boolean {
  const cfg = (config ?? {}) as { master?: unknown; endpoints?: unknown };
  const masters = new Set<string>();
  // 收集顶层 master 与各 endpoints[i].master …
  if (masters.size === 0) return true; // 未配置 master 时放行
  const sender = String((input as { sender?: unknown } | null)?.sender ?? '').trim();
  return !!sender && masters.has(sender);
}
```

这个模式的要点：用 `config`（插件配置）拿到声明的 `master` 名单，用 `input`（消息）拿到发送者 id，比对后返回拒绝文案（`仅 master 可执行 <Adapter> endpoint 管理命令`）。未配置 `master` 时放行，首个扫码绑定者即成为 owner（QQ 绑定流程会把操作者写为新 endpoint 的 `master`）。注意 `input` 不一定是消息（可能是 Host 调用），取发送者前要做类型守卫；非消息来源时 `$reply` 降级为 no-op。

## 适配器 endpoint 管理命令套件

`@zhin.js/adapter` 的 `createEndpointCommands(spec, defineCommand)` 为适配器生成 `<adapter> endpoint` 的 **list / add / remove** 三个命令。除 email（smtp/imap 为嵌套对象，kv 无法表达）与 sandbox（内置调试适配器，无凭据）外，全部平台适配器均已接入：qq、icqq、napcat、onebot11、onebot12、milky、satori、slack、telegram、discord、kook、lark、dingtalk、line、wecom、wechat-mp、weixin-ilink、github。

- `<adapter> endpoint list`：运行中的 endpoints（adapter `create()` 注册的 runtime state）+ `zhin.config.yml` 里 `plugins.<adapterKey>.endpoints` 的配置清单。
- `<adapter> endpoint add <name> <key=value...>`：手动录入字段。`env: true` 的凭据字段值写入 `.env`（键名派生为 `<ADAPTER>_<NAME>_<FIELD>` 大写，如 `TELEGRAM_BOT1_TOKEN`、`SLACK_BOT1_SIGNING_SECRET`），yaml 中保存 `${REF}` 引用；其余字段内联写入。yaml 用 Document 节点级操作，保留既有注释；重名拒绝；`add`/`remove` 都走上面的 master 门禁。
- `<adapter> endpoint remove <name>`：从配置移除（重启生效，`.env` 键保留待手动清理）。
- 特殊 add 流程（如 QQ 扫码绑定）经 `spec.bindFlow` 钩子接管 add 命令；QQ 因此多出第四个命令 `qq endpoint cancel`。

接入一个适配器只需四步（以 telegram 为例）：

```ts
// 1. src/telegram-runtime-state.ts —— 运行中 endpoint 注册表 token
export const telegramRuntimeStateToken = defineEndpointRuntimeStateToken('telegram');

// 2. plugin.ts setup() —— provide 状态；adapters/telegram.ts create() 里登记
context.resources.provide(telegramRuntimeStateToken, createEndpointRuntimeState());
// create(): context.use(telegramRuntimeStateToken).endpoints.set(config.name, { name: config.name, mode: config.mode });

// 3. src/telegram-endpoint-commands.ts —— 生成命令（defineCommand 由适配器侧注入，
//    provider 包之间禁止互相 import）
export const telegramEndpointCommands = createEndpointCommands({
  adapterKey: 'telegram',          // = zhin.config.yml 的 plugins.<key>
  adapterDisplayName: 'Telegram',
  fields: [{ key: 'token', required: true, env: true, description: 'Telegram bot token' }],
  running: (use) => use(telegramRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `token: ${String(entry.token)}`,
}, defineCommand);

// 4. commands/endpoint/{list.ts, add/[name:string].ts, remove/[name:string].ts}
export default telegramEndpointCommands.list; // / .add / .remove
```

`fields` 与该适配器 `schema.json` 的 `endpoints.items.properties` 对齐；`add` 的 kv 参数走 `args`（最长前缀匹配后剩余的词），值含 `=` 时按首个 `=` 切分。

## commandPrefix 适配器配置

默认无前缀：任意文本都会尝试按命令匹配。给适配器实例配置 `commandPrefix` 后，只有以前缀开头的消息才进入命令匹配：

```yaml
plugins:
  qq:
    commandPrefix: '/'     # 仅 "/qq endpoint list" 触发
    endpoints:
      - name: main
        commandPrefix: ''  # endpoints[i] 可逐项覆盖顶层
```

解析规则（`packages/im/core/src/plugin-runtime/im/message-dispatcher.ts`）：按消息所属适配器实例读 `commandPrefix`（默认 `''`）；实例声明了 `endpoints` 数组时，按消息的来源 endpoint 名找 entry，`entry.commandPrefix` 覆盖顶层。前缀剥离后再做命令匹配；不匹配前缀的消息落入未命中路径（如 AI 对话）。

## 排错提示

`description` 会出现在命令清单里，建议都写。命令名冲突（同名静态命令或同形动态路由）在启动期抛错，改配置时启动一次就能尽早发现。返回 `Promise` 的命令可以做多轮交互——先 resolve 首条回复，后续用 `input.$reply` 追加，参考 `qq endpoint add` 的扫码绑定流程。
