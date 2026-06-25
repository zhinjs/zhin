# 快速开始

TypeScript **多通道 IM Bot 框架** + 可选 **Agent 栈**。5 分钟跑通本地首个机器人：创建项目、启动 Host、打开 Remote Console、在 Sandbox 发出第一条消息。

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
3. 进入 **Sandbox / 沙盒** 页，连接后发送 `hello`，再试 `card`

收到回复说明一切正常。`hello` 回复会提示如何启用 AI（`npx zhin setup --ai`）。

如果 Console 连不上，先在项目根运行：

```bash
npx zhin doctor
```

常见问题见 [疑难排查](/troubleshooting/)。

## 4. 写你的第一个插件

在 `src/plugins/` 下创建 `hello.ts`：

```typescript
import { usePlugin, MessageCommand } from "zhin.js"

const { addCommand } = usePlugin()

addCommand(new MessageCommand("hello").desc("打招呼").action(() => "你好！🤖"))

addCommand(new MessageCommand("echo <text>").desc("复读").action((_, r) => r.params.text))
```

保存文件，机器人自动热重载。在沙盒发送 `hello` 或 `echo 测试`，立刻收到回复。

> **注意**：`usePlugin()` 必须在文件顶层调用，不能放在函数或回调里。详见 [常见陷阱](#常见陷阱)。

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

npx zhin setup --ai
pnpm install
pnpm dev
```

重启后按向导里的触发方式对话。详见 [AI 模块](/advanced/ai)。

## 常见陷阱

| 陷阱 | 说明 |
|------|------|
| `usePlugin()` 放在函数里 | ❌ 必须在文件顶层调用，否则 AsyncLocalStorage 上下文丢失 |
| `getPlugin()` 在运行时调用 | ❌ 只能在插件初始化时调用，不能在命令回调、中间件里调用 |
| 导入路径没加 `.js` | ❌ TypeScript 本地导入必须写 `import { x } from './y.js'` |
| 直接调 `bot.$sendMessage()` | ❌ 必须走 `Message.$reply` 或 `Adapter.sendMessage` 发送链路 |

## 下一步

- **[插件开发完整指南](/guide/plugin-development)** — 命令、数据库、AI 工具、测试、发布
- **[消息如何流转](/essentials/message-flow)** — 一页搞清消息进出
- **[配置文件](/essentials/configuration)** — 所有配置项
- **[平台适配器](/adapters/)** — QQ、Discord、Telegram 等各平台配置
