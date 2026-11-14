---
title: "definePlugin"
description: "插件入口 plugin.ts 的写法：起名、声明配置、在 setup 里使用数据库、定时任务、主动推送、AI 工具，并在热重载时正确清理"
---

# definePlugin：插件入口

插件的 `plugin.ts`（如果有）默认导出一个 `definePlugin({ ... })`。它做三件事：**给插件起名**、**声明配置**、**在 `setup` 里准备运行时资源**（数据库表、定时任务、主动推送等）。

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

### 不写 plugin.ts {#entryless-plugin}

如果插件只有约定目录，`plugin.ts` 也可以省略。最小的插件只需要两个文件：

```text
my-plugin/
├── package.json          # "zhin": { "protocol": 1, "type": "plugin" }，不写 entry 和 features
└── commands/demo/index.ts
```

`package.json#zhin` 里既没有 `entry`、也没有 `exports["./zhin"]` 时，运行时把它当作 `export default definePlugin({ name })` 装配：没有 `setup`，约定目录照常从**包根目录**发现。

- **插件名**取包名去掉 scope 后的部分：`@scope/foo` → `foo`，`foo` → `foo`。不会去掉 `zhin-plugin-` 之类的前缀。
- 这个名字同样要满足 `/^[a-z][a-z0-9-]*$/`。不满足（例如 `zhin.js-foo` 含有 `.`）时启动报错，提示你添加带显式 `name` 的 `plugin.ts`。
- `displayName`、`displayNameI18n`、`icon` 写在 `zhin.metadata` 里。
- 只要声明了 `entry`（或 `exports["./zhin"]`），它就必须存在；只有两者都省略才是无入口插件。目录里有 `plugin.ts` 但没声明入口时，它不会被加载，`zhin plugin check` 会给出警告。
- 需要 `setup`、内联 `config`、`requires` 或 `capabilityGraph` 时，再添加 `plugin.ts` 并声明 `zhin.entry`。

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
- `definePlugin({ config: Schema.object(...) })` 开箱即支持运行时校验与默认值填充；如果你同时为 IDE / Console 元数据生成了结构完全一致的 `schema.json`，运行时会自动比对并放行，不会报冲突错误（只有结构不一致时才会拒绝启动）。详见下文 [选择配置来源](#choose-a-config-source)。

#### 选择配置来源 {#choose-a-config-source}

| | `schema.json`（`zhin new` 模板的默认写法） | 内联 `config: Schema...` |
| --- | --- | --- |
| 适用场景 | 只需要一份 JSON 配置契约；`isolated` 插件；希望不执行插件代码也能读到 Schema | trusted 插件，想让 `config.get()` 自动推导 TypeScript 类型，或使用 `.secret()`、`.component()`、`.effect('reload')` 等构建器 |
| Zhin 如何读取 | 直接读取包根目录的文件 | 配置预检时加载入口文件（不执行 `setup`），调用 `config.toJsonSchema()` |
| `isolated` 插件 | 唯一可用的方式 | 不可用，隔离进程会拒绝 |

两者的共存规则：

- trusted 插件可以直接只写 `definePlugin({ config: Schema.object(...) })`；若同时保留了由同一 Schema 生成、结构等价的 `schema.json`，运行时会验证二者等价并正常启动。若两份 Schema 结构不一致，配置预检和启动都会失败，错误信息会列出入口文件和 `schema.json` 的路径。
- `isolated` 插件的入口不会在宿主进程执行，宿主只读取 `schema.json`；入口里再写 `config` 会在隔离进程里报错。

`zhin new` 生成的插件默认带 `schema.json`。改用内联 `config` 时可以直接删掉 `schema.json`，或保持两者同步。

更多规则见页尾 [配置声明细则](#配置声明细则)。

#### 按适配器 / 账号 / 会话覆盖配置 {#layered-config}

同一个插件可以在不同适配器实例、不同账号、不同群 / 私聊上用不同的设置（[ADR 0050](../adr/0050-layered-feature-config.md)、[ADR 0055](../adr/0055-conversation-feature-config.md)、[ADR 0057](../adr/0057-config-storage.md)）。层级从上到下是 `global`（配置文件里插件自己的配置块）< `adapter`（适配器实例别名，如 `qq`）< `endpoint`（`<别名>/<账号 id>`，如 `qq/bot-1`）< `conversation`（`<别名>/<账号 id>/<kind>:<会话 id>`，如 `qq/bot-1/group:123`）；全局以下三级存在项目数据库表 `feature_overrides` 里。

**1. 在 Schema 根上声明支持的层级。** 省略时等同 `["global"]`：只能写全局配置，覆盖里只能写启用开关。单个属性可以用同名关键字收窄（例如密钥只允许全局），但不能比根更宽，否则启动报错：

```json
{
  "type": "object",
  "x-zhin-config": { "levels": ["global", "adapter", "endpoint"] },
  "properties": {
    "maxItems": { "type": "integer", "minimum": 1, "default": 5 },
    "apiKey": { "type": "string", "x-zhin-config": { "levels": ["global"], "secret": true } }
  }
}
```

用内联 `config` 时，在 `toJsonSchema()` 的结果根上加同样的 `x-zhin-config.levels`；用 `Schema.object({...})` 声明时调用 `.featureLevels(levels, { conversationFields, selfServiceFields, chatAdminFields })`，单个属性用 `.fieldLevels(['global'])` 收窄（例如 `Schema.string().secret().fieldLevels(['global'])`）。

**会话层（ADR 0055）。** `levels` 可以包含 `"conversation"`，但必须同时包含 `"endpoint"`。会话层默认只能开关；要允许在会话层改字段，在根上列出 `conversationFields`；要允许群管理员在聊天里改（`功能 设置 …`），再列出 `selfServiceFields`（必须是 `conversationFields` 的子集）；聊天里在账号层及以上改字段默认也只允许 `selfServiceFields`，可用 `chatAdminFields` 放宽：

```json
{
  "type": "object",
  "x-zhin-config": {
    "levels": ["global", "adapter", "endpoint", "conversation"],
    "conversationFields": ["threshold", "cooldown"],
    "selfServiceFields": ["threshold"]
  },
  "properties": {
    "threshold": { "type": "integer", "minimum": 2, "default": 3 },
    "cooldown": { "type": "integer", "default": 30000 }
  }
}
```

- 列出的字段必须是插件自己的属性，且其 `levels` 允许会话层；不满足时启动报错。
- 没有配置 Schema 的插件也有会话层开关，但没有字段覆盖。
- 会话 id 写进键时转义 `%` → `%25`、`/` → `%2F`，其余字符原样（id 可以含 `:`），因此键里恰好两个 `/`。
- 会话层覆盖与适配器 / 账号层一样不在配置文件里，见下一步。

**2. 覆盖存在项目数据库里，由 Console 或聊天命令写入。** 每条覆盖是插件 Schema 的部分对象（只含该层级允许的字段），外加启用开关；由 Console 功能页（`feature.set-override` / `feature.set-enabled` / `feature.remove-override`）或群内自助命令（`功能 设置 / 开启 / 关闭 <插件> … [会话|账号|适配器]`）写入表 `feature_overrides`，写入后原地生效。配置文件的插件块里不能再写 `overrides`（旧项目首次启动时自动导入数据库并从配置文件删除，见[升级：功能覆盖迁入数据库](../migrations/feature-overrides.md)）。

- 字段自下而上合并：普通对象逐键深合并，数组和标量整体替换，`null` 表示“显式清空”（该字段不再继承上级的值）。
- 启用自上而下：只有上面所有层级都启用时某一层才能停用；任一上级停用后，下级全部锁定，既不能启用也不能改自己的开关（Console 返回 409 `locked`）。下级从不存「启用」：启用 = 删除该层开关。全局层的启停仍是 `disable_plugins`（改动后重启）。
- 指向未声明的适配器别名或账号的键会保留并给出警告，不报错，方便先写配置、后加账号。
- 存进数据库的字段补丁不做环境变量展开（`${VAR}` 原样保留）；聊天里不能写这类引用。
- 插件的 Schema 里不能声明名为 `overrides` 的属性（保留键）；插件自己的 `enabled` 字段不参与覆盖。
- 没有配置 Schema 的插件也能用三级启停开关。
- 项目数据库是 MongoDB、Redis 或内存方言时无法保存覆盖，写入会被拒绝。

**3. 在代码里读取有效配置。** `context.config` 仍是全局视图，不含 `overrides`：

```ts
setup(context) {
  const schedule = context.resources.use(scheduleHostToken);
  context.lifecycle.add(schedule.register({ id: 'push', cron: '0 */10 * * * *', async execute() {
    for (const target of targets) {
      // target 可以是消息、{ adapter: 'qq', endpointId: 'bot-1', conversation?: { kind: 'group', id: '123' } }、
      // 带 endpoint 的会话引用 { conversation: target }，或解析键 'qq/bot-1' / 'qq/bot-1/group:123'
      if (!context.isEnabledFor(target)) continue;
      const { maxItems } = context.configFor(target);
      // ...
    }
  } }));
}
```

`configFor(target)` 返回合并后冻结的有效配置，按“配置代次 + 覆盖存储版本 + 解析键（含会话）”缓存，任何一级覆盖写入时缓存失效，读到的总是最新生效的配置。target 是消息时解析到消息所在的会话层。改适配器 / 账号 / 会话层的覆盖或开关会原地生效：不重启、不重载插件，下一条消息就读到新值；改全局字段沿用字段自己的 `x-zhin-config.effect`。

**自动门禁：** 插件在某个账号或会话上被停用时，命令（含菜单）、中间件、带账号的消息与事件处理器、Agent 工具与技能披露都会按消息所在会话直接跳过，表现和插件不存在一样（命令不会回复“已禁用”）。定时任务、后台轮询等不经过消息的能力，需要像上例那样自己调用 `isEnabledFor`。

Console 的功能页通过 `feature.*` RPC（`feature.list` / `feature.matrix` / `feature.get` / `feature.set-override` / `feature.remove-override` / `feature.set-enabled` / `feature.conversations`）读写全局配置块与数据库里的三级覆盖。activity-feedback 现有的 `platforms` / `endpoints` 仍然兼容，新插件推荐声明 `x-zhin-config.levels`、改用分层覆盖。

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
| `configFor(target)` / `isEnabledFor(target)` | 某个适配器 / 账号 / 会话上的有效配置与启用状态，见 [按适配器 / 账号 / 会话覆盖配置](#layered-config) |
| `resources` | 取用和提供资源：`has(token)`、`use(token)`、`provide(token, value, dispose?)` |
| `lifecycle` | `lifecycle.add(dispose)` 登记清理函数，热重载或卸载时逆序执行 |
| `handoff` | 让自定义资源参与热重载切换，见下文「热重载交接」 |
| `addCommand` / `addComponent` / `addMiddleware` / `addHandler` / `addAdapter` | 注册对应能力，等价于约定目录 |
| `addTool` / `addSkill` / `addAgent` / `addMcp` | 注册 AI 相关能力（需安装 AI 能力） |
| `addFeature(feature, name, definition)` | 通用注册入口，上面的快捷方法都是它的类型化版本 |

### metadata、requires 与 capabilityGraph（显式能力图）

| 字段 | 作用 |
| --- | --- |
| `metadata.displayName` / `icon` / `order` | Console 插件卡片的名称、图标、排序，不影响运行 |
| `metadata.displayNameI18n` | 按 Console 界面语言显示的名称，如 `{ 'zh-CN': '复读机', en: 'Repeater' }`；见[语言与本地化](../configuration/localization.md#插件如何接入) |
| `requires` | 必须存在的资源 token 列表，缺失时拒绝启动 |
| `capabilityGraph` | 使用 `definePluginCapabilityGraph({ provides, injects, features })` 显式声明本插件的能力拓扑（对外提供的 token、注入的 token，以及按 feature 分组的能力项），供静态治理与 Console 可观测使用 |

```ts
// plugin.ts
import { databaseHostToken, definePlugin, definePluginCapabilityGraph } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  metadata: { displayName: '我的插件', icon: 'Blocks' },
  capabilityGraph: definePluginCapabilityGraph({
    injects: [databaseHostToken],
    features: {
      commands: ['hello'],
      pages: ['index'],
      tools: ['weather'],
    },
  }),
});
```

### 框架提供的资源（Host token）

除 `httpHostToken` 来自 `@zhin.js/host-http` 外，都从 `zhin.js` 导入。没有配置对应能力时 token 不存在，请先 `has()` 再 `use()`。

| token | 什么时候可用 | 主要方法 |
| --- | --- | --- |
| `databaseHostToken` | 配置了 `database:` | `define(name, columns)` 定义本插件的表；`models.get(name)` 读写（`select` / `insert` / `update` / `delete` / `count`） |
| `scheduleHostToken` | 始终可用 | `register(job)` 注册 6 段 cron（`秒 分 时 日 月 周`），返回取消函数；`list()` 列出本插件任务 |
| `outboundHostToken` | 有可用的适配器 | `send(input)` 主动推送，返回平台消息 id 或 `null`；部分平台支持 `addReaction` / `removeReaction` / `recall` |
| `htmlRendererToken` | 安装了 `@zhin.js/html-renderer` | `render(html, { width, format, backgroundColor })` 输出 PNG；未安装时应降级为纯文本 |
| `runtimeEventPublisherToken` | Bot 根插件，启用 Console 时 | `publish(type, data)` 向 Console 实时事件流广播 |
| `httpHostToken` | 启用了 HTTP 服务 | `route(method, path, (request, context) => Response, meta?)` 注册 HTTP 路由（Web 标准 `Request` / `Response`，见 [HTTP 路由契约](./host-tokens.md#http-路由契约)）；`ws(path).onConnection(connection => …)` 注册 WebSocket |

数据库和定时任务只暴露本插件私有的表名和任务 ID，不提供原始数据库连接或进程级控制。全部 token 见 [Host Token 总览](./host-tokens.md)。

## 深入

### 配置声明细则

::: details 展开
- 插件配置的根必须是对象；没有任何字段时可以省略 `properties`，`{}` 也合法。
- `toJsonSchema()` 导出标准 JSON Schema；`toJSON()` 是内部序列化格式，两者用途不同。
- `.secret()` 导出 `writeOnly: true` 与 `x-zhin-config.secret` 提示，并禁止为密钥设置默认值；它不会读取环境变量，也不授予任何权限。
- 描述、选项、隐藏字段、组件类型与 `.effect('reload')` 都写在同一个 Schema 上，Console 从运行时读取。字段在 Console 上显示的中英文标题与说明用 `.i18n({ 'zh-CN': { title }, en: { title, description } })` 声明（`schema.json` 中为 `x-i18n`），见[语言与本地化](../configuration/localization.md#插件如何接入)。
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

插件和 Feature 包都用 `package.json` 顶层的 `zhin` 字段声明自身的打包契约（`protocol`、`type`、`entry`、`features` 等）。清单在启动时被严格校验，任何字段不合法都会抛出 `ManifestValidationError`。

> 注意：`package.json#zhin` 只声明当前插件包自身的打包契约，**不**在 `package.json` 里挂载子插件实例。适配器（如 `icqq`）、子插件和服务实例统一在宿主项目的 `zhin.config.yml` 的 `plugins:` 下挂载。

```jsonc
{
  "zhin": {
    "protocol": 1,                    // 必填，目前恒为 1
    "type": "plugin",                 // 必填："plugin" | "feature"
    "entry": "./plugin.js",           // plugin 可省略（无入口插件）；发布包使用 JS；本地私有 Root 可直接用 ./plugin.ts
    "engine": "^1.0.0",               // 可选：要求的 Zhin 运行时版本
    "runtime": "trusted",             // 可选（仅 plugin）："trusted"（默认）| "isolated"
    "platformFeatures": true,         // 可选（仅 plugin）：默认 true，Root 自动获得官方 Stable Features
    "features": [                     // 可选（仅 plugin）：依赖的 Feature 包；省略时按约定目录推断
      { "package": "@zhin.js/command", "api": "^1.0.0", "optional": false }
    ]
  }
}
```

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `protocol` | 是 | 清单协议版本，当前必须为 `1` |
| `type` | 是 | `plugin`（普通插件包）或 `feature`（提供一类能力的平台包） |
| `entry` | feature 必填；plugin 可省略 | 入口文件，包内相对路径，`./` 开头且不得含 `..`；省略时读取 `exports["./zhin"]`，见下文。plugin 两者都省略时是[无入口插件](#entryless-plugin) |
| `engine` | 否 | semver 范围，与运行时版本不匹配时拒绝加载 |
| `runtime` | 否 | `isolated` 表示在隔离环境中运行：仅限子插件、不能挂载 Host Feature，且需要隔离适配器支持 |
| `platformFeatures` | 否 | 默认 `true`：Root 插件即使不声明，也会获得官方 Stable Features |
| `features` | 否 | 依赖的 Feature 包。`package` 可以是 npm 包名或 `./` 相对路径；`api` 是对其 `featureApi` 的版本要求；`optional` 表示缺失时可降级。省略时[按约定目录推断](#infer-features) |

`type: "feature"` 的包只有 `protocol` / `type` / `entry` / `engine` / `featureApi` 五个字段，`featureApi` 声明它实现的 API 版本，供使用方的 `features[].api` 校验。

插件真正必填的只有两项，最小清单是 `"zhin": { "protocol": 1, "type": "plugin" }`：入口可省略（[无入口插件](#entryless-plugin)），`features` 可省略（见下文推断）。

#### 由约定目录推断 features {#infer-features}

`zhin.features` 可以省略。省略时，运行时按插件包根目录下存在的约定目录推断要挂载的 Feature 包：

| 目录 | Feature 包 |
| --- | --- |
| `commands/` | `@zhin.js/command` |
| `components/` | `@zhin.js/component` |
| `middlewares/` | `@zhin.js/middleware` |
| `handlers/` | `@zhin.js/handler` |
| `schedules/` | `@zhin.js/schedule-feature` |
| `tools/` | `@zhin.js/tool` |
| `prompt-sections/` | `@zhin.js/prompt-section` |
| `hooks/` | `@zhin.js/hook-feature` |
| `mcps/` | `@zhin.js/mcp-feature` |
| `adapters/` | `@zhin.js/adapter` |
| `skills/` | `@zhin.js/skill` |
| `agents/` | `@zhin.js/agent-feature` |

这张表在 `@zhin.js/runtime` 里只有一份（`CONVENTION_FEATURE_PACKAGES`），`zhin plugin check`、`zhin create` 与仓库检查脚本都读它。

- **省略 `features`**：每个存在的目录都要求对应的 Feature 包。推断出的引用不带 `api` 范围，接受已安装的版本；包仍然要写进 `dependencies` / `peerDependencies`，找不到时与显式声明缺失一样报 `PackageResolutionError`，并在信息里写明是哪个目录推断出来的。
- **写了 `features`**（哪怕是 `[]`）：列表就是全部，不做推断，行为与以前完全一致。列表里的条目原样生效（保留 `api` 与 `optional`），没列出的目录不会挂载对应 Feature（`zhin plugin check` 会警告）。
- Root 从 `zhin.js` / `@zhin.js/core` 继承的 Stable Features 优先于推断；`platformFeatures` 的语义不变。
- `runtime: "isolated"` 的插件不做推断（隔离插件不能挂载 Host Feature）。
- 想**固定 `api` 范围**、把某个 Feature 标成 `optional`，或者 Feature 由同名之外的包（如 workspace 里的本地 Feature）提供时，显式写 `features`。
- 运行中新建一种约定目录时，推断结果在下一次读取清单时更新（修改 `package.json` 或重启）。

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
