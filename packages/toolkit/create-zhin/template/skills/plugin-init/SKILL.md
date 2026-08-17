---
name: plugin-init
description: "初始化 Zhin.js 插件项目。Use when asked to create a new plugin, scaffold plugin structure, or set up a plugin project. 引导生成符合 Plugin Runtime 规范的目录结构、package.json、plugin.ts、约定能力目录和 README。"
keywords:
  - 创建插件
  - 新建插件
  - 初始化
  - scaffold
  - 脚手架
  - plugin init
  - new plugin
  - definePlugin
tags:
  - development
  - plugin
  - scaffold
---

# Zhin 插件初始化（Plugin Runtime）

引导创建一个符合 **Plugin Runtime** 的新插件。唯一启动路径是 `zhin runtime start`；插件即 package，`plugin.ts` 必须 default-export `definePlugin()`。

**禁止**再脚手架 `usePlugin()` / `MessageCommand` / `src/index.ts` 命令式注册——`zhin.js/node` 与 `bootstrapNode` 已删除，唯一入口是 Plugin Runtime。

## 适用场景

- 用户说「帮我创建一个插件」「新建插件」「初始化一个 xxx 插件」
- 需要从零搭建插件包结构

## 优先路径（二选一）

| 场景 | 命令 / 动作 | 输出 |
|------|-------------|------|
| 已有 Zhin 项目 | `zhin new <name>`（仓库根或项目根） | 官方 npm 包结构 |
| 全新应用 | `pnpm create zhin-app` | 完整 bot 项目 |

仅当用户明确要求「手写目录」或 `zhin new` 不可用时，才走下方手工流程。

## 初始化流程

### 第 1 步：确认插件信息

向用户确认：

1. **插件名称**：kebab-case，如 `my-plugin`、`group-manager`（须匹配 `^[a-z][a-z0-9-]*$`）
2. **插件类型**：普通插件 / 服务插件 / 适配器插件
3. **核心功能**：命令、中间件、组件、定时任务、AI 工具、控制台页
4. **是否需要数据库**
5. **是否需要控制台前端**

### 第 2 步：生成目录结构

**命名规范：**
- npm 包名：社区插件 `zhin.js-{name}`，官方插件 `@zhin.js/{name}`
- 目录位于 `plugins/{name}/`（或项目内约定路径）

**最小结构（约定目录插件）：**

```
plugins/{name}/
├── package.json          # 含 "zhin" manifest
├── schema.json           # 可选：插件配置
├── plugin.ts             # definePlugin 入口（只做装配）
├── tsconfig.json
├── README.md
├── commands/             # defineCommand，路径即路由
│   └── hello.ts
├── tests/
│   └── hello.test.ts
└── skills/               # 可选：给 AI 用的 SKILL
    └── {name}/
        └── SKILL.md
```

**单文件入门**（不必先拆目录）：见仓库 `examples/single-file-bot/bot.ts`——在 `setup({ addCommand })` 里注册命令。

**按需增加约定目录（一个文件一个能力，default export）：**

| 目录 | API |
|------|-----|
| `commands/**/*.ts` | `defineCommand()` |
| `middlewares/*.ts` | `defineMiddleware()` |
| `components/*.tsx` | `defineComponent()` |
| `tools/*.ts` | `defineAgentTool()` |
| `pages/*.tsx` | `definePage()` |
| `skills/<name>/SKILL.md` | Markdown Skill |
| `agents/<name>.agent.md` | Markdown Agent |

### 第 3 步：生成 package.json

```json
{
  "name": "zhin.js-{name}",
  "version": "0.1.0",
  "type": "module",
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "features": ["@zhin.js/command"]
  },
  "exports": {
    ".": "./plugin.ts"
  },
  "files": ["plugin.ts", "commands", "schema.json", "README.md"],
  "peerDependencies": {
    "zhin.js": "*"
  },
  "devDependencies": {
    "zhin.js": "latest"
  }
}
```

按需在 `features` 增加 `@zhin.js/middleware`、`@zhin.js/component`、`@zhin.js/tool` 等。

### 第 4 步：生成入口 plugin.ts

**只做装配与生命周期，不堆业务：**

```typescript
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: '{name}',
  metadata: { displayName: '{Display Name}' },
  setup(context) {
    // 读配置：context.config.get()
    // 挂资源：context.resources.provide(token, value)
    // 清理：context.lifecycle.add(() => { ... })
    // 命令/中间件放到约定目录，不要在此命令式注册（单文件 demo 可用 addCommand）
  },
});
```

**关键约定：**
- `plugin.ts` **必须** default-export `definePlugin()`，否则装配抛 `does not default-export a Plugin definition`
- 新代码**不要**调用 `usePlugin()` / `getPlugin()` / `MessageCommand`
- TS 文件间互导使用 `.js` 扩展名
- 本地导入 Feature 包：`zhin.js/command`、`zhin.js/plugin-runtime` 等（或 `@zhin.js/*`）
- 使用 AI / Agent 时从 `zhin.js/agent` 引入；须安装 `@zhin.js/agent`、`zod`、`ai` 与所选 `@ai-sdk/*`

### 第 5 步：生成首个命令

`commands/hello.ts`（文件路径即路由 `hello`）：

```typescript
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '打招呼',
  execute() {
    return 'Hello!';
  },
});
```

带参数用 Next.js 风格方括号文件名，例如 `commands/hello/[[name]].ts` → `hello [name]`（可选）；类型与默认值在 `defineCommand({ params })` 中声明（如 `params: { name: { type: 'string', default: 'world' } }`），在 `execute` 里读 `params.name`。必需参数用单方括号 `[name].ts`，捕获所有用 `[...name].ts`（运行时 `params.name` 为 `string[]`）。

### 第 6 步：生成 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js"
  },
  "include": ["plugin.ts", "commands/**/*", "middlewares/**/*", "components/**/*", "tools/**/*"],
  "exclude": ["node_modules", "tests"]
}
```

IM 消息组件用 `jsxImportSource: "zhin.js"`；Satori 出图卡片在文件顶加 `/** @jsxImportSource @zhin.js/satori */`。

### 第 7 步：测试与 README

- 测试：对 `defineCommand` 的 `execute` 做纯函数测，或按仓库现有 Runtime 测试模式装配；**不要**再写 `new Plugin('/path')` 旧生命周期测。
- README：说明命令怎么触发、依赖哪些 Feature、`zhin runtime start` 如何加载本包。

### 第 8 步：输出格式

```markdown
## 已创建
- 包名：`zhin.js-{name}`
- 入口：`plugin.ts`（definePlugin）
- 能力：`commands/...`（列出）

## 下一步
- `zhin.config.yml` 挂上本插件
- `zhin runtime start` / `pnpm dev`
- Sandbox 发送命令原文验证
```

## 文档

- [编写第一个插件](https://zhin.js.org/getting-started/first-plugin)
- [definePlugin](https://zhin.js.org/authoring/define-plugin)
- 仓库：`docs/getting-started/first-plugin.md`、`examples/single-file-bot/`
