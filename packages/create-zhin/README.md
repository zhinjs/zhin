# create-zhin-app

快速创建 Zhin 机器人 workspace 项目的脚手架工具，提供一键创建和配置新项目的能力。

## 核心特性

- 🚀 **一键创建**: 使用标准的 `npm create` / `yarn create` / `pnpm create` 命令
- � **Workspace 结构**: 自动创建 pnpm workspace，支持插件开发
- �🔧 **智能配置**: 自动安装 pnpm、项目依赖
- 🎯 **交互式配置**: 选择运行时、配置格式
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

`create-zhin-app` 是独立的项目脚手架工具，它的工作流程如下：

1. **启动脚手架**: 当你运行 `npm create zhin-app` 时
2. **检测 pnpm**: 自动检测并安装 pnpm（如果未安装）
3. **交互式配置**: 询问项目名称、运行时、配置格式
4. **创建 Workspace**: 生成 pnpm workspace 结构
5. **自动安装依赖**: 在项目根目录执行 `pnpm install`
6. **完成提示**: 显示下一步操作指引

## 支持的参数

### 基础用法

```bash
# 交互式创建（推荐）
npm create zhin-app my-bot

# 指定项目名称
npm create zhin-app my-awesome-bot
```

### 快速创建（跳过交互）

```bash
# 使用默认配置（TypeScript + Node.js）
npm create zhin-app my-bot -y
# 或
npm create zhin-app my-bot --yes
```

### 参数详解

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `[project-name]` | 项目名称（可选，会提示输入） | `my-zhin-bot` |
| `-y, --yes` | 跳过交互，使用默认配置 | `false` |

**默认配置：**
- 配置格式: TypeScript (`zhin.config.ts`)
- 运行时: Node.js
- 包管理器: pnpm（自动安装）

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
# 使用 TypeScript + pnpm + node 的生产配置
npm create zhin-app production-bot -- -c ts -p pnpm -r node
```

### 3. 团队标准项目

```bash
# 为团队创建标准化项目
npm create zhin-app team-bot -- \
  --config ts \
  --package-manager pnpm \
  --runtime node \
  --yes
```

### 4. 实验性项目

```bash
# 使用最新技术栈
npm create zhin-app experimental-bot -- -c ts -r node -y
```

## 生成的项目结构

执行 `create-zhin-app` 后会生成 pnpm workspace 项目结构：

```
my-awesome-bot/
├── src/                      # 应用源代码
│   ├── index.ts             # 主入口文件
│   └── plugins/             # 本地插件目录
│       └── example.ts       # 示例插件
├── client/                   # 客户端页面
│   └── index.tsx            # 示例页面
├── data/                     # 数据存储目录
├── plugins/                  # 插件开发目录（独立包）
│   └── .gitkeep
├── zhin.config.ts            # 配置文件
├── package.json             # 根 package.json（包含依赖和脚本）
├── tsconfig.json            # TypeScript 根配置
├── pnpm-workspace.yaml      # workspace 配置
├── .gitignore               # Git 忽略规则
├── .env.example             # 环境变量模板
└── README.md                # 项目说明文档
```

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
    "build": "pnpm --filter \"./plugins/*\" build"  // 构建所有插件
  }
}
```

## 配置文件格式

### JavaScript 配置 (推荐)

```javascript
// zhin.config.ts
import { defineConfig } from 'zhin.js';

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
import { defineConfig } from 'zhin.js';
import type { AppConfig } from 'zhin.js';

export default defineConfig<AppConfig>(async (env) => {
  return {
    bots: [
      {
        context: 'process',
        name: `${process.pid}`,
      }
    ],
    plugin_dirs: ['./src/plugins', 'node_modules'],
    plugins: [
      'adapter-process',
      'http',
      'console',
      'test-plugin'
    ],
    debug: process.env.NODE_ENV === 'development'
  };
});
```

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

访问 `http://localhost:8086` 查看 Web 控制台

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
# plugins/my-awesome-plugin/app/index.ts  # 插件逻辑
# plugins/my-awesome-plugin/client/       # 客户端页面

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

编辑 `zhin.config.ts`：

```typescript
export default defineConfig({
  plugins: [
    'adapter-process',
    'http',
    'console',
    'example',           // 内置示例
    'my-awesome-plugin'  // 你的插件
  ]
});
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

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License