---
title: "definePlugin"
description: "插件入口 plugin.ts 的写法：起名、声明配置、在 setup 里使用数据库、定时任务、主动推送、AI 工具，并在热重载时正确清理"
---

# definePlugin：插件入口

每个插件的 `plugin.ts` 都默认导出一个 `definePlugin({ ... })`。它做三件事：**给插件起名**、**声明配置**、**在 `setup` 里准备运行时资源**（数据库表、定时任务、主动推送等）。

单个命令、中间件、组件通常放在[约定目录](./conventions.md)里，不必写进入口。本页讲的是入口本身能做什么。

## 最小写法

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
});
```

`name` 是唯一必填项，只能包含小写字母、数字和连字符，且以字母开头。只有约定目录、没有初始化逻辑的插件，入口就这么简单。

需要在启动时做事，就加上 `setup`：

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  metadata: { displayName: '我的插件', icon: 'Blocks' }, // Console 插件卡片上显示
  async setup(context) {
    const config = context.config.get();
    // ……准备资源
    return () => {
      // 插件卸载或热重载前执行：关闭定时器、连接等
    };
  },
});
```

## 写在 setup 里，还是放进约定目录？

| 你要做的事 | 推荐写法 |
| --- | --- |
| 一个命令、中间件、组件、AI 工具 | 放进约定目录，一个文件一个能力。修改时只重载这一个文件 |
| 多个能力共用一个数据库表、客户端或定时任务 | 在 `setup` 里创建，再提供给各个能力 |
| 想用一个文件写完整个小 Bot | 在 `setup` 里用 `addCommand` 等快捷方法注册 |

同一个能力只选一种写法。`setup` 里注册的命令和 `commands/` 里的文件如果同名，启动时会报 `Duplicate Capability Slot`，而不是互相覆盖。

## 常见需求

### 在一个文件里注册命令和组件

`setup` 的参数上有 `addCommand`、`addComponent`、`addMiddleware`、`addHandler`、`addAdapter` 等快捷方法，与约定目录的效果完全相同：

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';
import { defineComponent } from 'zhin.js/component';

export default definePlugin({
  name: 'single-file-bot',
  setup({ addCommand, addComponent }) {
    addCommand('hello', defineCommand({
      description: 'Say hello',
      execute: () => 'Hello.',
    }));
    addComponent('status', defineComponent({
      render: () => 'online',
    }));
  },
});
```

代码变多后，把每个 definition 移到 `commands/hello/index.ts`、`components/status/index.tsx` 默认导出即可。拆开后，修改一个命令只会重载这个命令，而不是整个插件。

### 读取配置

最简单的方式是在插件根目录放一个 `schema.json`（标准 JSON Schema），然后在 `setup` 里读取：

```ts
setup(context) {
  const config = context.config.get(); // schema.json 的默认值 + zhin.config.yml 中的值
}
```

配置值写在 Bot 的 `zhin.config.yml` 中：你的 Bot 自身写在 `plugin:` 下，子插件写在 `<instanceKey>:` 下。完整示例见 [第一个插件](../getting-started/first-plugin.md) 的第 4、5 步。

想要配置自动带上 TypeScript 类型，可以改用内联 `config` 声明：

```ts
// plugin.ts
import { definePlugin, Schema } from 'zhin.js';

const configuration = Schema.object({
  interval: Schema.number().min(1).default(300).description('轮询间隔，秒'),
  apiKey: Schema.string().required().secret().component('password'),
  label: Schema.string(),
});

export default definePlugin({
  name: 'subscription',
  config: configuration,
  setup({ config }) {
    const { interval, apiKey, label } = config.get();
    // interval: number、apiKey: string、label: string | undefined
  },
});
```

- `.default()` 或 `.required()` 的字段在类型上一定存在，其余字段可选。
- `.secret()` 会让 Console 隐藏输入内容。密钥的值仍然写在 `zhin.config.yml` 里引用环境变量，例如 `apiKey: ${SUBSCRIPTION_API_KEY}`。
- `schema.json` 和内联 `config` 只能二选一，同时存在会拒绝启动，见下文 [选择配置来源](#choose-a-config-source)。

#### 选择配置来源 {#choose-a-config-source}

| | `schema.json`（`zhin new` 模板的默认写法） | 内联 `config: Schema...` |
| --- | --- | --- |
| 适用场景 | 只需要一份 JSON 配置契约；`isolated` 插件；希望不执行插件代码也能读到 Schema | trusted 插件，想让 `config.get()` 自动推导 TypeScript 类型，或使用 `.secret()`、`.component()`、`.effect('reload')` 等构建器 |
| Zhin 如何读取 | 直接读取包根目录的文件 | 配置预检时加载入口文件（不执行 `setup`），调用 `config.toJsonSchema()` |
| `isolated` 插件 | 唯一可用的方式 | 不可用，隔离进程会拒绝 |

两者**没有优先级**，Zhin 不会替你挑一个：

- trusted 插件同时有内联 `config` 和 `schema.json` 时，配置预检和启动都会失败，错误信息会列出入口文件和 `schema.json` 的路径。想保留带类型的内联 Schema，就删掉 `schema.json`；想保留 `schema.json`，就删掉 `definePlugin` 里的 `config`。
- `isolated` 插件的入口不会在宿主进程执行，宿主只读取 `schema.json`；入口里再写 `config` 会在隔离进程里报错。

`zhin new` 生成的插件只带 `schema.json`。改用内联 `config` 时先删掉 `schema.json`（也可以顺手从 `package.json#files` 里去掉它）。

更多规则见页尾 [配置声明细则](#配置声明细则)。

### 使用数据库

在 `zhin.config.yml` 里配置了 `database:` 后，插件可以定义自己的表：

```ts
// plugin.ts
import { databaseHostToken, definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'counter',
  setup(context) {
    if (!context.resources.has(databaseHostToken)) return; // 没配数据库时跳过
    const db = context.resources.use(databaseHostToken);
    db.define('counter', { /* 列定义 */ });
    const counter = db.models.get('counter'); // select / insert / update / delete / count
  },
});
```

表名只在本插件内有效，Zhin 会自动映射为不冲突的物理表名，插件之间互不可见。

`context.resources` 是插件取用框架能力的地方：先用 `has(token)` 判断是否可用，再用 `use(token)` 取出。如果插件**离开数据库就无法工作**，改用 `requires` 声明，缺失时直接拒绝启动：

```ts
export default definePlugin({
  name: 'counter',
  requires: [databaseHostToken],
  setup(context) {
    const db = context.resources.use(databaseHostToken); // 一定存在
  },
});
```

### 注册定时任务

```ts
// plugin.ts（setup 内）
import { scheduleHostToken } from 'zhin.js';

const schedule = context.resources.use(scheduleHostToken);
context.lifecycle.add(schedule.register({
  id: 'daily-report',
  cron: '0 0 9 * * *', // 秒 分 时 日 月 周：每天 9:00
  description: '每日早报',
  execute: () => sendReport(),
}));
```

`register` 返回一个取消函数，交给 `context.lifecycle.add(...)`，热重载时旧任务会被自动取消，不会重复执行。只需要一个定时任务、不需要和其他能力共享状态时，也可以放进 `schedules/<name>/index.ts` 约定目录。

### 主动发消息

不是回复用户、而是由插件主动推送（例如定时提醒）时，使用 `outboundHostToken`：

```ts
// plugin.ts（setup 内）
import { outboundHostToken } from 'zhin.js';

const outbound = context.resources.use(outboundHostToken);
await outbound.send({
  adapter: 'qq',
  endpointKey: 'my-bot',
  conversation: { kind: 'group', id: '123456' },
  content: '早上好！',
});
```

主动推送同样经过渲染、过滤和日志，不要直接调用平台 SDK 发消息。

### 给 AI 注册工具

```ts
// plugin.ts（setup 内）
import { defineAgentTool } from '@zhin.js/tool';

context.addTool('greet', defineAgentTool<{ name?: string }>({
  description: '按配置的问候语打招呼',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  execute: (input) => `${config.greeting}，${String(input.name ?? 'world')}！`,
}));
```

与 `tools/<name>/index.ts` 的效果相同；工具需要用到 `setup` 里创建的资源时才写在这里。详见 [Agent 工具](./agent-tools.md)。

### 在热重载时释放资源

保存文件后，Zhin 会先准备好新版本，再停掉旧版本。旧版本申请的资源必须由你释放，否则会越积越多。两种写法等价：

```ts
setup(context) {
  const timer = setInterval(poll, 60_000);
  context.lifecycle.add(() => clearInterval(timer)); // 写法一：随时登记
  return () => client.close();                       // 写法二：setup 返回清理函数
}
```

清理函数按登记的**逆序**执行。更多关于模块级变量、单例的注意事项见 [模块级状态](./module-state.md)。

### 把资源提供给自己的命令和工具

`setup` 里创建的服务可以用 `context.resources.provide(token, value)` 发布，同一插件的命令、工具再通过 `use(token)` 取用。参考 [lottery 插件](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery)：

```ts
// plugins/utils/lottery/plugin.ts（节选）
async setup(context) {
  const config = resolveLotteryConfig(context.config.get());
  const db = context.resources.has(databaseHostToken)
    ? context.resources.use(databaseHostToken)
    : createInMemoryLotteryDb();       // 没有数据库时退回内存实现
  if (context.resources.has(databaseHostToken)) {
    defineLotteryTables(db);
  }
  context.resources.provide(lotteryRuntimeToken, { db });
  context.addTool('lottery_sync', createLotterySyncTool());
}
```

## 参考

### setup 参数

| 成员 | 作用 |
| --- | --- |
| `plugin` | 当前插件实例的信息：`id`、`instanceKey`、`parent`、`root`、`role`（`'root'` 或 `'child'`） |
| `config` | `config.get()` 返回只读的配置 |
| `resources` | 取用和提供资源：`has(token)`、`use(token)`、`provide(token, value, dispose?)` |
| `lifecycle` | `lifecycle.add(dispose)` 登记清理函数，热重载或卸载时逆序执行 |
| `handoff` | 让自定义资源参与热重载切换，见下文「热重载交接」 |
| `addCommand` / `addComponent` / `addMiddleware` / `addHandler` / `addAdapter` | 注册对应能力，等价于约定目录 |
| `addTool` / `addSkill` / `addAgent` / `addMcp` | 注册 AI 相关能力（需安装 AI 能力） |
| `addFeature(feature, name, definition)` | 通用注册入口，上面的快捷方法都是它的类型化版本 |

### metadata 与 requires

| 字段 | 作用 |
| --- | --- |
| `metadata.displayName` / `icon` / `order` | Console 插件卡片的名称、图标、排序，不影响运行 |
| `requires` | 必须存在的资源 token 列表，缺失时拒绝启动 |

### 框架提供的资源（Host token）

除 `httpHostToken` 来自 `@zhin.js/host-http` 外，都从 `zhin.js` 导入。没有配置对应能力时 token 不存在，请先 `has()` 再 `use()`。

| token | 什么时候可用 | 主要方法 |
| --- | --- | --- |
| `databaseHostToken` | 配置了 `database:` | `define(name, columns)` 定义本插件的表；`models.get(name)` 读写（`select` / `insert` / `update` / `delete` / `count`） |
| `scheduleHostToken` | 始终可用 | `register(job)` 注册 6 段 cron（`秒 分 时 日 月 周`），返回取消函数；`list()` 列出本插件任务 |
| `outboundHostToken` | 有可用的适配器 | `send(input)` 主动推送，返回平台消息 id 或 `null`；部分平台支持 `addReaction` / `removeReaction` / `recall` |
| `htmlRendererToken` | 安装了 `@zhin.js/html-renderer` | `render(html, { width, format, backgroundColor })` 输出 PNG；未安装时应降级为纯文本 |
| `runtimeEventPublisherToken` | Bot 根插件，启用 Console 时 | `publish(type, data)` 向 Console 实时事件流广播 |
| `httpHostToken` | 启用了 HTTP 服务 | `route(method, path, handler, meta?)` 注册 HTTP 路由；`ws(path).onConnection(cb)` 注册 WebSocket |

数据库和定时任务只暴露本插件私有的表名和任务 ID，不提供原始数据库连接或进程级控制。全部 token 见 [Host Token 总览](./host-tokens.md)。

## 深入

### 配置声明细则

::: details 展开
- 插件配置的根必须是对象；没有任何字段时可以省略 `properties`，`{}` 也合法。
- `toJsonSchema()` 导出标准 JSON Schema；`toJSON()` 是内部序列化格式，两者用途不同。
- `.secret()` 导出 `writeOnly: true` 与 `x-zhin-config.secret` 提示，并禁止为密钥设置默认值；它不会读取环境变量，也不授予任何权限。
- 描述、选项、隐藏字段、组件类型与 `.effect('reload')` 都写在同一个 Schema 上，Console 从运行时读取。
- Console 表单支持基础的嵌套对象、列表和字典。`union`、`intersect`、`tuple` 与 `$ref` 能导出标准校验，但完整的表单编辑尚未支持，Console 会明确报错。
- 联合类型的默认值写在联合字段上：`Schema.union([...]).default(...)`。分支内部的默认值无法在校验时消歧，导出时会被拒绝；直接作为选项的 `Schema.const(...)` 可以使用。默认值会与所有结构匹配的分支比对，任一匹配密钥分支就拒绝导出；Zhin 不根据范围、步长或选项推断分支，无法排除时保守拒绝。
- 入口文件在配置预检阶段就会被加载（此时不执行 `setup`），所以入口顶层只做定义，把副作用放进 `setup`。预检时 Zhin 会复制并冻结 Schema 元数据，之后再修改构建器不会生效。
- `isolated` 插件只能使用 `schema.json`。插件配置变更只重载该插件，非法的新配置不会替换旧配置。

真实示例：[复读机](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/src/config.ts) 集中声明带范围的默认值；[短网址](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/plugin.ts) 声明无业务配置并拒绝未知字段。
:::

### 资源查找规则

`resources` 是一条父子链：`use(token)` 先查当前插件，找不到就逐级查父插件，整条链都没有则抛出 `Missing resource`。可选能力一律先 `has()` 再 `use()`。

### 热重载交接

热重载是一次整体切换：新版本的所有准备工作都成功后才会替换旧版本，在那之前旧版本一直在服务。如果你的资源**必须连接成功**才能允许切换，用 `context.handoff.add` 登记：

```ts
context.handoff.add({
  activateNext: (signal) => client.connect({ signal }), // 新版本就绪前调用，需支持取消
  deactivateNext: () => client.close(),                 // 切换失败时回滚
});
```

Zhin 内部把每个版本称为一个 generation，详见 [Generation 生命周期](../concepts/generation-lifecycle.md)。

### 自定义快捷方法

自定义 Feature 可以在 provider 的 `authoring.setupMethod` 声明自己的快捷方法名（必须是 `addXxx` 形式），Zhin 会在运行时安装；TypeScript 类型由该 Feature 对 `PluginSetupContext` 做模块扩展。Zhin 不维护快捷方法的白名单。

### package.json 的 zhin 字段

插件和 Feature 包都用 `package.json` 顶层的 `zhin` 字段声明清单。清单在启动时被严格校验，任何字段不合法都会抛出 `ManifestValidationError`。

```jsonc
{
  "zhin": {
    "protocol": 1,                    // 必填，目前恒为 1
    "type": "plugin",                 // 必填："plugin" | "feature"
    "entry": "./plugin.js",           // 必填：发布包使用 JS；本地私有 Root 可直接用 ./plugin.ts
    "engine": "^1.0.0",               // 可选：要求的 Zhin 运行时版本
    "runtime": "trusted",             // 可选（仅 plugin）："trusted"（默认）| "isolated"
    "platformFeatures": true,         // 可选（仅 plugin）：默认 true，Root 自动获得官方 Stable Features
    "features": [                     // 可选（仅 plugin）：依赖的 Feature 包
      { "package": "@zhin.js/command", "api": "^1.0.0", "optional": false }
    ],
    "plugins": [                      // 可选（仅 plugin）：挂载的子插件实例
      { "package": "@zhin.js/adapter-icqq", "instanceKey": "icqq" }
    ]
  }
}
```

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `protocol` | 是 | 清单协议版本，当前必须为 `1` |
| `type` | 是 | `plugin`（普通插件，可挂载子插件）或 `feature`（提供一类能力的平台包） |
| `entry` | 是（或用 `exports["./zhin"]`） | 入口文件，包内相对路径，`./` 开头且不得含 `..`；省略时读取 `exports["./zhin"]`，见下文 |
| `engine` | 否 | semver 范围，与运行时版本不匹配时拒绝加载 |
| `runtime` | 否 | `isolated` 表示在隔离环境中运行：仅限子插件、不能挂载 Host Feature，且需要隔离适配器支持 |
| `platformFeatures` | 否 | 默认 `true`：Root 插件即使不声明，也会获得官方 Stable Features |
| `features` | 否 | 依赖的 Feature 包。`package` 可以是 npm 包名或 `./` 相对路径；`api` 是对其 `featureApi` 的版本要求；`optional` 表示缺失时可降级 |
| `plugins` | 否 | 挂载的子插件。`instanceKey` **必填**，匹配 `^[a-z0-9][a-z0-9-]*$`，是配置段的键；同一包挂多个实例就用不同的 `instanceKey` |

`type: "feature"` 的包只有 `protocol` / `type` / `entry` / `engine` / `featureApi` 五个字段，`featureApi` 声明它实现的 API 版本，供使用方的 `features[].api` 校验。

### 用 exports 声明入口 {#exports-zhin}

也可以不写 `zhin.entry`，改用标准的 `exports["./zhin"]` 声明运行时入口；`zhin` 字段仍然要有，用来放 `protocol`、`type` 等 zhin 自己的元数据：

```jsonc
{
  "exports": {
    ".": { "types": "./lib/index.d.ts", "import": "./lib/index.js" },   // 库 API（可选）
    "./zhin": { "types": "./plugin.d.ts", "import": "./plugin.js" }     // 运行时入口
  },
  "zhin": { "protocol": 1, "type": "plugin" }
}
```

规则：

- `exports["./zhin"]` 是字符串时直接使用；是条件对象时依次取 `zhin`、`import`、`default`（嵌套条件同样处理），`types`、`require` 等其他条件忽略；是数组时取第一个能选出路径的元素。
- 选出的路径与 `zhin.entry` 同样校验：`./` 开头、不得含 `..`；本地与 `node_modules` 来源的 `.ts` / `.js` 互换规则也一样（见下一节）。
- **同时写了 `zhin.entry` 和 `exports["./zhin"]` 时以 `zhin.entry` 为准。** `zhin.entry` 继续完整支持，没有弃用计划；两种写法任选其一。
- 想让运行时用另一份文件而不影响其他工具时，可以加 `zhin` 条件：`{ "zhin": "./plugin.js", "import": "./lib/plugin.js" }`。

### 开发入口与 npm 发布入口

本地项目和 workspace 内的私有插件可以把 `zhin.entry` 写成 `./plugin.ts`，直接运行源码并热重载。发布到 npm 的插件必须把入口声明为 `./plugin.js`，并把 `plugin.js`、约定目录生成的 JavaScript 和 `lib` 放进 `files`：

```jsonc
{
  "files": ["lib", "plugin.js", "commands", "middlewares"],
  "scripts": {
    "build": "tsc",
    "prepack": "pnpm run build && node ../../../scripts/build-plugin-runtime-entries.mjs",
    "postpack": "node ../../../scripts/build-plugin-runtime-entries.mjs --clean"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.js"
  }
}
```

仓库内的官方插件在 `prepack` 中用 `build-plugin-runtime-entries.mjs` 把 `plugin.ts` 和约定目录里的 TypeScript 编译成同目录的 JavaScript，并把指向 `src/` 的导入改写到 `lib/`；打包后 `postpack --clean` 清除这些生成文件。普通 `build` 不生成它们，所以 workspace 内的测试和热重载始终使用 TypeScript 源码；从 `node_modules` 加载时则使用发布包里的 JavaScript。完整发布流程见 [插件完整交付](./plugin-delivery.md)。

## 真实示例

- [capabilities-bot](https://github.com/zhinjs/zhin/tree/main/examples/capabilities-bot)：一个 `setup()` 用到数据库、定时任务、AI 工具、主动推送和热重载交接，每一项都带 `has()` 降级。
- [lottery](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery)：优先使用数据库、没有时退回内存；用自定义 token 共享服务；工具放在约定目录；定时驱动每日流程。

## 下一步

- [约定目录](./conventions.md)：每种能力放在哪个目录、怎么命名。
- [命令](./commands.md)：参数、选项、权限与帮助。
- [模块级状态](./module-state.md)：哪些变量可以放在模块顶层，哪些必须放进 `setup`。
