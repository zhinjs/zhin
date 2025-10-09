# create-zhin

快速创建 Zhin 机器人项目的脚手架工具，提供一键创建和配置新项目的能力。

## 核心特性

- 🚀 **一键创建**: 使用标准的 `npm create` / `yarn create` / `pnpm create` 命令
- 🔧 **智能配置**: 自动处理项目初始化和依赖安装
- 📦 **零安装**: 无需全局安装，直接使用
- 🎯 **参数透传**: 完美支持所有 CLI 参数和选项

## 快速开始

### 使用不同包管理器创建项目

```bash
# npm (推荐)
npm create zhin my-awesome-bot

# yarn
yarn create zhin my-awesome-bot

# pnpm
pnpm create zhin my-awesome-bot

# 使用最新版本
npx create-zhin@latest my-awesome-bot
```

## 工作原理

`create-zhin` 是 `@zhin.js/cli` 的轻量级包装器，它的工作流程如下：

1. **启动脚手架**: 当你运行 `npm create zhin` 时
2. **参数解析**: 解析项目名称和所有命令行参数
3. **调用 CLI**: 自动调用 `zhin init` 命令
4. **参数转发**: 将所有参数原样传递给 CLI 工具
5. **项目创建**: 完成项目初始化和配置

```javascript
// create-zhin 内部实现概览
const args = process.argv.slice(2);
const initArgs = ['init', ...args];

spawn('npx', ['zhin', ...initArgs], {
  stdio: 'inherit',
  cwd: process.cwd()
});
```

## 支持的参数

所有 `zhin init` 支持的参数都可以通过 `create-zhin` 使用：

### 基础用法

```bash
# 使用默认配置创建项目
npm create zhin my-bot

# 交互式创建（会提示选择配置）
npm create zhin my-bot --interactive
```

### 高级配置

```bash
# 完整配置示例
npm create zhin my-bot -- \
  --config ts \
  --package-manager pnpm \
  --runtime bun \
  --yes
```

### 参数详解

| 参数 | 短参数 | 说明 | 可选值 | 默认值 |
|------|--------|------|--------|--------|
| `--config` | `-c` | 配置文件格式 | `js`, `ts`, `json`, `yaml`, `toml` | `js` |
| `--package-manager` | `-p` | 包管理器 | `npm`, `yarn`, `pnpm` | `pnpm` |
| `--runtime` | `-r` | 运行时 | `node`, `bun` | `bun` |
| `--yes` | `-y` | 跳过交互式配置 | 无 | `false` |

## 使用场景

### 1. 快速原型开发

```bash
# 使用默认配置快速创建
npm create zhin quick-prototype -y
cd quick-prototype
npm run dev
```

### 2. 生产项目创建

```bash
# 使用 TypeScript + pnpm + bun 的生产配置
npm create zhin production-bot -- -c ts -p pnpm -r bun
```

### 3. 团队标准项目

```bash
# 为团队创建标准化项目
npm create zhin team-bot -- \
  --config ts \
  --package-manager pnpm \
  --runtime node \
  --yes
```

### 4. 实验性项目

```bash
# 使用最新技术栈
npm create zhin experimental-bot -- -c ts -r bun -y
```

## 生成的项目结构

执行 `create-zhin` 后会生成完整的项目结构：

```
my-awesome-bot/
├── src/
│   ├── index.ts              # 主入口文件
│   └── plugins/              # 插件目录
│       └── test-plugin.ts    # 示例插件
├── lib/                     # 构建输出目录
├── data/                     # 数据存储目录
├── logs/                     # 日志目录（如果配置了）
├── zhin.config.[ext]         # 配置文件
├── package.json             # 项目依赖和脚本
├── tsconfig.json            # TypeScript配置
├── .gitignore               # Git忽略规则
├── .env.example             # 环境变量模板
├── pnpm-workspace.yaml      # pnpm工作空间（如果使用pnpm）
└── README.md                # 项目说明文档
```

## 配置文件格式

### JavaScript 配置 (推荐)

```javascript
// zhin.config.ts
import { defineConfig } from '@zhin.js/core';

export default defineConfig(async (env) => {
  return {
    bots: [
      {
        context: 'process',
        name: `${process.pid}`,
      }
    ],
    plugin_dirs: ['./src/plugins', 'node_modules'],
    plugins: ['process', 'test-plugin'],
    debug: env.DEBUG === 'true'
  };
});
```

### TypeScript 配置

```typescript
// zhin.config.ts
import { defineConfig } from '@zhin.js/core';
import type { AppConfig } from '@zhin.js/core';

export default defineConfig<AppConfig>(async (env) => {
  return {
    bots: [
      {
        context: 'onebot11',
        name: 'main-bot',
        url: env.BOT_URL || 'ws://localhost:8080',
      }
    ],
    plugin_dirs: ['./src/plugins'],
    debug: process.env.NODE_ENV === 'development'
  };
});
```

## 后续步骤

项目创建完成后，可以执行以下操作：

### 1. 进入项目目录

```bash
cd my-awesome-bot
```

### 2. 安装依赖（如果还没安装）

```bash
# 根据选择的包管理器
npm install
# 或
yarn install  
# 或
pnpm install
```

### 3. 开发模式启动

```bash
npm run dev
# 或
yarn dev
# 或  
pnpm dev
```

### 4. 生产环境部署

```bash
# 构建项目
npm run build

# 生产启动
npm run start

# 后台运行
npm run daemon
```

## 错误处理

### 常见错误及解决方案

1. **网络连接问题**
   ```bash
   # 使用国内镜像
   npm config set registry https://registry.npmmirror.com
   npm create zhin my-bot
   ```

2. **权限问题**
   ```bash
   # macOS/Linux
   sudo chown -R $USER ~/.npm
   
   # Windows (以管理员身份运行)
   npm create zhin my-bot
   ```

3. **Node.js 版本问题**
   ```bash
   # 检查 Node.js 版本（需要 >= 18.0.0）
   node --version
   
   # 升级 Node.js
   # 使用 nvm 或从官网下载最新版本
   ```

## 环境要求

- **Node.js**: >= 18.0.0
- **npm**: >= 8.0.0 (或对应版本的 yarn/pnpm)
- **操作系统**: Windows 10+, macOS 10.15+, Linux (现代发行版)

## 与其他工具对比

| 特性 | create-zhin | create-react-app | create-vue |
|------|-------------|------------------|------------|
| 零配置创建 | ✅ | ✅ | ✅ |
| 多配置格式 | ✅ | ❌ | ✅ |  
| 多运行时支持 | ✅ | ❌ | ❌ |
| 机器人框架 | ✅ | ❌ | ❌ |
| 热重载开发 | ✅ | ✅ | ✅ |

## 高级用法

### 自定义模板

虽然 `create-zhin` 主要调用 CLI 工具，但你可以通过环境变量自定义行为：

```bash
# 设置自定义模板路径
ZHIN_TEMPLATE_DIR=/path/to/custom/template npm create zhin my-bot
```

### 批量创建

```bash
#!/bin/bash
# 批量创建多个项目
for name in bot1 bot2 bot3; do
  npm create zhin $name -- -y
done
```

### CI/CD 集成

```yaml
# GitHub Actions 示例
- name: Create Zhin Bot Project
  run: |
    npm create zhin test-bot -- --yes
    cd test-bot
    npm run build
    npm run test
```

## 故障排查

### 调试模式

```bash
# 启用详细日志
DEBUG=create-zhin npm create zhin my-bot

# 检查参数传递
npm create zhin my-bot -- --help
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

`create-zhin` 是开源项目，欢迎贡献：

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License