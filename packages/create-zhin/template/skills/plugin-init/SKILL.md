---
name: plugin-init
description: "初始化 Zhin.js 插件项目。Use when asked to create a new plugin, scaffold plugin structure, or set up a plugin project. 引导生成符合 Zhin 规范的目录结构、package.json、tsconfig、入口文件和 README。"
keywords:
  - 创建插件
  - 新建插件
  - 初始化
  - scaffold
  - 脚手架
  - plugin init
  - new plugin
tags:
  - development
  - plugin
  - scaffold
---

# Zhin 插件初始化

引导创建一个符合 Zhin.js 规范的新插件，确保目录结构、命名、配置和入口代码全部合规。

## 适用场景

- 用户说"帮我创建一个插件"、"新建插件"、"初始化一个 xxx 插件"
- 需要从零搭建插件包结构

## 初始化流程

### 第 1 步：确认插件信息

向用户确认：

1. **插件名称**：kebab-case，如 `my-plugin`、`group-manager`
2. **插件类型**：普通插件 / 服务插件 / 适配器插件
3. **核心功能**：命令、中间件、事件、定时任务、AI 工具、Web 页面
4. **是否需要数据库**
5. **是否需要控制台前端**

### 第 2 步：生成目录结构

**命名规范：**
- npm 包名：社区插件 `zhin.js-{name}`，官方插件 `@zhin.js/{name}`
- 目录位于 `plugins/{name}/`

**最小结构（单文件插件）：**

```
plugins/{name}/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── src/
│   └── index.ts
├── tests/
│   └── index.test.ts
└── skills/
    └── {name}/
        └── SKILL.md
```

**模块化结构（多功能插件）：**

```
plugins/{name}/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── src/
│   ├── index.ts          # 入口装配（只做注册，不堆业务）
│   ├── commands/          # 命令处理
│   ├── middlewares/        # 中间件
│   ├── events/            # 事件监听
│   ├── services/          # 业务服务 / Context 注册
│   ├── models/            # 数据库模型
│   └── crons/             # 定时任务
├── client/                # 控制台前端（可选）
│   ├── index.tsx
│   ├── tsconfig.json
│   └── pages/
├── tests/
│   ├── index.test.ts
│   ├── commands.test.ts
│   └── services.test.ts
├── tools/                 # AI 工具声明（可选，*.tool.md）
├── skills/
│   └── {name}/
│       └── SKILL.md
└── lib/                   # 编译产物（gitignore）
```

### 第 3 步：生成 package.json

```json
{
  "name": "zhin.js-{name}",
  "version": "0.1.0",
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "development": "./src/index.ts",
      "import": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["src", "lib", "client", "dist", "skills", "tools", "README.md"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "prepublishOnly": "pnpm build"
  },
  "keywords": ["zhin.js", "plugin", "{name}"],
  "peerDependencies": {
    "zhin.js": "latest"
  }
}
```

### 第 4 步：生成入口文件

**入口 src/index.ts 只做装配，不堆业务：**

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
const { addCommand, addMiddleware, useContext, logger } = plugin

// 配置声明
// const getConfig = plugin.declareConfig('my-plugin', Schema.object({...}))

// 注册命令、中间件、事件等
// import './commands/index.js'
// import './services/index.js'

logger.info('{Name} 插件已加载')
```

**关键约定：**
- `usePlugin()` 只在模块顶层调用
- TS 文件间互导使用 `.js` 扩展名
- 从 `zhin.js` 统一导入框架 API
- `useContext()` 回调返回清理函数

### 第 5 步：生成 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./lib",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js"
  },
  "include": ["src/**/*"],
  "exclude": ["lib", "node_modules", "client", "tests"]
}
```

### 第 6 步：生成测试文件

在 `tests/index.test.ts` 中生成基础测试骨架：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Plugin } from '@zhin.js/core'

describe('{Name} Plugin', () => {
  let plugin: Plugin
  let root: Plugin

  beforeEach(() => {
    root = new Plugin('/test/root.ts')
    plugin = new Plugin('/plugins/{name}/src/index.ts', root)
  })

  afterEach(async () => {
    if (plugin?.started) await plugin.stop()
  })

  it('should create instance', () => {
    expect(plugin).toBeInstanceOf(Plugin)
  })

  it('should start and stop', async () => {
    await plugin.start()
    expect(plugin.started).toBe(true)
    await plugin.stop()
    expect(plugin.started).toBe(false)
  })
})
```

### 第 7 步：生成 README.md

包含：安装、配置、使用示例、命令列表、AI 工具列表、开发说明。

## 检查清单

- [ ] 包名符合 `zhin.js-{name}` 或 `@zhin.js/{name}` 格式
- [ ] `type: "module"` 已设置
- [ ] `exports` 字段包含 development 条件导出
- [ ] `files` 包含 `src`、`lib`、`skills`
- [ ] `peerDependencies` 包含 `zhin.js`
- [ ] 入口文件使用 `usePlugin()` 且在模块顶层
- [ ] 测试文件存在且可运行
- [ ] README 包含安装和使用说明
