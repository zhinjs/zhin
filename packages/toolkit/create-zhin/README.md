# create-zhin-app

::: warning 依赖版本
向导将 `zhin.js` / `@zhin.js/*` 写成与 `@zhin.js/scaffold-wizard` 同一次发布的真实版本范围（如 `^1.1.11`），AI 栈第三方包使用 Zhin 声明的 peer 范围，不再写 `latest`（政策：`pnpm check:dependency-policy`）。caret 范围仍会接收补丁与次版本；生产环境请提交 lockfile。
:::

快速创建 Zhin 机器人 workspace 项目的脚手架工具，提供一键创建和配置新项目的能力。

## 核心特性

- 🚀 **一键创建**: 使用标准的 `npm create` / `yarn create` / `pnpm create` 命令
- 📦 **Workspace 结构**: 自动创建 pnpm workspace，支持插件开发
- 🔧 **智能配置**: 自动安装 pnpm、项目依赖
- 🎯 **两个问题**: 终端里只问项目语言、项目名称，并确认初始化令牌
- 🧭 **Console 引导**: 数据库、所有者账号、AI、适配器都在 Console 里完成（[ADR 0053](../../../docs/adr/0053-console-onboarding.md)）
- 🔐 **初始化令牌**: 随机生成并写入 `.env` 的 `HTTP_TOKEN`，只用于创建第一个所有者账号
- 🖥️ **Remote Console**: 默认配置 `https://console.zhin.dev` 访问所需的 API Base 与 CORS，结束时打印一键打开的链接
- 🤖 **自动化参数**: `--database`、`--adapter`、`--ai` 等参数仍可在创建时写入对应配置
- 📊 **日志配置**: 内置完整的日志等级和清理配置
- 🌐 **零安装**: 无需全局安装，CLI 作为项目 devDependency 通过 `pnpm` / `npx zhin` 使用

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

# 创建项目内本地插件（独立可发布插件：npx @zhin.js/cli new my-plugin --standalone）
npx zhin new my-plugin

# 类型检查
pnpm build
```

## 工作原理

`create-zhin-app` 只负责**生成最小 workspace 项目**与依赖安装（[ADR 0053 §1](../../../docs/adr/0053-console-onboarding.md)）。数据库、所有者账号、AI、适配器在 Host 启动后由 Console 引导完成；`zhin setup` 也能在终端里补充。显式传入 `--database` / `--adapter` / `--ai` 时，写入逻辑来自共享包 [`@zhin.js/scaffold-wizard`](../scaffold-wizard/)（与 `zhin setup` 同一套）。

工作流程：

1. **启动脚手架**: 当你运行 `npm create zhin-app` 时
2. **检测 pnpm**: 自动检测并安装 pnpm（如果未安装）
3. **两个问题**: 项目语言、项目名称（已在命令行给出则跳过）
4. **确认初始化令牌**: 默认随机生成 32 位 hex 字符串，回车确认；写入 `.env` 的 `HTTP_TOKEN`，配置里是 `http.token: ${HTTP_TOKEN}`
5. **生成最小项目**: IM 核心 + Console Host，不含数据库驱动、适配器、AI 依赖（未配置数据库时 Runtime 使用默认 SQLite `.zhin/data.sqlite`）
6. **自动安装依赖**: 在项目根目录执行 `pnpm install`
7. **完成提示**: 打印启动命令和 Console 链接 `https://console.zhin.dev/?apiBaseUrl=<编码后的 http://127.0.0.1:8068>#token=<初始化令牌>`（Console 会自行拼接 `http.base` 的 `/api`）。令牌只出现在 `#` 之后，不会发送到 console.zhin.dev 的服务器；输出不是终端（例如 CI 日志）时链接里省略令牌，到 `.env` 查看

## 支持的参数

### 基础用法

```bash
# 交互式创建（推荐）
npm create zhin-app my-bot

# 指定项目名称
npm create zhin-app my-awesome-bot
```

**交互式问题（只有三个）：**
1. 🌐 选择项目语言（或用 `--locale zh-CN|en` 指定）
2. 📝 输入项目名称（命令行已给出则跳过）
3. 🔐 确认初始化令牌（默认随机 32 位 hex 字符串，回车确认）

模板、配置格式、数据库、适配器、AI、插件开发技能不再提问，取默认值；需要时用下方参数指定。运行时固定为 Node.js（>=22.19.0），也不会全局安装 CLI。

结束时的输出（示例）：

```
✔ 项目已创建：my-bot
  启动：cd my-bot && pnpm dev
  然后打开 Console 完成初始化：
  https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=<初始化令牌>
```

端口与 base 取自生成的配置（`http.port`、`http.base`）。打开链接后 Console 依次引导：数据库 → 所有者账号 → AI → 适配器，每一步都可以跳过、以后再回来。初始化令牌在创建第一个所有者后失效。

### 快速创建（跳过交互）

```bash
# 接受全部默认值（YAML + 随机初始化令牌 + 默认项目名）
npm create zhin-app my-bot -y
# 或
npm create zhin-app my-bot --yes
```

`-y` 只确认默认值，不会预装适配器或 AI。

### 参数详解

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[project-name]` | 项目名称（可选，会提示输入；`-y` 时用默认值） | `my-zhin-bot` |
| `-y, --yes` | 不提问，接受默认值 | `false` |
| `--skip-install` | 仅生成文件，稍后自行运行 `pnpm install` | `false` |
| `--locale <zh-CN\|en>` | 生成项目的语言（模板、README、提示） | 交互选择；`-y` 时使用默认语言 |
| `--template <default\|life-assistant>` | 项目模板 | `default` |
| `--config-format <yaml\|json>` | 配置文件格式 | `yaml` |
| `--dev-skills` / `--no-dev-skills` | 是否复制插件开发技能模板到 `skills/` | 不复制 |
| `--database [<dialect>]` | 写入 `database:`。给出方言（`sqlite`、`mysql`、`pg`、`mongodb`、`redis`、`memory`）时使用该方言的默认连接参数，连接信息写入 `.env`；不带值时进入数据库向导 | 不写入，使用默认 SQLite |
| `--adapter <name>[,<name>]` | 安装并挂载适配器（可重复）。`sandbox` 与字段式适配器使用默认值，凭据写成 `.env` 引用；带专用配置流程的平台（如 `telegram`、`qq`、`discord`）会询问该平台的凭据 | 不安装 |
| `--adapters` | 进入适配器选择向导（与 `zhin setup --adapters` 相同） | — |
| `--ai` | 进入 AI 向导并安装 AI 依赖（与 `zhin setup --ai` 相同） | 不启用 |

**默认配置（交互与 `-y` 相同，见 `src/stable-yes-defaults.ts`，由 `tests/stable-yes.test.ts`、`tests/onboarding-flow.test.ts` 断言）：**
- 配置格式: YAML (`zhin.config.yml`)
- 包管理器: pnpm（自动安装）
- 依赖: `zhin.js`、`@zhin.js/skill`、`@zhin.js/components` 与 Console 页面 Feature（`@zhin.js/console-contract`、`@zhin.js/page`、`@zhin.js/layout`）；`@zhin.js/cli` 为 devDependency
- 数据库: 不写 `database:`，Runtime 使用默认 SQLite（`.zhin/data.sqlite`），可在 Console 引导里更换
- 初始化令牌: 随机生成，写入 `.env` 的 `HTTP_TOKEN`
- 适配器: 无（`plugins: {}`），在 Console 引导或 `zhin setup --adapters` 中添加
- AI: 不启用，在 Console 引导或 `zhin setup --ai` 中启用
- Remote Console: `https://console.zhin.dev`；脚手架写入 `http.port: 8068`、`http.base: /api`，Console 里的 API Base 为 `http://127.0.0.1:8068`（见 [docs/console/index.md](../../../docs/console/index.md)）
- 插件开发技能模板: 未安装（`devSkills: false`）

需要本地 Sandbox 调试时加 `--adapter sandbox`；它与 [examples/minimal-bot](../../../examples/minimal-bot/) 的 Sandbox 实例一致（实例键 `sandbox`、`commandPrefix: /`、Endpoint `sandbox-bot`）。

## 与 @zhin.js/cli 的分工

| 工具 | 用途 |
|------|------|
| **create-zhin-app** (`pnpm create zhin-app`) | 创建完整 workspace 项目（生成文件树 + 向导） |
| **@zhin.js/scaffold-wizard** | 共享向导库（database / adapters / AI）；被上表两项消费 |
| **zhin new** | 创建插件/服务/适配器包的唯一官方入口：`zhin new <name> --standalone` 生成可发布的独立插件，不加则在已有项目内生成本地插件 |
| **zhin setup** | 已有项目内增量配置（与 create 共用 scaffold-wizard） |
| **zhin onboard** | 项目内外统一入口：新建项目或复用配置运行 setup |
| **zhin doctor** | 健康检查与环境修复 |

新建项目请优先 `pnpm create zhin-app`；已有项目加适配器/AI 用 `zhin setup`；插件开发用 `zhin new`（独立插件加 `--standalone`）。`create-zhin-app` 不生成独立插件。

## 使用场景

### 1. 快速原型开发

```bash
# 使用默认配置快速创建
npm create zhin-app quick-prototype -y
cd quick-prototype
pnpm dev
```

### 2. 生产项目创建

```bash
# 创建后在 Console 引导里选择数据库、聊天适配器和 AI Provider
npm create zhin-app production-bot
```

### 3. 团队标准项目

```bash
# 使用默认模板，后续在 zhin.config.yml 中提交团队约定
npm create zhin-app team-bot -y
```

### 4. 脚本 / 容器里一次写好

```bash
# 非交互：PostgreSQL（默认连接参数写入 .env）+ Sandbox 适配器 + JSON 配置
npm create zhin-app ci-bot -- -y --database pg --adapter sandbox --config-format json
```

## 生成的项目结构

执行 `create-zhin-app` 后会生成 pnpm workspace 项目结构：

```
my-awesome-bot/
├── plugin.ts                 # 根 Plugin Runtime 入口（definePlugin）
├── schema.json               # 根插件配置 JSON Schema
├── commands/                 # 消息命令（hello、card 示例）
├── components/               # 消息组件（status-card 示例）
├── middlewares/              # 消息中间件
├── tools/                    # AI tools（启用 AI 时生成 echo 示例）
├── skills/<name>/SKILL.md    # Skill 能力包
├── agents/                   # 可选 Agent 定义
├── hooks/                    # 可选 Agent hooks
├── prompt-sections/          # 可选 Prompt 片段
├── pages/                    # Console 页面：index/、nav/、footer/
├── plugins/                  # 仅一级的本地子插件 workspace
├── packages/                 # 提供给 Zhin 的 Feature workspace
├── data/                     # 数据存储目录
├── zhin.config.yml           # Root 配置文件（YAML 或 JSON）
├── package.json              # 依赖、脚本与 zhin 清单
├── tsconfig.json             # TypeScript 配置
├── pnpm-workspace.yaml       # workspace 配置
├── ecosystem.config.cjs      # PM2 配置
├── .env / .env.development / .env.production / .env.example
├── .gitignore
└── README.md
```

另外会生成系统服务模板（systemd `.service`、launchd `.plist`、Windows `install-service.ps1` 与计划任务 XML）；启用 AI 时还有 `SOUL.md`、`TOOLS.md`、`AGENTS.md` 与 `assistant.profile.yml.example`。

**⚠️ 重要**: `.env` 文件包含敏感信息（HTTP Token），已自动添加到 `.gitignore`，不会被提交到版本控制。

**Workspace 配置 (`pnpm-workspace.yaml`):**
```yaml
packages:
  - '.'              # 根目录即为主应用
  - 'plugins/*'      # plugins 下的一级子插件包
  - 'packages/*'     # 本地 Feature 包
```

**根 package.json 脚本:**
```json
{
  "scripts": {
    "dev": "zhin start --foreground --watch source config",
    "start": "zhin start --foreground --mode production --no-watch",
    "preview": "zhin preview",
    "build": "tsc --noEmit",
    "pm2:start": "pm2 start ecosystem.config.cjs",
    "pm2:stop": "pm2 stop ecosystem.config.cjs",
    "pm2:restart": "pm2 restart ecosystem.config.cjs",
    "pm2:delete": "pm2 delete ecosystem.config.cjs",
    "pm2:logs": "pm2 logs",
    "pm2:monit": "pm2 monit"
  }
}
```

`package.json#zhin` 是 Plugin Runtime 拓扑清单（`entry: ./plugin.ts`、`features`、`plugins`）。

## 配置文件格式

脚手架生成 Runtime 可直接加载的 YAML 或 JSON。`-y` 默认生成 `zhin.config.yml`（节选）：

```yaml
http:
  token: ${HTTP_TOKEN}
  port: 8068
  base: /api
  corsOrigins:
    - "https://console.zhin.dev"

plugins: {}
```

`http.token` 是初始化令牌，只用于在 Console 创建第一个所有者账号（[ADR 0049](../../../docs/adr/0049-console-rbac.md)）。传入 `--database` 时会追加 `database:`，传入 `--adapter` 时 `plugins` 下会出现对应实例；Console 引导保存的数据库与适配器也写在这里。Remote Console 用法见 [Console 文档](../../../docs/console/index.md)；Stable 手测见 [examples/minimal-bot/README.md](../../../examples/minimal-bot/README.md)。

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

打开创建结束时打印的 Console 链接（API Base 为 `http://127.0.0.1:8068`，初始化令牌在 `#token=` 之后）。链接丢了也没关系：打开 `https://console.zhin.dev`，API Base 填 `http://127.0.0.1:8068`，令牌填 `.env` 的 `HTTP_TOKEN`。

Console 引导依次完成：

1. **数据库**：保持默认 SQLite，或选择 MySQL / PostgreSQL / MongoDB 并测试连接；
2. **所有者账号**：创建第一个所有者并登录，此后初始化令牌失效；
3. **AI**（可跳过）：安装 AI 依赖并添加第一个模型 Provider；
4. **适配器**（可跳过）：选择平台（本地调试可选 Sandbox）、填写账号并测试上线。

> 💡 跳过的步骤之后可以在 Console「功能 → AI 与模型」「功能 → 适配器」里继续，也可以在终端运行 `npx zhin setup --ai` / `npx zhin setup --adapters`。

### 3. 可选：在终端里配置

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

### 4. 创建插件

```bash
# 在 plugins/my-awesome-plugin/ 生成项目内插件
npx zhin new my-awesome-plugin
```

生成的是约定式插件包：`plugin.ts` 默认导出 `definePlugin()`，能力放在约定目录。

### 5. 开发插件

```bash
# plugins/my-awesome-plugin/plugin.ts                    # 插件入口（definePlugin）
# plugins/my-awesome-plugin/commands/<name>/index.ts     # 命令（defineCommand）
# plugins/my-awesome-plugin/pages/<name>/index.ts        # Console 页面（definePage）
# plugins/my-awesome-plugin/skills/<name>/SKILL.md       # Skill 说明（可选）

# pnpm dev 监听 source 与 config，保存后自动重载
```

### 6. 配置插件

`zhin.config.yml` 的 `plugins` 是「实例键 → 配置」的映射（不是包名数组），插件拓扑由 `package.json#zhin.plugins` 声明：

```yaml
plugins:
  sandbox:
    commandPrefix: /
  my-awesome-plugin: {}
```

### 7. 生产环境部署

```bash
# 类型检查
pnpm build

# 前台启动
pnpm start

# 或交给 PM2 守护
pnpm pm2:start
pnpm pm2:logs
pnpm pm2:stop
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
   # 检查 Node.js 版本（生成的 TypeScript 项目需要 >=22.19.0）
   node --version
   
   # 升级 Node.js
   # 使用 nvm 或从官网下载最新版本
   ```

## 环境要求

- **Node.js**: >=22.19.0（创建目录前会检查）
- **npm**: >= 8.0.0 (或对应版本的 yarn/pnpm)
- **操作系统**: Windows 10+, macOS 10.15+, Linux (现代发行版)

## 与其他工具对比

| 特性 | create-zhin-app | create-react-app | create-vue |
|------|-------------|------------------|------------|
| 零配置创建 | ✅ | ✅ | ✅ |
| 多配置格式 | ✅ | ❌ | ✅ |  
| AI Agent 运行时（Endpoint） | ✅ | ❌ | ❌ |
| 热重载开发 | ✅ | ✅ | ✅ |

## 高级用法

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
- name: create zhin-app Endpoint Project
  run: |
    npm create zhin-app my-bot -- --yes
    cd my-bot
    pnpm build
```

## 故障排查

### 调试模式

```bash
# 失败时打印完整堆栈与安装输出（任意非空值即可）
DEBUG=1 npm create zhin-app my-bot
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
