# create-zhin-app

快速创建 Zhin 机器人 workspace 项目的脚手架工具，提供一键创建和配置新项目的能力。

## 核心特性

- 🚀 **一键创建**: 使用标准的 `npm create` / `yarn create` / `pnpm create` 命令
- 📦 **Workspace 结构**: 自动创建 pnpm workspace，支持插件开发
- 🔧 **智能配置**: 自动安装 pnpm、项目依赖
- 🎯 **交互式配置**: 选择运行时、配置格式、数据库类型
- 🗄️ **数据库支持**: 支持 SQLite、MySQL、PostgreSQL、MongoDB、Redis
- 🔐 **安全配置**: 自动生成 HTTP Token 认证和环境变量管理
- 🖥️ **Remote Console**: 默认配置 `https://console.zhin.dev` 访问所需的 API Base 与 CORS
- 🤖 **AI Agent 引导**: 可选配置 Provider、触发方式、会话、上下文和安全默认值
- 📊 **日志配置**: 内置完整的日志等级和清理配置
- 🌐 **零安装**: 无需全局安装，直接使用

## 快速开始

### 使用不同包管理器创建项目

```bash
# npm（推荐）
npm create zhin-app my-awesome-bot

# pnpm
pnpm create zhin-app my-awesome-bot

# 使用最新版本
npx create-zhin-app@latest my-awesome-bot
```

### 创建后的步骤

```bash
# 进入项目
cd my-awesome-bot

# 开发模式启动
pnpm dev

# 创建插件
zhin new my-plugin

# 构建插件
pnpm build
```

## 工作原理

`create-zhin-app` 负责**生成 workspace 文件树**与依赖安装；适配器 / AI / 数据库的**交互向导**来自共享包 [`@zhin.js/scaffold-wizard`](../scaffold-wizard/)（与 `zhin setup` 同一套逻辑）。

工作流程：

1. **启动脚手架**: 当你运行 `npm create zhin-app` 时
2. **检测 pnpm**: 自动检测并安装 pnpm（如果未安装）
3. **交互式配置**: 询问项目名称、运行时、配置格式
4. **HTTP Token 认证配置**: 配置 Web 控制台访问 Token
   - 默认 Token：随机生成 32 位 hex 字符串
5. **数据库 / 适配器 / AI 向导**（`@zhin.js/scaffold-wizard`）: 分步选择并写入配置
   - 数据库：SQLite、MySQL、PostgreSQL、MongoDB、Redis
   - 适配器：Sandbox、Telegram、Discord、GitHub 等（含模式与 env 引导）
   - AI：Provider、触发、会话；启用时预装 `@modelcontextprotocol/sdk`
6. **创建 Workspace**: 生成 pnpm workspace 结构
7. **生成配置文件**: 合并 wizard 结果到 `zhin.config.*`
8. **生成 .env 文件**: 保存 Token、适配器与 AI 环境变量
9. **自动安装依赖**: 在项目根目录执行 `pnpm install`
10. **完成提示**: 显示 Token、数据库配置和下一步操作

## 支持的参数

### 基础用法

```bash
# 交互式创建（推荐）
npm create zhin-app my-bot

# 指定项目名称
npm create zhin-app my-awesome-bot
```

**交互式配置流程：**
1. 📝 输入项目名称
2. ⚙️ 选择运行时（Node.js / Bun）
3. 📄 选择配置格式（YAML / JSON / TOML）
4. 🔐 配置 Web 控制台 Token
   - Token（默认：随机 32 位 hex 字符串，用于 Authorization: Bearer 或 ?token= 认证）
5. 🗄️ 配置数据库
   - SQLite（推荐，零配置）
   - MySQL（主机、端口、用户名、密码、数据库名）
   - PostgreSQL（主机、端口、用户名、密码、数据库名）
   - MongoDB（连接字符串、数据库名）
   - Redis（主机、端口、密码、数据库索引）

### 快速创建（跳过交互）

```bash
# 使用默认配置（YAML + Node.js + 随机 Token）
npm create zhin-app my-bot -y
# 或
npm create zhin-app my-bot --yes
```

### 参数详解

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[project-name]` | 项目名称（可选，会提示输入） | `my-zhin-bot` |
| `-y, --yes` | 跳过交互，使用默认配置 | `false` |

**默认配置（使用 `-y` 时，见 `src/stable-yes-defaults.ts`，由 `tests/stable-yes.test.ts` 断言）：**
- 配置格式: YAML (`zhin.config.yml`)
- 运行时: Node.js
- 包管理器: pnpm（自动安装）
- 数据库: 无（内存会话；需持久化请交互式创建或手动加 SQLite）
- HTTP Token: 随机生成
- 适配器: `@zhin.js/adapter-sandbox`；`bots: []`（与 minimal-bot 一致，沙盒 bot 由 Console 连接时自动创建）
- AI: 启用 Ollama（`http://127.0.0.1:11434`）；`toolSearch: false`；`execSecurity: allowlist` / `execPreset: readonly`；`memoryMcp: false`
- Remote Console: `https://console.zhin.dev`；API Base `http://127.0.0.1:8086`（见 [docs/console-remote.md](../../docs/console-remote.md)）
- MCP SDK: 启用 AI 时预装 `@modelcontextprotocol/sdk`
- 统一收件箱: 未启用（无 `database:` 块）
- 插件开发技能模板: 未安装（`devSkills: false`）

**与 [examples/minimal-bot](../../examples/minimal-bot/) 对齐：** `-y` 同样使用 `bots: []`、Sandbox + Host 插件与 `toolSearch: false`；首跑步骤见 minimal-bot README 与生成项目 README。

## 与 @zhin.js/cli 的分工

| 工具 | 用途 |
|------|------|
| **create-zhin-app** (`pnpm create zhin-app`) | 创建完整 workspace 项目（生成文件树 + 向导） |
| **@zhin.js/scaffold-wizard** | 共享向导库（database / adapters / AI）；被上表两项消费 |
| **zhin new** | 在已有项目内创建插件/服务/适配器包 |
| **zhin setup** | 已有项目内增量配置（与 create 共用 scaffold-wizard） |
| **zhin onboard** | 项目内外统一入口：新建项目或复用配置运行 setup |
| **zhin doctor** | 健康检查与环境修复 |

新建项目请优先 `pnpm create zhin-app`；已有项目加适配器/AI 用 `zhin setup`；插件开发用 `zhin new`。

## 使用场景

### 1. 快速原型开发

```bash
# 使用默认配置快速创建
npm create zhin-app quick-prototype -y
cd quick-prototype
npm run dev
```

### 2. 生产项目创建

```bash
# 按向导选择数据库、聊天适配器和 AI Provider
npm create zhin-app production-bot
```

### 3. 团队标准项目

```bash
# 使用默认 Host/Node 模板，后续在 zhin.config.yml 中提交团队约定
npm create zhin-app team-bot -y
```

### 4. 实验性项目

```bash
# 通过交互向导选择 Bun 或额外适配器
npm create zhin-app experimental-bot
```

## 生成的项目结构

执行 `create-zhin-app` 后会生成 pnpm workspace 项目结构：

```
my-awesome-bot/
├── src/                      # 应用源代码
│   └── plugins/             # 本地插件目录
│       └── example.ts       # 示例插件
├── client/                   # 客户端页面
│   └── index.tsx            # 示例页面
├── data/                     # 数据存储目录
├── plugins/                  # 插件开发目录（独立包）
│   └── .gitkeep
├── zhin.config.yml           # 配置文件（可选 YAML / JSON / TOML）
├── package.json             # 根 package.json（包含依赖和脚本）
├── tsconfig.json            # TypeScript 根配置
├── pnpm-workspace.yaml      # workspace 配置
├── .gitignore               # Git 忽略规则
├── .env                     # 环境变量（包含 HTTP 认证信息）
├── .env.example             # 环境变量模板
└── README.md                # 项目说明文档
```

**⚠️ 重要**: `.env` 文件包含敏感信息（HTTP Token），已自动添加到 `.gitignore`，不会被提交到版本控制。

**Workspace 配置 (`pnpm-workspace.yaml`):**
```yaml
packages:
  - '.'              # 根目录即为主应用
  - 'plugins/*'      # plugins 下的所有插件包
```

**根 package.json 脚本:**
```json
{
  "scripts": {
    "dev": "zhin dev",                          // 开发模式
    "start": "zhin start",                      // 生产启动
    "daemon": "zhin start --daemon",            // 后台运行
    "stop": "zhin stop",                        // 停止服务
    "build": "zhin build"                          // 构建插件和客户端页面
  }
}
```

## 配置文件格式

脚手架当前支持 YAML、JSON、TOML。`-y` 默认生成 `zhin.config.yml`（节选）：

```yaml
bots: []

plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - example

http:
  token: ${HTTP_TOKEN}
  corsOrigins:
    - "https://console.zhin.dev"

ai:
  providers:
    ollama:
      api: ollama-chat
      host: http://127.0.0.1:11434
  agents:
    zhin:
      provider: ollama
      model: qwen3:14b
  agent:
    toolSearch: false
    execSecurity: allowlist
    execPreset: readonly
```

交互式选择 SQLite 等数据库时会追加 `database:` 与 `inbox: enabled: true`。Remote Console 用法见 [docs/console-remote.md](../../docs/console-remote.md)；Stable 手测见 [examples/minimal-bot/README.md](../../examples/minimal-bot/README.md)。

## 完整工作流

项目创建完成后，可以执行以下操作：

### 1. 进入项目目录

```bash
cd my-awesome-bot
```

### 2. 开发模式启动（依赖已自动安装）

```bash
pnpm dev
```

访问 Remote Console `https://console.zhin.dev`，API Base 填写与 Host 一致的地址（如 `http://127.0.0.1:8086`）。

**访问信息：**
- Token 在创建项目时已配置
- 保存在 `.env` 文件中
- 创建完成时会在终端显示

> 💡 **修改 Token**: 编辑 `.env` 文件中的 `HTTP_TOKEN`

### 3. 创建插件

```bash
# 创建新插件（自动添加到依赖）
zhin new my-awesome-plugin

# 插件会创建在 plugins/my-awesome-plugin/
# 自动添加到根 package.json 的 dependencies
```

### 4. 开发插件

```bash
# 编辑插件文件
# plugins/my-awesome-plugin/src/index.ts              # 插件逻辑
# plugins/my-awesome-plugin/skills/my-awesome-plugin/SKILL.md  # AI 技能说明（可选完善）
# plugins/my-awesome-plugin/client/                   # 控制台客户端页面

# 保存后自动热重载 ⚡
```

### 5. 构建插件

```bash
# 构建所有插件
pnpm build

# 或只构建特定插件
zhin build my-awesome-plugin
```

### 6. 在配置中启用插件

编辑 `zhin.config.yml`：

```yaml
plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
  - example
  - my-awesome-plugin
```

### 7. 生产环境部署

```bash
# 确保插件已构建
pnpm build

# 生产启动
pnpm start

# 或后台运行
pnpm daemon

# 停止服务
pnpm stop
```

## 错误处理

### 常见错误及解决方案

1. **网络连接问题**
   ```bash
   # 使用国内镜像
   npm config set registry https://registry.npmmirror.com
   npm create zhin-app my-bot
   ```

2. **权限问题**
   ```bash
   # macOS/Linux
   sudo chown -R $USER ~/.npm
   
   # Windows (以管理员身份运行)
   npm create zhin-app my-bot
   ```

3. **Node.js 版本问题**
   ```bash
   # 检查 Node.js 版本（需要 ^20.19.0 或 >=22.12.0）
   node --version
   
   # 升级 Node.js
   # 使用 nvm 或从官网下载最新版本
   ```

## 环境要求

- **Node.js**: ^20.19.0 或 >=22.12.0
- **npm**: >= 8.0.0 (或对应版本的 yarn/pnpm)
- **操作系统**: Windows 10+, macOS 10.15+, Linux (现代发行版)

## 与其他工具对比

| 特性 | create-zhin-app | create-react-app | create-vue |
|------|-------------|------------------|------------|
| 零配置创建 | ✅ | ✅ | ✅ |
| 多配置格式 | ✅ | ❌ | ✅ |  
| 多运行时支持 | ✅ | ❌ | ❌ |
| 机器人框架 | ✅ | ❌ | ❌ |
| 热重载开发 | ✅ | ✅ | ✅ |

## 高级用法

### 自定义模板

虽然 `create-zhin-app` 主要调用 CLI 工具，但你可以通过环境变量自定义行为：

```bash
# 设置自定义模板路径
ZHIN_TEMPLATE_DIR=/path/to/custom/template npm create zhin-app my-bot
```

### 批量创建

```bash
#!/bin/bash
# 批量创建多个项目
for name in bot1 bot2 bot3; do
  npm create zhin-app $name -- -y
done
```

### CI/CD 集成

```yaml
# GitHub Actions 示例
- name: create zhin-app Bot Project
  run: |
    npm create zhin-app test-bot -- --yes
    cd test-bot
    npm run build
    npm run test
```

## 故障排查

### 调试模式

```bash
# 启用详细日志
DEBUG=create-zhin-app npm create zhin-app my-bot

# 检查参数传递
npm create zhin-app my-bot -- --help
```

### 清理缓存

```bash
# 清理 npm 缓存
npm cache clean --force

# 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

## 贡献指南

`create-zhin-app` 是开源项目，欢迎贡献：

- **向导逻辑**（适配器/AI/数据库交互、写 config/env/deps）：改 [`@zhin.js/scaffold-wizard`](../scaffold-wizard/)，并跑 `pnpm --filter @zhin.js/scaffold-wizard test`
- **项目模板与生成**（目录结构、README、skills）：改本包 `src/workspace.ts` 等，并跑 `pnpm --filter create-zhin-app test`

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License
