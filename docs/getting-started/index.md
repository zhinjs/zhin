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
  > YAML (推荐，易读易写)
    TypeScript (类型安全)
    JavaScript
    JSON
```

**建议**：选择 YAML，最容易上手。

### 3. 配置 Web 控制台

```
? Web 控制台用户名: admin
? Web 控制台密码: ******
```

这些信息会保存在 `.env` 文件中，用于登录 Web 控制台。

### 4. 等待安装

脚手架会自动：
- 创建项目目录
- 生成配置文件
- 安装依赖包
- 初始化 Git 仓库

## 项目结构

创建完成后，你会看到以下目录结构：

```
my-bot/
├── src/
│   └── plugins/          # 你的插件目录
├── data/                 # 数据存储目录
│   └── database.db      # SQLite 数据库
├── zhin.config.yml      # 配置文件
├── .env                 # 环境变量（包含密码）
├── package.json         # 项目依赖
└── tsconfig.json        # TypeScript 配置
```

## 启动项目

进入项目目录并启动：

```bash
cd my-bot

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

# 后台运行（守护进程）
pnpm daemon

# 停止后台运行的机器人
pnpm stop
```

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

- **📊 仪表盘** - 查看机器人运行状态、内存使用、消息统计
- **🧩 插件管理** - 启用/禁用插件、查看插件列表
- **⚙️ 配置编辑** - 可视化编辑配置文件
- **📝 日志查看** - 实时查看日志输出
- **🗄️ 数据库** - 查看数据表、执行 SQL 查询

## 第一个插件

现在让我们创建第一个自定义插件！

### 1. 创建插件文件

在 `src/plugins/` 目录下创建 `hello.ts`：

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 获取插件 API
const { addCommand } = usePlugin()

// 添加一个简单的命令
addCommand(
  new MessageCommand('hello')
    .desc('打个招呼')
    .action(() => '你好！')
)
```

### 2. 启用插件

编辑 `zhin.config.yml`，在 `plugins` 列表中添加：

```yaml
plugins:
  - hello                    # 你的新插件
  - "@zhin.js/http"         # HTTP 服务
  - "@zhin.js/console"      # Web 控制台
  - "@zhin.js/adapter-sandbox"  # 终端适配器
```

### 3. 测试插件

保存文件后，机器人会自动热重载。在终端输入：

```bash
> hello
机器人: 你好！
```

成功！🎉

## 添加带参数的命令

让我们创建一个更实用的命令：

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

// 简单命令
addCommand(
  new MessageCommand('hello')
    .desc('打个招呼')
    .action(() => '你好！')
)

// 带参数的命令
addCommand(
  new MessageCommand('echo <message:string>')
    .desc('回显消息')
    .action((_, result) => {
      return `你说：${result.params.message}`
    })
)

// 带可选参数的命令
addCommand(
  new MessageCommand('greet [name:string]')
    .desc('向某人问好')
    .action((_, result) => {
      const name = result.params.name || '陌生人'
      return `你好，${name}！`
    })
)
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

如果 8086 端口被占用，可以在 `zhin.config.yml` 中修改：

```yaml
http:
  port: 3000  # 改成其他端口
```

### 热重载不生效

确保你在开发模式下运行（`pnpm dev`），而不是生产模式。

### 找不到命令

检查：
1. 插件文件是否在 `src/plugins/` 目录下
2. 插件是否在 `zhin.config.yml` 的 `plugins` 列表中
3. 终端是否显示插件加载成功的日志

## 下一步

恭喜！你已经成功创建了第一个 Zhin.js 机器人。接下来可以：

- **[配置文件](/essentials/configuration)** - 了解更多配置选项
- **[命令系统](/essentials/commands)** - 学习创建复杂命令
- **[插件系统](/essentials/plugins)** - 深入理解插件开发
- **[适配器](/essentials/adapters)** - 连接到 QQ、Discord 等平台

