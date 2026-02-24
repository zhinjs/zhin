# 快速开始

欢迎使用 Zhin.js！这个教程将带你从零开始创建一个机器人。

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

## 创建项目

### 方式一：一键安装（推荐）

使用一键安装脚本，自动检测环境并启动配置向导。

::: code-group

```bash [macOS / Linux / WSL]
curl -fsSL https://zhin.js.org/install.sh | bash
```

```powershell [Windows PowerShell]
irm https://zhin.js.org/install.ps1 | iex
```

:::

你也可以直接指定项目名称：

::: code-group

```bash [macOS / Linux / WSL]
curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot
```

```powershell [Windows PowerShell]
irm https://zhin.js.org/install.ps1 | iex -Args "my-bot"
```

:::

快速模式（跳过所有交互，使用默认配置）：

::: code-group

```bash [macOS / Linux / WSL]
curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot -y
```

```powershell [Windows PowerShell]
irm https://zhin.js.org/install.ps1 | iex
```
:::
脚本会自动完成以下检查：

- 检测 Node.js 版本（>= 20.19.0 或 >= 22.12.0）
- 检测并安装 pnpm（Bash 版）/ 检测并安装 pnpm（PowerShell 版）
- 启动 Zhin.js 交互式配置向导

### 方式二：手动创建

使用脚手架工具创建新项目：

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
  > TypeScript (推荐)
    JavaScript
    YAML
    JSON
```

**建议**：选择 TypeScript，IDE 提示最友好；如果偏好纯配置文件，选择 YAML。

### 3. 配置 Web 控制台

```
? Web 控制台用户名: admin
? Web 控制台密码: ******
```

这些信息会保存在 `.env` 文件中，用于登录 Web 控制台。

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

选择需要的聊天平台，Sandbox 为必选项。选择后会逐个引导你配置 Bot 的连接信息（如 Token、API Key 等），敏感信息会保存在 `.env` 文件中。

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

选择 AI 提供商后，会引导你配置 API Key 和触发方式（@机器人、私聊、前缀触发等）。

### 7. 等待安装

脚手架会自动：

- 创建项目目录
- 生成配置文件
- 安装依赖包
- 初始化 Git 仓库

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
[INFO] HTTP 服务启动在 http://localhost:8086
[INFO] 适配器 sandbox 已启动
[INFO] 机器人已启动，输入消息测试...
```

### 其他启动方式

```bash
# 生产模式（无热重载，性能更好）
pnpm start

# 后台运行（守护进程模式）
pnpm start -- -d
# 等价于
npx zhin start --daemon

# 停止后台运行的机器人
npx zhin stop
```

## CLI 命令一览

Zhin.js 提供了丰富的命令行工具：

### 开发与运维

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin dev`     | 开发模式启动（热重载），支持 `-p/--port`、`--verbose`、`--bun`    |
| `zhin start`   | 生产模式启动，支持 `-d/--daemon`、`--log-file`、`--bun`           |
| `zhin restart` | 重启后台运行的机器人                                              |
| `zhin stop`    | 停止后台运行的机器人                                              |
| `zhin build`   | 构建插件，支持 `--clean`、`--production`、`--analyze`             |

### 插件管理

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin new`     | 创建插件模板（normal/service/adapter），支持 `--type`             |
| `zhin install` | 安装插件（npm 或 git），支持 `-S/--save`、`-D/--save-dev`、`-g`  |
| `zhin add`     | `install` 的别名                                                  |
| `zhin pub`     | 发布插件到 npm，支持 `--tag`、`--dry-run`、`--access`             |
| `zhin search`  | 搜索 npm 上的 Zhin 插件，支持 `-c/--category`、`--official`       |
| `zhin info`    | 查看某个插件的详细信息                                            |

### 配置与诊断

| 命令                    | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `zhin setup`            | 交互式配置向导（数据库、适配器、AI 等）                    |
| `zhin config`           | 管理配置文件（子命令：`list`/`get`/`set`/`delete`/`path`） |
| `zhin doctor`           | 检查系统环境和项目配置，支持 `--fix` 自动修复              |
| `zhin onboarding`       | 新手引导教程，支持 `-i`（交互模式）、`-q`（快速指南）      |
| `zhin install-service`  | 注册为系统服务（systemd/launchd/NSSM），支持 `--user`      |
| `zhin uninstall-service`| 卸载系统服务                                               |

## 测试机器人

机器人启动后，你可以直接在终端输入消息测试：

```bash
> hello
机器人: 你好！欢迎使用 Zhin.js
```

这是内置的 `sandbox` 适配器，可以在终端中直接测试命令。

## 访问 Web 控制台

打开浏览器访问 `http://localhost:8086`

### 登录

使用创建项目时设置的用户名和密码登录。

### 控制台功能

- **仪表盘** - 查看机器人运行状态、内存使用、消息统计
- **插件管理** - 查看插件列表和 Feature 统计
- **日志查看** - 实时查看日志输出

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
  - "@zhin.js/http"
  - "@zhin.js/console"
  - "@zhin.js/adapter-sandbox"
```

```json [zhin.config.json]
"plugins": [
  "hello",
  "@zhin.js/http",
  "@zhin.js/console",
  "@zhin.js/adapter-sandbox"
]
```

:::

### 3. 测试插件

保存文件后，机器人会自动热重载。在终端输入：

```bash
> hello
机器人: 你好！
```

## 添加带参数的命令

让我们创建一个更实用的命令：

```typescript
import { usePlugin, MessageCommand } from "zhin.js";

const { addCommand } = usePlugin();

// 简单命令
addCommand(new MessageCommand("hello").desc("打个招呼").action(() => "你好！"));

// 带参数的命令
addCommand(
  new MessageCommand("echo <message:string>")
    .desc("回显消息")
    .action((_, result) => {
      return `你说：${result.params.message}`;
    }),
);

// 带可选参数的命令
addCommand(
  new MessageCommand("greet [name:string]")
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

恭喜！你已经成功创建了第一个 Zhin.js 机器人。接下来可以：

- **[配置文件](/essentials/configuration)** - 了解更多配置选项
- **[命令系统](/essentials/commands)** - 学习创建复杂命令
- **[插件系统](/essentials/plugins)** - 深入理解插件开发
- **[适配器](/essentials/adapters)** - 连接到 QQ、Discord 等平台
- **[AI 模块](/advanced/ai)** - 集成 AI 大模型能力
