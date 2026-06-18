# 快速开始

欢迎使用 Zhin.js！本教程带你从零跑通 **IM 核心路径**：配置 Endpoint（先从 Sandbox 开始）、在 Remote Console 沙盒里收发消息。若需要 **ZhinAgent / 大模型对话**，见下文 [启用 AI（可选）](#启用-ai-可选) 与 [Install tiers](#install-tierszhinjs-4x)。

> **读完本页后**：若希望按难度选课，打开 [学习路径](/essentials/learning-paths)；需要一页搞清消息进出，看 [消息如何流转](/essentials/message-flow)。

## Install tiers（zhin.js 4.x）

<<< ../snippets/install-tiers.md#tiers-table

<<< ../snippets/install-tiers.md#breaking

<<< ../snippets/install-tiers.md#scaffold-note

## 前置要求

在开始之前，请确保你的电脑上已安装：

- **Node.js** 20.19.0+ 或 22.12.0+（推荐使用最新 LTS 版本）
- **pnpm** 9.0+（包管理器）

检查版本：

```bash
node -v   # 应该显示 v20.19.0 或更高
pnpm -v   # 应该显示 9.0.2 或更高
```

如果没有安装 pnpm，可以通过以下命令安装：

```bash
npm install -g pnpm
```

## 零安装体验（在线 Demo）

若尚未安装 Node.js，可先在浏览器打开 **[demo.zhin.dev](https://demo.zhin.dev)**：官方托管 Sandbox，可发 `hello` 与 `ai:`（需服务端 Ollama）。满意后再按下文本地首跑或 `npm create zhin-app`。

## 推荐首跑（Stable）

若你已克隆 [Zhin.js monorepo](https://github.com/zhinjs/zhin)，优先使用黄金路径示例（单 Sandbox、最少插件）：

```bash
pnpm install          # 在仓库根目录
cd examples/minimal-bot
cp .env.example .env
pnpm dev
```

保持 `pnpm dev` 运行后，打开 **[Remote Console](https://console.zhin.dev)**，用终端里显示的 Host 地址作为 API Base，Token 与 `.env` 的 `HTTP_TOKEN` 一致；在 Console **沙盒** 页连接后发送 `hello` 验证 IM 路径。**minimal-bot 默认关闭 AI**；要测 `ai:` 对话请用 [full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) 或下文「启用 AI」。说明见 [console-remote.md](../console-remote.md)。

- 示例说明：[examples/minimal-bot/README.md](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/README.md)
- 全功能维护者配置（**非默认模板**）：`examples/test-bot`

独立新项目请继续阅读下文「创建项目」。

## 创建项目

使用 `npm create` 创建新项目：

```bash
npm create zhin-app my-bot
```

这个命令会启动一个交互式配置向导：

### 1. 选择运行时

```
? 选择运行时
  > Node.js (推荐，稳定性好)
    Bun (实验性，速度快)
```

**建议**：如果你是新手，选择 Node.js。

### 2. 选择配置格式

```
? 选择配置格式
  > YAML (推荐)
    JSON
    TOML
```

**建议**：新手选择 YAML，最容易阅读和修改。

### 3. 配置 Web 控制台

```
? Web 控制台 Token (用于 Authorization: Bearer 或 ?token= 认证): ********
```

Token 会保存在 `.env` 文件中，用于访问本地 API 或在 Remote Console 登录页填写。

### 4. 配置数据库

```
? 选择数据库类型
  > SQLite (推荐，无需额外安装)
    MySQL
    PostgreSQL
    MongoDB
    Redis
```

**建议**：新手选择 SQLite，数据直接存在本地文件中，无需安装额外数据库服务。

### 5. 选择适配器

```
? 选择聊天平台适配器
  ◉ Sandbox (调试沙盒，默认)
  ◯ ICQQ (QQ)
  ◯ QQ 官方
  ◯ KOOK
  ◯ Discord
  ◯ Telegram
  ...
```

选择需要的聊天平台，Sandbox 为必选项。选择后会逐个引导你配置 Endpoint 的连接信息（如 Token、API Key 等），敏感信息会保存在 `.env` 文件中。

::: tip ICQQ (QQ)
需先在终端执行 `icqq login`（`@icqqjs/cli`），再在配置里填写与登录一致的 QQ 号（`ICQQ_ACCOUNT`）。**不要**在 `zhin.config` 的 bot 段填写 QQ 密码或 `platform`。
:::

### 6. 配置 AI 智能体

```
? 是否启用 AI 智能体？ (Y/n)
? 选择 AI 提供商
  > OpenAI (GPT-4o, 推荐)
    Anthropic (Claude)
    DeepSeek
    Moonshot (月之暗面)
    智谱 AI (GLM)
    Ollama (本地部署)
```

选择 AI 提供商后，会引导你配置 API Key 和触发方式（@Endpoint、私聊、前缀触发等），并自动安装 `@zhin.js/agent`、`zod`、`ai` 与所选 `@ai-sdk/*`。

### 启用 AI（可选）

若已克隆 monorepo 且从 **minimal-bot** 起步，需另装依赖并改配置：

```bash
cd examples/full-bot   # 或在你自己的项目根
pnpm add @zhin.js/agent zod ai @ai-sdk/openai   # provider 按厂商替换
```

```yaml
# zhin.config.yml 节选
ai:
  enabled: true
  providers: { ... }
  agents:
    zhin: { provider: ..., model: ... }
```

也可直接 `cd examples/full-bot && pnpm dev`。详见 [AI 模块 — 安装与依赖](/advanced/ai#安装与依赖-zhinjs-4x)。

### 7. 等待安装

脚手架会自动：

- 创建项目目录
- 生成配置文件
- 安装依赖包
- 生成 Agent 引导文件和插件开发技能

## 项目结构

创建完成后，你会看到以下目录结构：

```
my-zhin-bot/
├── src/
│   └── plugins/           # 你的插件目录
│       └── example.ts     # 示例插件
├── client/                # 客户端页面（Web 控制台自定义页面）
│   ├── index.tsx          # 客户端入口
│   └── tsconfig.json      # 客户端 TypeScript 配置
├── data/                  # 数据存储目录（运行时自动生成）
│   └── bot.db             # SQLite 数据库文件
├── zhin.config.yml        # 主配置文件（可选 yaml / json / toml）
├── .env                   # 环境变量（存放密码等敏感信息，不应提交到 Git）
├── package.json           # 项目依赖
├── tsconfig.json          # TypeScript 配置
└── pnpm-workspace.yaml    # pnpm 工作区配置
```

## 启动项目

进入项目目录并启动：

```bash
cd my-zhin-bot

# 开发模式（支持热重载）
pnpm dev
```

你会看到类似的输出：

```
[INFO] Zhin.js v2.0.0
[INFO] 数据库已连接
[INFO] HTTP 服务启动在 http://127.0.0.1:8086
[INFO] [Zhin:host-api]: 服务: Host API | 模式: 仅API
[INFO] 适配器 sandbox 已就绪
```

在 **[console.zhin.dev](https://console.zhin.dev)** 打开沙盒页连接后发送 `hello` 测试（非终端 stdin）：

```text
hello
```

### 其他启动方式

```bash
# 生产模式（无热重载，性能更好）
pnpm start

# 后台运行（守护进程模式）
pnpm start -- -d
# 等价于
npx zhin start --daemon

# 停止后台运行的实例
npx zhin stop
```

## CLI 命令

Stable 路径常用：`pnpm dev`（等价 `zhin dev`）、`pnpm start`、`npx zhin stop`。完整命令表见 **[CLI 命令参考](/reference/cli)** 与仓库 [`@zhin.js/cli`](https://github.com/zhinjs/zhin/tree/main/basic/cli) README。

## 测试 Agent（需已安装 @zhin.js/agent）

在 **已启用 AI** 的项目中（脚手架勾选 AI，或 [full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot)）：

1. 打开 **[console.zhin.dev](https://console.zhin.dev)**，API Base 与日志中的 Host 一致（如 `http://127.0.0.1:8086`），Token 与 `.env` 的 `HTTP_TOKEN` 一致
2. 进入 **沙盒** 页连接 WebSocket，发送 `hello`（命令）或 `ai: …`（Agent）

**仅 IM 的 minimal-bot** 只能验证 `hello` 等命令，不能发 `ai:`。`endpoints: []` 时 Console 打开沙盒页会自动创建 bot。

::: info 终端里的 `> hello` 是什么？
那是 **`process` 核心服务**（stdin/stdout），不是 Sandbox。默认启用但仅在 TTY 下绑定 stdin；Stable 调试请用 Console 沙盒。详见 [适配器 — Process](/essentials/adapters#process进程适配器)。
:::

## 访问 Remote Console

在 **[console.zhin.dev](https://console.zhin.dev)** 登录（聊天与管理界面在这里，不在本机 `:8086` 网页上）。

API Base 与启动日志中的 Host 地址一致，例如：

```text
http://127.0.0.1:8086
```

详见 [console-remote.md](../console-remote.md)。

### 登录

使用创建项目时生成的 Token 登录。Token 保存在 `.env` 的 `HTTP_TOKEN` 中，创建完成时终端也会显示一次。

默认生成的 `http.corsOrigins` 已允许官方 Remote Console Origin。如果你本地开发控制台，在 `zhin.config.yml` 的 `http.corsOrigins` 中追加本地 Origin。

### 控制台功能

- **仪表盘** - 查看运行时状态、Endpoint 在线情况、内存与消息统计
- **插件管理** - 查看插件列表和 Feature 统计
- **日志查看** - 实时查看日志输出

## 验证项目

创建后建议先跑一遍构建，再启动开发模式：

```bash
pnpm build
pnpm dev
```

如果启用了 AI，脚手架会同时写入推荐的 `ai.sessions`、`ai.context` 和 `ai.agent` 默认值。`phaseTrace`、`toolSearch`、`memoryMcp` 和 `mcpServers` 是进阶开关，按需在配置文件里开启。

::: tip 下一步：Advanced 能力
跑通 Stable 路径后，可按 [学习路径 L3+](/essentials/learning-paths#l3-ai-与-mcp-进阶) 继续：

- [Agent 概念入门](/advanced/agent-concepts) — `ctx.ai` / Subagent / toolSearch
- [MCP 集成](/advanced/mcp) — 接入外部工具或 IDE 插件开发
- [配置文件 — Advanced AI 开关](/essentials/configuration#advanced-ai-开关)
:::

## 第一个插件

现在让我们创建第一个自定义插件！

### 1. 创建插件文件

在 `src/plugins/` 目录下创建 `hello.ts`：

```typescript
import { usePlugin, MessageCommand } from "zhin.js";

// 获取插件 API
const { addCommand } = usePlugin();

// 添加一个简单的命令
addCommand(new MessageCommand("hello").desc("打个招呼").action(() => "你好！"));
```

### 2. 启用插件

编辑配置文件（`zhin.config.yml` / `.json` / `.toml`），在 `plugins` 列表中添加：

::: code-group

```yaml [zhin.config.yml]
plugins:
  - hello
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - "@zhin.js/adapter-sandbox"
```

```json [zhin.config.json]
"plugins": [
  "hello",
  "@zhin.js/host-router",
  "@zhin.js/host-api",
  "@zhin.js/adapter-sandbox"
]
```

:::

### 3. 测试插件

保存文件后，运行时会自动热重载。在 **Remote Console 沙盒** 中发送：

```text
hello
```

应收到插件回复。若你启用了 `process` 服务且终端为 TTY，也可在终端输入 `hello`（非 Stable 默认路径）。

## 添加带参数的命令

让我们创建一个更实用的命令：

```typescript
import { usePlugin, MessageCommand } from "zhin.js";

const { addCommand } = usePlugin();

// 简单命令
addCommand(new MessageCommand("hello").desc("打个招呼").action(() => "你好！"));

// 带参数的命令
addCommand(
  new MessageCommand("echo <message:text>")
    .desc("回显消息")
    .action((_, result) => {
      return `你说：${result.params.message}`;
    }),
);

// 带可选参数的命令
addCommand(
  new MessageCommand("greet [name:word]")
    .desc("向某人问好")
    .action((_, result) => {
      const name = result.params.name || "陌生人";
      return `你好，${name}！`;
    }),
);
```

测试：

```bash
> echo 测试消息
机器人: 你说：测试消息

> greet Alice
机器人: 你好，Alice！

> greet
机器人: 你好，陌生人！
```

## 常见问题

### 端口被占用

如果 8086 端口被占用，可以在配置文件中修改（示例为 YAML 格式）：

```yaml
http:
  port: 3000 # 改成其他端口
```

### 热重载不生效

确保你在开发模式下运行（`pnpm dev`），而不是生产模式（`pnpm start`）。

### 找不到命令

检查：

1. 插件文件是否在 `src/plugins/` 目录下
2. 插件是否在配置文件的 `plugins` 列表中
3. 终端是否显示插件加载成功的日志

## 下一步

恭喜！你已经跑通了第一个 Zhin.js 实例（Sandbox Endpoint）。接下来可以：

- **[插件开发、测试与发布](/guide/plugin-development)** - 完整的插件生命周期（创建 → 测试 → 构建 → 发布）
- **[配置文件](/essentials/configuration)** - 了解更多配置选项
- **[命令系统](/essentials/commands)** - 学习创建复杂命令
- **[插件系统](/essentials/plugins)** - 深入理解插件开发
- **[适配器概览](/essentials/adapters)** — 多平台、群管工具等框架概念
- **[平台适配器](/adapters/)** — QQ、Discord、Telegram、Satori 等各平台配置（与包 README 同步）
- **[AI 模块](/advanced/ai)** - 集成 AI 大模型能力
