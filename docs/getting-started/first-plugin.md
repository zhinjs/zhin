# 编写第一个插件

想先看「一个文件就够」？仓库 [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) 用 `setup({ addCommand })` 注册命令，没有 `commands/` 目录——跑通再回来拆文件。

下面为已接通 Sandbox 的应用添加一个 `ping-pong` **约定目录**插件。新项目先运行 `pnpm create zhin-app my-bot -y`，进入 `my-bot`；仓库贡献者可使用 [minimal-bot](../examples/index.md#minimal-bot-stable-最小路径)。

在应用的 `plugins/ping-pong/` 下创建四个文件，再在宿主清单里挂载。配置文件属于宿主，不必给每个子插件单独创建。

源码 TypeScript 项目要求 Node.js ≥22.12.0 和 pnpm 9+，`pnpm dev` 由 CLI 准备 TypeScript 加载。编译后的 JavaScript 库仍支持 Node.js `^20.19.0 || >=22.12.0`。

最终目录结构：

```text
ping-pong/
├── package.json      # zhin 清单（拓扑事实来源）
├── plugin.ts         # definePlugin 入口
├── schema.json       # 配置契约（默认值 + 校验）
├── commands/
│   └── ping/
│       └── index.ts  # /ping 命令
└── zhin.config.yml   # 可选：仅插件自己作为应用时需要
```

## 1. package.json 与 zhin 清单

```json
{
  "name": "ping-pong",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "zhin runtime start"
  },
  "dependencies": {
    "@zhin.js/command": "^1.1.0",
    "zhin.js": "^1.1.0"
  },
  "devDependencies": {
    "@zhin.js/cli": "^1.1.0"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [
      { "package": "@zhin.js/command", "api": "^1.0.0" }
    ],
    "plugins": []
  }
}
```

`zhin` 字段是插件拓扑的清单：

| 字段 | 含义 |
|------|------|
| `entry` | 插件入口文件，必须是 `./` 开头的包内相对路径 |
| `runtime` | `trusted`（主进程内运行） |
| `features` | 子插件需要显式声明使用的 Feature；本例挂载 Command 来发现 `commands/`。Root 应用依赖 `zhin.js` 时默认继承 Stable Features，这不会替子插件声明能力 |
| `plugins` | 挂载的子插件实例（本例为空，见第 5 节挂载方式） |

## 2. plugin.ts

```ts
import { definePlugin } from 'zhin.js';

interface PingPongConfig {
  reply: string;
}

export default definePlugin<PingPongConfig>({
  name: 'ping-pong',
  // Console 插件卡片展示
  metadata: { displayName: 'Ping Pong', icon: 'Blocks' },

  async setup(context) {
    // 配置视图：schema.json 提供默认值，zhin.config.yml 覆盖
    const config = context.config.get();
    console.log(`[ping-pong] setup: reply=${config.reply}`);

    // 可选：返回 Dispose，在 generation 结束时执行（热重载安全）
    return () => console.log('[ping-pong] disposed');
  },
});
```

## 3. commands/ping/index.ts

Command Feature 发现 `commands/**/index.ts`，目录路径决定命令名。本例的路径是 `ping`；同目录的其他文件只作为 helper，不会注册命令：

```ts
import { defineCommand } from 'zhin.js/command';

interface PingPongConfig {
  reply: string;
}

export default defineCommand<PingPongConfig>({
  description: '回复配置的文案',
  execute({ config }) {
    return config.reply;
  },
});
```

命令的 `config` 与 `setup` 里 `context.config.get()` 是同一份分层配置。

## 4. schema.json 与配置

`schema.json`（JSON Schema 2020-12）声明配置契约与默认值：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "reply": {
      "type": "string",
      "default": "pong",
      "description": "/ping 命令的回复内容"
    }
  }
}
```

配置注入是**分层**的：Root 插件读 `zhin.config.yml` 的 `plugin:` 段，
子插件实例读 `plugins.<instanceKey>` 段。

## 5. 挂载到应用

### 方式 A：`./` 本地目录子插件（推荐开发期）

先安装这个本地包声明的依赖；宿主安装 `zhin.js` 不会自动安装尚未作为依赖包挂载的本地目录的依赖：

```bash
cd plugins/ping-pong
pnpm install
cd ../..
```

在宿主应用的 `package.json#zhin.plugins` 里以 `./` 相对路径引用（不允许 `..` 越出包根）：

```json
{
  "zhin": {
    "plugins": [
      { "package": "./plugins/ping-pong", "instanceKey": "ping-pong" }
    ]
  }
}
```

然后在宿主的 `zhin.config.yml` 给这个实例传配置：

```yaml
plugins:
  ping-pong:
    reply: pong!
```

`instanceKey` 规则：小写字母 / 数字 / 连字符（`^[a-z0-9][a-z0-9-]*$`）。

### 方式 B：插件即应用

把 `zhin.config.yml` 直接放进插件目录，插件自己就是 Root。此时还需接入适配器；只有 Command 的插件可以装配，但不能凭空收到聊天消息：

```yaml
# ping-pong/zhin.config.yml
plugin:
  reply: pong!

plugins: {}
```

```bash
cd plugins/ping-pong # 从宿主应用目录进入
pnpm install
pnpm exec zhin setup --adapters  # 选择 Sandbox 等适配器，添加 Endpoint
pnpm dev        # zhin runtime start
```

## 6. 启动与验证

```bash
pnpm dev
```

- 启动日志应出现 `[ping-pong] setup: reply=pong!`
- 在宿主已经接通的 Sandbox 或其他通道里发 `/ping`，Bot 回复 `pong!`（`/` 取决于该 Endpoint 的 `commandPrefix` 配置）
- 改 `commands/ping/index.ts` 或 `zhin.config.yml` 会触发热重载，无需重启进程
- `zhin runtime start --once` 可做装配冒烟（不进入交互）

```mermaid
flowchart TD
  M[package.json#zhin 清单] --> R[Plugin Runtime]
  R --> F[Command Feature]
  F -->|发现| C[commands/ping/index.ts]
  R --> E[plugin.ts setup]
  S[schema.json 默认值] --> CFG[分层配置]
  Y[zhin.config.yml 覆盖] --> CFG
  CFG --> E
  CFG --> C
```

## 下一步

- [示例速览](../examples/index.md)：先使用 single-file-bot / minimal-bot，再按需查看数据库、定时任务、Agent 工具与主动出站示例
- 更深一层的插件能力（Host Resources、lifecycle、handoff）见 [插件模型](../concepts/plugin-model.md)
