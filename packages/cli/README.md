# @zhin.js/cli

Zhin 机器人框架的全功能命令行工具，提供项目创建、开发调试、构建部署等完整开发流程支持。

## 核心功能

- 🚀 **项目初始化**: 交互式创建新项目，支持多种配置格式
- 🔥 **开发模式**: 热重载开发服务器，实时代码更新
- 📦 **项目构建**: TypeScript编译和优化
- 🛠️ **进程管理**: 生产环境启动、停止、重启、后台运行
- ⚙️ **多运行时**: 支持 Node.js 和 Bun 运行时
- 📄 **多配置格式**: 支持 JS/TS/JSON/YAML/TOML 配置文件

## 命令详解

### init - 项目初始化

创建新的 Zhin 机器人项目，支持交互式配置：

```bash
zhin init [project-name] [options]
```

**选项：**
- `-c, --config <format>`: 配置文件格式 (json|yaml|toml|ts|js)，默认 js
- `-p, --package-manager <manager>`: 包管理器 (npm|yarn|pnpm)，默认 pnpm  
- `-r, --runtime <runtime>`: 运行时 (node|bun)，默认 bun
- `-y, --yes`: 使用默认选项，跳过所有交互

**生成的项目结构：**
```
my-bot/
├── src/
│   ├── index.ts          # 主入口文件
│   └── plugins/          # 插件目录
│       └── test-plugin.ts # 示例插件
├── lib/                 # 构建输出目录
├── data/                 # 数据存储目录
├── zhin.config.[ext]     # 配置文件
├── package.json         # 项目配置
├── tsconfig.json        # TypeScript配置
├── .gitignore           # Git忽略规则
└── README.md            # 项目文档
```

**配置文件支持：**
- JavaScript (`zhin.config.ts`) - 支持环境变量和动态配置
- TypeScript (`zhin.config.ts`) - 完整类型支持
- JSON (`zhin.config.json`) - 简单静态配置
- YAML (`zhin.config.yaml`) - 人性化格式
- TOML (`zhin.config.toml`) - 结构化配置

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
- `-p, --port [port]`: HMR服务端口，默认 3000
- `--verbose`: 显示详细日志输出
- `--bun`: 使用 bun 运行时（默认使用 tsx）

**环境变量：**
```bash
NODE_ENV=development
ZHIN_DEV_MODE=true
ZHIN_HMR_PORT=3000
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
- 🔧 强制终止选项
- 🧹 清理 PID 文件
- 📝 详细停止日志

### build - 项目构建

编译 TypeScript 代码为生产环境 JavaScript：

```bash
zhin build [options]
```

**选项：**
- `--clean`: 构建前清理输出目录

**功能：**
- 📦 TypeScript 编译
- 🎯 类型检查
- 🗂️ 文件组织
- ⚡ 构建优化

## 完整工作流程

### 1. 创建新项目

```bash
# 交互式创建
zhin init my-awesome-bot

# 快速创建（使用默认配置）
zhin init my-bot -y

# 自定义配置
zhin init my-bot -c ts -p pnpm -r bun
```

### 2. 开发阶段

```bash
cd my-awesome-bot

# 开发模式启动
zhin dev

# 详细日志模式
zhin dev --verbose

# 自定义端口
zhin dev --port 8080
```

### 3. 生产部署

```bash
# 构建项目
zhin build

# 前台测试
zhin start

# 后台部署
zhin start --daemon --log-file ./logs/production.log
```

### 4. 运维管理

```bash
# 重启服务
zhin restart

# 停止服务  
zhin stop

# 重新构建并重启
zhin build && zhin restart
```

## 高级配置

### 多环境配置

```javascript
// zhin.config.ts
import { defineConfig } from '@zhin.js/core';

export default defineConfig(async (env) => {
  const isProduction = env.NODE_ENV === 'production';
  
  return {
    bots: [
      {
        context: 'onebot11',
        name: 'main-bot',
        url: env.BOT_URL || 'ws://localhost:8080',
        access_token: env.ACCESS_TOKEN,
      }
    ],
    plugin_dirs: [
      './src/plugins',
      ...(isProduction ? [] : ['./dev-plugins'])
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
   lsof -i :3000
   
   # 使用不同端口
   zhin dev --port 8080
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