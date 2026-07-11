---
applyTo: "plugins/**,examples/**/src/plugins/**"
---

# Zhin 插件目录默认开发习惯

在插件目录下编辑代码时自动生效，无需手动加载。

## 导入约定

- TypeScript 源文件间互相导入必须使用 `.js` 扩展名：`import { foo } from './bar.js'`
- 核心框架统一从 `zhin.js` 导入：`import { usePlugin, MessageCommand, Cron } from 'zhin.js'`
- 核心包别名：`@zhin.js/core`、`@zhin.js/logger`、`@zhin.js/database`、`@zhin.js/schema`

## 插件入口

- `usePlugin()` 只能在模块顶层调用，不能在 async 函数或 setTimeout 回调内调用
- **`getPlugin()` 只能在插件初始化/装配阶段调用**（register/init、注册命令/中间件/工具之前）；**中间件、命令 action、工具 execute、Cron、事件回调等运行时路径严禁 `getPlugin()`**，应在注册时捕获 `plugin` / `root` 闭包引用
- 入口文件负责装配（注册命令、中间件、Context），不要在入口里堆业务实现
- 优先使用解构：`const { addCommand, addMiddleware, useContext, logger } = usePlugin()`

## 配置

- 配置声明优先使用 `declareConfig(key, Schema.object({...}))`
- 不要在模块顶层直接读取未就绪的 Context

## 生命周期

- 监听器、定时器、路由、Web 入口注册后，必须有对应清理路径
- `useContext()` 回调中返回清理函数用于 stop 时释放资源
- `addCron()` 注册的定时任务自动跟随插件生命周期
- `addComponent()`、`addMiddleware()`、`addCommand()` 自动在插件卸载时移除

## 类型扩展

```typescript
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyServiceType
    }
  }
}
```

## 命令

- 参数从 `result.params` 读取，不要自行解析 `message.$raw`
- 模板语法写全类型：`<name:word>`、`<body:text>`、`[count:number=1]`、`[...items:text]`

## 数据库

- 模型定义使用 `defineModel()` 或 `db.define()`
- 数据库操作只在 `useContext('database', (db) => {...})` 回调中执行

## AI 能力（Tool / Skill / Agent）

三级 AI 能力注册，均跟随插件生命周期自动清理。

> **推荐**：插件包内用 **`agent/`** 目录（`defineTool`、`defineSkill` 等），由框架 `discoverPluginAgentSurface` 自动发现。约定见仓库文档 [docs/advanced/agent-authoring.md](../../../docs/advanced/agent-authoring.md)。下文 `addTool`、`skills/` 适用于简单场景或尚未迁移的遗留代码。

### 插件创作面（agent/，推荐）

```text
plugins/my-plugin/
├── agent/
│   ├── agent.ts              # 可选 defineAgent()
│   ├── instructions.md       # 可选系统提示
│   ├── tools/sync.ts         # defineTool → my_plugin_sync
│   └── skills/my-plugin.md   # 按需技能说明
├── evals/smoke.eval.ts       # 可选 defineEval
└── src/index.ts
```

```typescript
// agent/tools/sync.ts
import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool({
  description: '同步数据',
  parameters: z.object({ force: z.boolean().optional() }),
  execute: async ({ force }) => { /* ... */ },
});
```

- `@zhin.js/agent` / `zod` 为 **optional** `peerDependencies`（IM-only 可不装）；monorepo 放 `devDependencies`，勿写进 `dependencies`
- 发布 npm 前须 `prepublishOnly: "npm run build"` 且 `files` 含 `agent`、`lib`；本地验证 `pnpm check:plugin-agent-publish`

### Tool（单个 AI 可调用能力）

**方式一：程序化注册（适合复杂逻辑）**

```typescript
import { usePlugin, ZhinTool } from 'zhin.js'
const { addTool } = usePlugin()

addTool(new ZhinTool('calculator')
  .desc('计算数学表达式')
  .keyword('计算', '算')
  .param('expression', { type: 'string', description: '表达式' }, true)
  .execute(async (args) => String(eval(args.expression)))
  .toTool()
)
```

**方式二：*.tool.md 文件约定（适合简单工具，零代码或轻代码）**

把 `*.tool.md` 放在插件包的 `tools/` 目录，框架自动扫描、注册：

```
plugins/my-plugin/
├── src/
│   └── index.ts
└── tools/
    ├── greeting.tool.md          # 扁平：纯模板，无需 handler
    └── calculator/
        ├── calculator.tool.md    # 嵌套：带 handler
        └── handler.ts
```

*.tool.md 标准格式（带 handler）：
```markdown
---
name: calculator
description: 计算数学表达式
parameters:
  expression:
    type: string
    description: 数学表达式
    required: true
command:
  pattern: "calc <expression:text>"
  alias: [计算]
keywords: [计算, 算]
tags: [utility]
handler: ./handler.ts
---
```

纯模板 tool（无 handler，body 作为模板，`{{param}}` 替换参数值）：
```markdown
---
name: greeting
description: 生成问候语
parameters:
  name:
    type: string
    description: 用户名
    required: true
tags: [utility]
---

你好，{{name}}！欢迎来到 Zhin 机器人世界。
```

Handler 文件格式：
```typescript
// tools/calculator/handler.ts
export default async function(args: { expression: string }) {
  const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
  const result = new Function(`return ${sanitized}`)();
  return `${args.expression} = ${result}`;
}
```

- 两种方式共存，程序化注册的同名 Tool 优先于文件化版本
- 文件化 Tool 支持热重载（修改 .tool.md 即时生效）
- 搜索顺序：`cwd/tools/` > `~/.zhin/tools/` > `data/tools/` > 插件包 `tools/`

### Skill（技能说明）

#### 推荐：`agent/skills/*.md`

与 `agent/tools/` 配套，放平台/领域说明。frontmatter 示例：

```markdown
---
name: math
description: 数学计算相关能力
keywords: [计算, 数学, 算术]
tags: [utility]
tools: [my_plugin_calculator]
always: false
---

# 数学计算技能
使用计算器工具处理用户的数学表达式...
```

- `tools` 关联 `agent/tools/` 注册的运行时名（含插件前缀，如 `my_plugin_calculator`）
- `always: true` 时技能指令常驻注入 system prompt
- 见 [agent-authoring.md](../../../docs/advanced/agent-authoring.md)

#### 遗留：`skills/<name>/SKILL.md`

工作区或尚未迁移的插件仍可使用包内 `skills/<name>/SKILL.md`；**新插件勿再新增此目录**。框架故意保留与 `agent/skills` 并行扫描；同一 `name` 勿维护两套。见 [agent-authoring.md](../../../docs/advanced/agent-authoring.md#与遗留-skills-并存框架能力)。

### Agent 预设（标准 *.agent.md 文件，框架自动发现）

把 `*.agent.md` 放在插件包的 `agents/` 目录，框架自动扫描、注册：

```
plugins/my-plugin/
├── src/
│   └── index.ts
└── agents/
    └── code-reviewer.agent.md
```

*.agent.md 标准格式：
```markdown
---
name: code-reviewer
description: 代码审查专家，擅长发现 bug 和优化建议
keywords: [代码, 审查, review, bug]
tags: [development]
tools: [read_file, grep, edit_file]
model: gpt-4o
maxIterations: 8
---

你是一个资深代码审查员，专注于安全和性能问题。

## 审查规则
1. 检查输入验证和 SQL 注入风险
2. 检查资源泄漏（未关闭的连接、定时器）
3. 检查异步错误处理
```

- `tools` 声明关联的工具名，与 `addTool()` 注册的工具自动匹配
- body（frontmatter 之后的正文）作为 Agent 的 systemPrompt
- `model`/`provider`/`maxIterations` 可选，控制执行参数
- Skill 和 Agent 都以标准 md 文件提供，统一约定，零学习负担
