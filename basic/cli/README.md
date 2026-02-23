# @zhin.js/cli

Zhin 机器人框架的全功能命令行工具，提供项目创建、开发调试、插件构建、进程管理等完整开发流程支持。

## 核心功能

- 🧩 **插件开发**: 快速创建插件包，自动配置依赖
- 🔥 **开发模式**: 热重载开发服务器，实时代码更新
- 📦 **插件构建**: 构建独立插件包（app + client）
- 🛠️ **进程管理**: 生产环境启动、停止、重启、后台运行
- ⚙️ **多运行时**: 支持 Node.js 和 Bun 运行时

> **注意**: 项目初始化功能已移至 `create-zhin-app`，请使用 `npm create zhin-app` 创建新项目。

## 命令详解

### new - 创建插件

创建新的插件包，自动添加到项目依赖：

```bash
zhin new [plugin-name] [options]
```

**选项：**
- `--type <type>`: 插件类型（`normal` | `service` | `adapter`），默认 `normal`
- `--is-official`: 是否为官方插件（使用 `@zhin.js/` 前缀）
- `--skip-install`: 跳过依赖安装

**生成的插件结构：**
```
plugins/my-plugin/
├── src/                    # 插件逻辑代码
│   └── index.ts           # 插件入口
├── client/                 # 客户端页面（可选）
│   ├── index.tsx          # 页面入口
│   └── pages/             # React 组件
│       └── index.tsx
├── lib/                    # 构建输出
├── dist/                   # client 构建输出
├── package.json           # 插件配置
├── tsconfig.json          # TypeScript 配置
├── README.md              # 插件文档
└── CHANGELOG.md           # 变更日志
```

**自动配置：**
- ✅ 创建完整的 npm 包结构
- ✅ 配置 TypeScript 编译
- ✅ 自动添加到根 `package.json` 依赖（`workspace:*`）
- ✅ 自动安装依赖
- ✅ 生成示例代码（命令、页面）

**使用示例：**
```bash
# 交互式创建
zhin new

# 直接指定名称
zhin new my-awesome-plugin

# 跳过依赖安装
zhin new my-plugin --skip-install
```

### dev - 开发模式

启动开发服务器，支持热重载和实时调试：

```bash
zhin dev [options]
```

**特性：**
- 🔥 **热模块替换 (HMR)**: 代码修改即时生效
- 🔍 **实时监控**: 自动检测文件变化
- 🛠️ **调试友好**: 详细错误信息和堆栈跟踪
- 📊 **性能监控**: 实时性能统计

**选项：**
- `-p, --port [port]`: HMR 服务端口，默认 3000
- `--verbose`: 显示详细日志输出
- `--bun`: 使用 bun 运行时（默认使用 tsx）

**环境变量：**
```bash
NODE_ENV=development
ZHIN_DEV_MODE=true
HTTP_PORT=8086
ZHIN_VERBOSE=false
```

### start - 生产启动

生产环境启动机器人，支持前台和后台运行：

```bash
zhin start [options]
```

**特性：**
- 🚀 **高性能**: 基于编译后的 JavaScript 运行
- 🔄 **自动重启**: 支持配置热更新重启 (exit code 51)
- 📝 **日志管理**: 支持日志文件输出
- 🛡️ **进程管理**: 完善的进程生命周期管理

**选项：**
- `-d, --daemon`: 后台运行模式
- `--log-file [file]`: 指定日志文件路径
- `--bun`: 使用 bun 运行时（默认使用 node）

**使用示例：**
```bash
# 前台运行
zhin start

# 后台运行
zhin start --daemon

# 后台运行并记录日志
zhin start --daemon --log-file ./logs/bot.log

# 使用 bun 运行时
zhin start --bun
```

### restart - 重启服务

重启生产模式下运行的机器人：

```bash
zhin restart
```

**功能：**
- 🔄 检测运行中的进程
- 📋 读取 PID 文件
- ⚡ 发送重启信号
- 🛠️ 自动故障处理

### stop - 停止服务

停止运行中的机器人进程：

```bash  
zhin stop
```

**功能：**
- 🛑 优雅停止进程
- 🔍 自动检测运行状态
- 🧹 清理 PID 文件
- 📝 详细停止日志

### build - 构建插件

构建 `plugins/` 目录下的插件包：

```bash
zhin build [plugin] [options]
```

**参数：**
- `[plugin]`: 可选，指定要构建的插件名称（不指定则构建所有插件）

**选项：**
- `--clean`: 构建前清理输出目录（`lib/` 和 `dist/`）
- `--production`: 生产构建，启用 Tree Shaking（默认开启）
- `--analyze`: 分析包体积

**功能：**
- 📦 构建插件的 app 代码（TypeScript → lib/）
- � 构建插件的 client 页面（TypeScript → dist/）
- �🎯 完整的类型检查
- 🗂️ 自动组织输出文件
- ⚡ 并行构建优化

**使用示例：**
```bash
# 构建所有插件
zhin build

# 只构建特定插件
zhin build my-plugin

# 清理后构建
zhin build --clean

# 清理后构建特定插件
zhin build my-plugin --clean
```

**注意：**
- ❌ 不用于构建主应用（app 本身不需要构建）
- ✅ 只构建 `plugins/` 目录下的独立插件包
- ✅ 每个插件使用自己的 `package.json` 中的 `build` 脚本

## 完整工作流程

### 1. 创建新项目

```bash
# 使用 create-zhin-app（推荐）
npm create zhin-app my-awesome-bot
# 或
pnpm create zhin-app my-awesome-bot

cd my-awesome-bot
```

### 2. 开发阶段

```bash
# 开发模式启动（支持热重载）
pnpm dev
# 或
zhin dev

# 详细日志模式
zhin dev --verbose

# 自定义端口
zhin dev --port 8080
```

### 3. 创建插件

```bash
# 创建新插件
zhin new my-awesome-plugin

# 插件会自动添加到 package.json 依赖
# 在配置文件中启用插件
# 编辑 zhin.config.yml，添加到 plugins 数组：
# plugins: ['adapter-process', 'http', 'console', 'my-awesome-plugin']
```

### 4. 构建插件

```bash
# 构建所有插件
pnpm build
# 或
zhin build

# 只构建特定插件
zhin build my-awesome-plugin

# 清理后构建
zhin build --clean
```

### 5. 生产部署

```bash
# 确保插件已构建
pnpm build

# 前台测试
pnpm start
# 或
zhin start

# 后台部署
pnpm daemon
# 或
zhin start --daemon --log-file ./logs/production.log
```

### 6. 运维管理

```bash
# 重启服务
zhin restart

# 停止服务  
pnpm stop
# 或
zhin stop

# 重新构建插件并重启
pnpm build && zhin restart
```

## 高级配置

### 多环境配置

```javascript
// zhin.config.ts
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  const isProduction = env.NODE_ENV === 'production';
  
  return {
    bots: [
      {
        context: 'process',
        name: `${process.pid}`,
      }
    ],
    plugin_dirs: [
      './src/plugins',
      ...(isProduction ? [] : ['./dev-plugins'])
    ],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'test-plugin'
    ],
    debug: !isProduction
  };
});
```

### 环境变量文件

支持自动加载环境变量文件：
- `.env` - 通用环境变量
- `.env.development` - 开发环境专用
- `.env.production` - 生产环境专用

### 进程管理

**自动重启机制：**
```typescript
// 在插件中触发重启
process.exit(51); // 特殊退出码，会触发自动重启
```

**PID 文件管理：**
- 开发模式：`.zhin-dev.pid`
- 生产模式：`.zhin.pid`

### pub - 发布插件

将插件包发布到 npm：

```bash
zhin pub [plugin-name] [options]
```

**选项：**
- `--tag <tag>`: 发布标签，默认 `latest`
- `--access <access>`: 访问级别（`public` | `restricted`），默认 `public`
- `--registry <url>`: 自定义 npm registry
- `--dry-run`: 试运行，不实际发布
- `--skip-build`: 跳过构建步骤

**使用示例：**
```bash
# 交互式选择要发布的插件
zhin pub

# 指定插件发布
zhin pub my-plugin

# 试运行（不实际发布）
zhin pub my-plugin --dry-run

# 使用自定义 registry
zhin pub my-plugin --registry https://registry.npmmirror.com
```

### install / add - 安装插件

安装插件包（npm 或 git 仓库）：

```bash
zhin install [plugin] [options]
zhin add [plugin] [options]   # 别名
```

**选项：**
- `-S, --save`: 安装到 dependencies（默认）
- `-D, --save-dev`: 安装到 devDependencies
- `-g, --global`: 全局安装

**支持的安装来源：**
- npm 包：`zhin install @zhin.js/adapter-kook`
- GitHub 仓库：`zhin install github:user/repo`
- Git URL：`zhin install git+https://github.com/user/repo.git`

### search - 搜索插件

在 npm 上搜索 Zhin.js 插件：

```bash
zhin search [keyword] [options]
```

**选项：**
- `-c, --category <category>`: 按分类搜索（`utility` | `service` | `game` | `adapter` | `admin` | `ai`）
- `-l, --limit <number>`: 限制结果数量，默认 20
- `--official`: 仅显示官方插件

**使用示例：**
```bash
# 搜索所有 Zhin 插件
zhin search

# 按关键词搜索
zhin search music

# 仅显示官方插件
zhin search --official

# 按分类搜索，限制 5 个结果
zhin search -c adapter -l 5
```

### info - 查看插件信息

查看 npm 上某个插件的详细信息：

```bash
zhin info <package>
```

显示内容包括：名称、版本、描述、作者、发布时间、标签、主页、仓库地址、依赖等。

### doctor - 健康检查

检查系统环境和项目配置，诊断常见问题：

```bash
zhin doctor [options]
```

**别名：** `zhin health`

**选项：**
- `--fix`: 自动修复可修复的问题（如创建默认配置文件、引导文件、`.env` 文件等）

**检查项目：**
- Node.js 版本（>= 18）
- pnpm 安装
- 配置文件（`zhin.config.yml` 等）
- 引导文件（`SOUL.md`、`TOOLS.md`、`AGENTS.md`）
- `package.json` 中是否安装 `zhin.js`
- `node_modules` 目录
- 端口 8086 占用
- TypeScript 安装
- 环境变量文件

### setup - 配置向导

交互式引导配置项目：

```bash
zhin setup [options]
```

**选项：**
- `--bootstrap`: 仅配置引导文件（SOUL.md、TOOLS.md、AGENTS.md）
- `--database`: 仅配置数据库（SQLite / MySQL / PostgreSQL）
- `--adapters`: 仅配置适配器（Sandbox、QQ、KOOK、Discord 等）
- `--ai`: 仅配置 AI（Ollama、OpenAI、DeepSeek 等）

不带选项时，运行完整配置向导。

### config - 配置管理

命令行管理配置文件（支持 YAML / JSON）：

```bash
zhin config <subcommand>
```

**子命令：**

| 子命令            | 说明                                           |
| ----------------- | ---------------------------------------------- |
| `config list`     | 显示所有配置（别名 `ls`）                      |
| `config get <key>`| 获取配置项（支持嵌套路径，如 `ai.enabled`）    |
| `config set <key> <value>` | 设置配置项（值支持 JSON 格式）       |
| `config delete <key>` | 删除配置项（别名 `del`）                   |
| `config path`     | 显示配置文件路径                               |

**使用示例：**
```bash
# 查看所有配置
zhin config list

# 获取某项
zhin config get ai.enabled

# 修改配置
zhin config set http.port 3000
zhin config set ai.enabled true

# 删除配置
zhin config del ai.trigger.prefixes

# 查看配置文件路径
zhin config path
```

### onboarding - 新手引导

新手快速上手教程，包含环境检查和交互式指引：

```bash
zhin onboarding [options]
```

**选项：**
- `-i, --interactive`: 交互式引导模式（创建项目、配置、检查等）
- `-q, --quick`: 仅显示快速开始指南

默认模式显示完整引导：欢迎页、环境检查、快速开始、常用命令、学习资源。

### install-service / uninstall-service - 系统服务

将机器人注册为系统服务，实现开机自启和守护进程监督：

```bash
zhin install-service [options]
zhin uninstall-service
```

**选项：**
- `--user`: 以用户模式安装（仅 systemd）

**支持平台：**
- Linux: systemd（用户模式 / 系统模式）
- macOS: launchd
- Windows: NSSM

## 故障排查

### 常见问题

1. **tsx/bun 未安装**
   ```bash
   # 安装 tsx (Node.js 运行时)
   npm install -D tsx
   
   # 安装 bun
   curl -fsSL https://bun.sh/install | bash
   ```

2. **端口占用**
   ```bash
   # 检查端口占用
   lsof -i :8086
   
   # 使用不同端口
   zhin dev --port 8087
   ```

3. **权限问题**
   ```bash
   # 确保项目目录权限
   chmod -R 755 ./my-bot
   ```

## 依赖项

### 核心依赖
- `commander` - 命令行参数解析
- `inquirer` - 交互式命令行界面  
- `fs-extra` - 增强文件系统操作
- `chalk` - 彩色终端输出
- `ora` - 优雅的加载指示器
- `cross-spawn` - 跨平台进程管理
- `dotenv` - 环境变量管理

### 开发依赖  
- `typescript` - TypeScript 编译器
- `@types/*` - TypeScript 类型定义

## 许可证

MIT License