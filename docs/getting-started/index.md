# 快速开始

<p class="lead">5 分钟在本地跑通首个机器人：创建项目 → 启动 Host → 连接 Remote Console → 在 Sandbox 发出 <code>hello</code>。可选再写第一个插件或接入真实平台。</p>

TypeScript **多通道 IM Bot 框架** + 可选 **Agent 栈**。完整资源见 [生态与资源](/ecosystem)。

## 三种入口（任选）

| 路径 | 说明 |
|------|------|
| [demo.zhin.dev](https://demo.zhin.dev) | 零安装在线 Sandbox |
| `npm create zhin-app -y` | 独立项目（本页下方步骤） |
| [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) | monorepo 贡献者调试 |

## 前置要求

- **Node.js** 20.19.0+ 或 22.12.0+
- **pnpm** 9.0+

```bash
node -v   # v20.19.0+
pnpm -v   # 9.0+
```

没有 pnpm？`npm install -g pnpm`

## 1. 创建项目

```bash
npm create zhin-app my-bot -y
```

`-y` 使用首跑黄金路径：Node.js + YAML + Host API + Sandbox。默认不启用 AI，因此不需要 Ollama 或任何云模型 Key。

## 2. 启动

```bash
cd my-bot
pnpm dev
```

看到类似输出说明启动成功：

```
[INFO] 数据库已连接
[INFO] HTTP 服务启动在 http://127.0.0.1:8086
[INFO] 适配器 sandbox 已就绪
```

## 3. 打开 Console 并发送第一条消息

打开 **[console.zhin.dev](https://console.zhin.dev)**：

1. API Base 填 `http://127.0.0.1:8086`
2. Token 填 `.env` 里的 `HTTP_TOKEN`
3. 进入 **Sandbox / 沙盒** 页，连接后发送 `/hello`，再试 `/card`

收到回复说明一切正常。

如果 Console 连不上，先在项目根运行：

```bash
npx zhin doctor
```

常见问题见 [疑难排查](/troubleshooting/)。

## 4. 写你的第一个命令

项目根就是一个插件包（`package.json` 的 `zhin.entry` 指向 `plugin.ts`）。在 `commands/` 目录下创建 `hello.ts`：

```typescript
// commands/hello.ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '打招呼',
  execute: () => '你好！🤖',
})
```

保存文件，运行时自动热重载。在沙盒发送 `/hello`，立刻收到回复。再来一个带参数的：

```typescript
// commands/echo/[text:string].ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '复读',
  execute: ({ params }) => `你说：${params.text}`,
})
```

发送 `/echo 测试`。命令由 `commands/` 目录约定自动发现，目录与文件名规则、参数写法详见 [命令系统](/essentials/commands)。

> **注意**：项目根 `commands/` 下的命令是 bare 名（`/hello`）；发布成插件包被挂载后，命令会自动带上 instanceKey 前缀（如 `/my-plugin hello`）。

## 下一步任务

| 目标 | 入口 |
|------|------|
| 更完整的首跑截图式说明 | [5 分钟首跑](/getting-started/first-run) |
| 安装并启用插件 | [安装插件](/guide/plugin-install) |
| 开发、测试、发布插件 | [插件生命周期](/guide/plugin-lifecycle) |
| 接入 QQ / Discord / Telegram 等平台 | [平台适配器](/adapters/) |
| 启用 AI 对话与工具调用 | [AI 模块](/advanced/ai) |
| 解决安装、Console、Token、端口问题 | [疑难排查](/troubleshooting/) |

## 接入真实平台

Sandbox 只是调试用。接入真实平台只需两步：

1. 安装并启用适配器：`npx zhin install @zhin.js/adapter-discord`
2. 创建 Endpoint：`npx zhin setup --adapters`

所有平台的配置方式见 [平台适配器](/adapters/)。

## 启用 AI（可选）

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

重启后按向导里的触发方式对话。详见 [AI 模块](/advanced/ai)。

## 常见陷阱

| 陷阱 | 说明 |
|------|------|
| 命令文件名不合规 | ❌ 目录与文件名只认小写字母、数字、连字符（`[a-z0-9][a-z0-9-]*`），大写/下划线不会被发现 |
| 参数写成目录段 | ❌ 动态参数只支持单个文件段且必须在末尾：`[name:string].ts`，`commands/[id]/x.ts` 不会被发现 |
| 导入路径没加 `.js` | ❌ TypeScript 本地导入必须写 `import { x } from './y.js'` |
| 绕过发送链路 | ❌ 回复走 `execute` 返回值或 `Message.$reply`，不要直接调平台 SDK 发送 |

## 下一步

- **[插件开发完整指南](/guide/plugin-development)** — 命令、数据库、AI 工具、测试、发布
- **[消息如何流转](/essentials/message-flow)** — 一页搞清消息进出
- **[配置文件](/essentials/configuration)** — 所有配置项
- **[平台适配器](/adapters/)** — QQ、Discord、Telegram 等各平台配置

## Install tiers（zhin.js 4.x） {#install-tierszhinjs-4x}

<<< ../snippets/install-tiers.md#tiers-table

<<< ../snippets/install-tiers.md#breaking

<<< ../snippets/install-tiers.md#imports
