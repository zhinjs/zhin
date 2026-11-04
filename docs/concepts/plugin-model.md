---
title: "插件模型"
description: "插件是什么、插件树如何组成、Plugin 与 Feature 的区别、instanceKey 与同一插件挂载多次、插件即应用"
---

# 插件模型

两个 QQ 账号接进同一个 Bot，或者把一个游戏插件拆出去单独发布——在 zhin.js 里这两件事用同一个机制解决：插件树。插件就是一个普通的 npm 包，区别只在 `package.json` 里多了一个 `zhin` 字段；Root 应用在 `zhin.config.yml` 的 `plugins` 中声明“实例名 → 包”，业务参数放在顶层同名块，`disable_plugins` 负责停用。首版扁平配置只支持直接实例；旧包清单挂载需先[迁移](../migrations/plugin-instance-declarations.md)。

## 核心规则

| 规则 | 例子 |
| --- | --- |
| 插件 = npm 包 + `package.json` 里的 `zhin` 字段 + `plugin.ts` 入口 | 你的项目本身就是 Root 插件 |
| 主配置 `plugins` 映射实例名到包 | `qq: "@zhin.js/adapter-qq"` |
| `instanceKey` 决定子插件读取哪段配置 | `zhin.config.yml` 顶层的 `qq:` |
| 同一个包可以挂载多次，各自独立配置 | 两个 `instanceKey` 挂两份同一个游戏插件 |
| 任何插件放一个 `zhin.config.yml` 就能作为独立应用启动 | 单独开发、调试一个插件 |
| **Feature** 是负责"扫描约定目录"的特殊包，普通插件不需要写 | `@zhin.js/command` 扫描 `commands/` |

## `package.json` 的 `zhin` 字段

以 `examples/minimal-bot/package.json` 为例：

```json
{
  "name": "minimal-bot",
  "type": "module",
  "dependencies": {
    "zhin.js": "workspace:*"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [],
    "plugins": []
  }
}
```

字段由 `@zhin.js/runtime` 的 manifest 解析器（`packages/im/runtime/src/manifest.ts`）严格校验，任何字段不合法都会抛出 `ManifestValidationError` 并列出全部问题。解析完成后，`package-contract` 模块校验当前 engine 与 Feature API 的 semver 契约，违反契约时抛出 `PackageContractError`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `protocol` | 必须为 `1` | 清单协议版本 |
| `type` | `"plugin"` 或 `"feature"` | 见下文「Plugin 与 Feature」 |
| `entry` | 字符串 | 插件入口，必须以 `./` 开头的包内相对路径，不允许 `..` 逃逸包根 |
| `engine` | 字符串，可选 | 引擎版本约束，如 `"^1.0.0"` |
| `runtime` | `"trusted"` 或 `"isolated"`，可选 | 是否以隔离运行时加载该插件 |
| `platformFeatures` | 布尔，可选 | 默认 `true`；Root 是否继承平台 Stable Features（见下文「platformFeatures 继承」） |
| `features` | 数组 | 本包依赖的 Feature 能力包：`{ "package": "...", "api": "^1.0.0", "optional": false }` |
| `metadata` | 对象，可选 | 静态 displayName/icon；同字段不得再在代码 metadata 重复声明 |

应用实例只由主配置 `plugins` 包映射创建。Root 旧 `zhin.plugins` 非空会要求迁移；依赖包的历史挂载不会自动创建实例。

`type: "feature"` 的包字段更少：`protocol` / `type` / `entry` / `engine` / `featureApi`。例如 `@zhin.js/adapter`：

```json
{
  "zhin": {
    "protocol": 1,
    "type": "feature",
    "entry": "./lib/provider.js",
    "engine": "^1.0.0",
    "featureApi": "2.0.0"
  }
}
```

示例项目是私有 workspace，因此可以直接以 `plugin.ts` 为入口并获得源码 HMR。可发布的 npm 插件必须声明 `./plugin.js`，且将该文件和约定目录的 JavaScript 产物放入发布包；Runtime 在 `node_modules` 中不会把 TypeScript 入口当作发布产物执行。官方插件的构建由 `scripts/build-plugin-runtime-entries.mjs` 完成。

## Plugin 与 Feature

- **Plugin** 是组装单元：它声明自己用哪些 Feature；应用主配置决定创建哪些实例，入口默认导出 `definePlugin({...})`（作者从 `zhin.js` 导入）。
- **Feature** 是能力类型：它定义"一类能力长什么样"（契约 + 发现约定 + 投影）。`@zhin.js/adapter` 定义了 Adapter 能力，`@zhin.js/command` 定义了命令能力，以此类推。

插件通过 `features` 数组声明依赖某类能力后，就可以按该 Feature 的约定提供能力实现。例如沙箱适配器插件（`@zhin.js/adapter-sandbox`）声明了 `@zhin.js/adapter` 能力后，在包内 `adapters/` 目录放置约定式入口：

```ts
// plugins/adapters/sandbox/adapters/sandbox/index.ts
import { defineAdapter } from 'zhin.js/adapter';
import { SandboxAdapter } from '../../src/adapter.js';
import type { SandboxEndpointConfig } from '../../src/protocol.js';

export default defineAdapter<SandboxEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  createAdapter: context => new SandboxAdapter(context),
});
```

## instanceKey：插件在树上的名字

同一个插件包可以挂多次（比如两个 QQ 账号用同一个适配器包的两个实例），区分它们靠 `instanceKey`。命名规则是 `/^[a-z0-9][a-z0-9-]*$/`（小写字母数字加连字符）。它同时决定两件事：PluginId——`root` 的孩子 `sandbox` 的 id 是 `root/sandbox`，再往下依次拼接；以及配置命名空间——该实例的配置写在 `zhin.config.yml` 的 顶层 `<instanceKey>` 下（见 [配置即数据](./config-as-data.md)）。

```yaml
# Root zhin.config.yml
configVersion: 2
plugins:
  sandbox: '@zhin.js/adapter-sandbox'
  icqq: '@zhin.js/adapter-icqq'
disable_plugins:
  - icqq
sandbox:
  endpoints:
    - id: dev
```

重复实例键明确报错；不存在覆盖或继承产生的隐藏实例。

## 实例包引用的两种来源

主配置 `plugins.<instanceKey>` 支持两种写法（由应用声明解析器校验）：

1. **npm 包名**：`"@zhin.js/adapter-icqq"`。包必须是本包的依赖。
2. **本地相对路径**：`"./plugins/my-local-plugin"`。以 `./` 开头、指向包内目录（monorepo 里放私有插件的常见做法），不允许包含 `..` 逃逸包根。

`features[i].package` 同理支持两种来源。

## 插件即 Root：每个积木都能独立跑

"Root Plugin"不是特殊类型——任何一个 `type: "plugin"` 的包都可以作为 Root 独立启动。在包目录下执行：

```bash
zhin runtime start
```

CLI 会以当前目录为项目根，读取包契约和 `configVersion: 2` 主配置后启动。首版应用声明只创建 Root 的直接实例，不隐式挂载依赖包中的历史子插件。这意味着：开发一个游戏插件时，你可以直接在插件目录里启动它自测，不需要先装进某个 Bot 项目。`examples/minimal-bot` 就是一个 Root Plugin 的最小完整形态。

## platformFeatures：Root 继承的平台 Features

`@zhin.js/core` 在自己的 manifest 里声明了五个 Stable Features：

```json
"features": [
  { "package": "@zhin.js/adapter",     "api": "^2.0.0" },
  { "package": "@zhin.js/command",     "api": "^1.0.0" },
  { "package": "@zhin.js/component",   "api": "^1.0.0" },
  { "package": "@zhin.js/middleware",  "api": "^1.0.0" },
  { "package": "@zhin.js/handler",     "api": "^1.0.0" }
]
```

当 Root Plugin 依赖了 `@zhin.js/core`（或依赖 `zhin.js` 门面，后者依赖 core）时，即使自己的 `features` 数组为空，也会**自动继承**这些 Feature——适配器、命令、组件、中间件、Handler 开箱可用。合并规则：用户显式声明的同包引用优先（可用于锁定版本或覆盖），其余自动补齐。

在 Root 的 manifest 里设 `"platformFeatures": false` 可以关闭这套继承（比如做一个刻意不含命令系统的 Root）。

## setup 上下文

插件入口 `definePlugin({ setup(context) {...} })` 拿到的 `PluginSetupContext`：

| 字段 | 说明 |
|------|------|
| `plugin` | 实例视图：id、instanceKey、parent、root、角色（root/child） |
| `config` | `ConfigView`，`get()` 返回按本插件 schema 投影的配置（见 [配置即数据](./config-as-data.md)） |
| `resources` | 本插件作用域的资源 Scope |
| `lifecycle` | `DisposeStack`：注册的资源在 generation 结束时自动反注册（见 [generation 与生命周期](./generation-lifecycle.md)） |
| `handoff` | generation 交接的参与入口 |
| `addFeature` | setup 内声明 Capability 的通用入口；对应 Feature 包会扩展 `addCommand` / `addComponent` / `addMiddleware` / `addHandler` / `addAdapter` / `addAgent` / `addSkill` / `addTool` / `addMcp` |

`setup` 可同步/异步返回一个 `Dispose`，或直接往 `lifecycle` 里挂清理函数。
setup 注册与约定目录发现进入同一个 Feature projection；前者适合单文件 Bot，后者适合
规模化组织与文件级局部 HMR。
