# 10 分钟跑通第一个 Bot

本页带你从 0 到 1 跑起一个 Zhin Bot，并直接在项目里加上带参数的命令、跨平台 JSX 互动按钮卡片和 AI 工具（1 → 2 进阶）。整个过程不需要平台账号，也不需要模型 Key。

> 还不清楚 Zhin.js 是做什么的？先花 5 分钟读 [Zhin.js 是什么](./introduction.md)。

## 开始前

- 脚手架项目与编译后的 IM 库都需要 Node.js `>=22.19.0`（`@zhin.js/ai` 依赖的 undici 8 要求该版本）。
- pnpm 9 或更高版本。

## 1. 创建并启动

```bash
npm create zhin-app my-bot
cd my-bot
pnpm dev
```

终端只问三件事：项目语言、项目名称、初始化令牌（默认随机生成，回车确认）。生成的是最小项目——IM 核心 + Console Host，不含数据库驱动、适配器和 AI 依赖；数据库、平台和 AI 都留到 Console 里配置。创建结束时会打印启动命令和一条 Console 链接：

```text
✔ 项目已创建：my-bot
  启动：cd my-bot && pnpm dev
  然后打开 Console 完成初始化：
  https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=<初始化令牌>
```

令牌只放在 `#` 之后，不会发送到 console.zhin.dev 的服务器。`-y` 表示全部接受默认值、一个问题都不问。

`pnpm dev` 就是 `zhin start --foreground --watch source config`：前台启动**管理网关**，网关再拉起 **Zhin 实例**（你的 Bot）。网关监听 HTTP 端口、负责 Console 登录与初始化；实例跑插件和适配器，改代码会热重载。Ctrl+C 同时停止两者。不想占着终端时用 `npx zhin start`（后台运行），再用 `npx zhin status`、`npx zhin logs -f`、`npx zhin stop` 管理，见 [zhin start](../cli/runtime.md)。

::: tip 跳过 Console 里的适配器步骤
脚本或想直接试聊时，可以在创建时就装上 Sandbox（浏览器里的模拟聊天窗口）：`npm create zhin-app my-bot -- -y --adapter sandbox`。`--database`、`--adapter`、`--ai` 等参数的完整说明见 [create-zhin-app README](https://github.com/zhinjs/zhin/tree/main/packages/toolkit/create-zhin#参数详解)。
:::

## 2. 在 Console 里完成初始化

`pnpm dev` 启动后打开上面的链接（链接丢了就打开 [console.zhin.dev](https://console.zhin.dev)，API Base 填 `http://127.0.0.1:8068`，令牌填 `.env` 的 `HTTP_TOKEN`）。端口以终端输出或 `zhin.config.yml` 的 `http.port` 为准。Console 会依次引导：

1. **数据库**：保持默认 SQLite 即可（文件在 `.zhin/data.sqlite`）。
2. **所有者账号**：设置用户名和密码并登录；此后初始化令牌失效，日常用账号登录。
3. **AI**：这一页先跳过，之后再用 `npx zhin setup --ai` 或 Console 打开。
4. **适配器**：选 **Sandbox**，不需要任何平台账号。
5. **完成**：汇总后进入仪表盘。

每一步都可以跳过、以后从「功能」区再进入。每一步用什么凭据、需要什么权限见 [Console 初始化与引导](../console/onboarding.md)。

## 3. 发送 `/hello` 验证

任选以下一种方式：

- **方式 A：本地内置 Sandbox（最快）**
  直接在浏览器打开 `http://127.0.0.1:8068/sandbox`，输入 `/hello` 并发送，立即看到回复。
- **方式 B：Remote Console**
  打开侧栏「会话 → 沙盒」，发送 `/hello`。

收到回复即代表完整链路跑通：Sandbox 适配器收到入站消息 → 匹配到 `commands/hello` → 回复经统一出站链路发回。之后接入真实平台，只是在配置里挂载对应的适配器。

## 4. 认识刚生成的项目

想知道 Bot 当前加载了哪些指令？在会话中发送 **`/菜单`**（无命令前缀时发 `菜单`），会列出根插件的指令与子插件；某条指令的参数用法可通过 `/hello --help` 查看（详见[指令菜单](../authoring/commands.md#查看已加载的指令菜单)）。

```text
my-bot/
├── package.json          # Runtime 拓扑：entry、features
├── zhin.config.yml       # Host、挂载的插件实例（plugins）与各插件配置值
├── .env                  # token、平台凭据、模型 Key
├── plugin.ts             # 根插件入口
├── commands/             # 文件路径就是命令路由
├── components/           # 可复用消息组件
└── pages/                # 插件贡献的 Console 页面
```

记住两点就够了：

- **`package.json` 的 `zhin` 字段只描述插件自身入口与能力 Feature**（`entry`、`features`）；**`zhin.config.yml` 描述挂载了哪些插件以及怎么配**（`plugins`、端口、凭据、插件配置），密钥放 `.env`。
- **`my-bot` 本身就是一个 Root 插件**——放进 `commands/`、`components/`、`middlewares/`、`pages/` 等约定目录的文件会被自动发现并注册，不需要改 `package.json`，也不需要在 `plugin.ts` 里手写登记。

名词速查见 [核心概念速览](./concepts.md)。

## 5. 修改并观察热重载 —— 在你的 Bot 里直接加功能 (1→2) {#hot-reload}

打开 `commands/hello/index.ts`，修改返回文案并保存，再发 `/hello`——不用重启就能看到新回复。正在处理中的消息会用旧代码跑完；如果新代码有语法或运行错误，旧版本继续服务，终端会打印错误原因。

因为 `my-bot` 已经是 Root 插件，日常写业务功能**不需要新建子插件包**，直接在约定目录里加文件即可：

### ① 加一个带参数的命令（`commands/roll/index.ts`）

新建 `commands/roll/index.ts`，保存后在 Sandbox 发送 `/roll 20` 或 `/roll --help`：

```ts
// commands/roll/index.ts  →  /roll [sides]
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '掷一个指定面数的骰子',
  params: {
    sides: { type: 'integer', min: 2, max: 100, default: 6 },
  },
  execute: ({ params }) => `🎲 (1-${params.sides}) 掷出了：${1 + Math.floor(Math.random() * params.sides)}`,
});
```

### ② 加一个跨平台 JSX 互动卡片（`commands/card/index.tsx`）

新建 `commands/card/index.tsx`（注意 `.tsx` 扩展名）。支持按钮的平台直接渲染按钮，纯文本平台会自动降级为编号选项，点击或回复序号都会触发 `onClick`：

```tsx
// commands/card/index.tsx  →  /card
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '发送一张带互动按钮的卡片',
  execute: () => (
    <card title="⚡ 今日状态打卡">
      <text>选择你现在的状态：</text>
      <button label="🔥 状态拉满" onClick={(msg) => `${msg.$sender.name} 已打卡：状态拉满！`} />
      <button label="☕ 需要咖啡" onClick={(msg) => `${msg.$sender.name} 正在补充咖啡因…`} />
    </card>
  ),
});
```

### ③ 加一个给 AI 调用的工具（`tools/weather/index.ts`，可选）

如果你运行过 `npx zhin setup --ai` 启用了 AI，新建 `tools/weather/index.ts` 即可让大模型自动调用：

```ts
// tools/weather/index.ts
import { Schema } from 'zhin.js';
import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool<{ city: string }>({
  description: '查询城市实时天气',
  parameters: Schema.object({
    city: Schema.string().required().description('城市名称，例如上海'),
  }),
  requiresApproval: 'never',
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    return res.text();
  },
});
```

## 遇到问题

```bash
npx zhin doctor
```

Doctor 会检查 Node、pnpm、端口、`HTTP_TOKEN`、CORS 和项目清单。连接失败时先看终端打印的 API Base，不要默认套用其他项目的端口。

## 项目如何长大

| 当前需要 | 推荐形态 | 下一步 |
| --- | --- | --- |
| 验证一个想法 | 单文件 `bot.ts` | [single-file-bot](../examples/index.md#single-file-bot-一个-bot-ts-就是机器人) |
| 做命令、卡片与定时通知 | Root 插件 + 约定目录 | [IM Bot 路径](../paths/im-bot.md) |
| 把功能抽成可复用/可发布的插件包 | `plugins/<name>` 子插件 | [编写第一个插件](./first-plugin.md) |
| 增加模型与工具 | 挂载 Agent Features | [AI Agent 路径](../paths/ai-agent.md) |
| 多账号与生产运维 | HTTP Host + Remote Console | [Console 管理路径](../paths/console.md) |

## Install tiers

<!--@include: ../snippets/install-tiers.md#tiers-table-->

## 下一步

1. [核心概念速览](./concepts.md)：把文档里常见的名词一次弄懂。
2. [编写第一个插件](./first-plugin.md)：当你想把功能抽离成带独立配置 Schema、可跨项目复用或发布到 npm 的子插件包时看这篇。
3. [平台适配器](../adapters/index.md)：用 `npx zhin setup --adapters` 接入真实平台。
4. [AI 总览](../ai/index.md)：用 `npx zhin setup --ai` 接入大模型。
