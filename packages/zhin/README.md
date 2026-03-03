# zhin.js

Zhin.js 主入口包 —— 现代 TypeScript 聊天机器人框架，AI 驱动、插件化、多平台。

本包是 Zhin.js 框架的统一入口，重新导出 `@zhin.js/core` 全部 API 并注入框架级类型声明。

## 快速开始

### 创建项目

```bash
npm create zhin-app my-bot
cd my-bot
pnpm install
pnpm dev          # 开发模式（热重载）
```

### 配置文件

```yaml
# zhin.config.yml
bots:
  - context: icqq
    name: '123456789'
    password: ''
    platform: 2

plugins:
  - adapter-icqq
  - http
  - console

ai:
  enabled: true
  providers:
    - type: openai
      model: gpt-4o
      api_key: ${OPENAI_API_KEY}
```

## 编写插件

```typescript
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool, declareSkill, addCron } = usePlugin()

// 注册命令
addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)

// 注册 AI 工具
addTool(
  new ZhinTool('get_weather')
    .desc('查询天气')
    .param('city', { type: 'string', description: '城市名' }, true)
    .tag('天气', '生活')
    .keyword('天气', '气温')
    .execute(async ({ city }) => `${city}：晴，25°C`)
)

// 声明技能（将插件内的工具聚合）
declareSkill({
  description: '天气查询服务',
  keywords: ['天气', '气温'],
  tags: ['生活'],
})
```

## 导出内容

```typescript
// 重新导出 @zhin.js/core 全部 API
export * from '@zhin.js/core'

// 日志模块
export { default as logger } from '@zhin.js/logger'
```

## 核心概念

- **Plugin** — 基本组织单位，通过 `usePlugin()` Hook 访问框架 API
- **Feature** — 统一抽象（Command、Tool、Skill、Cron、Database、Component、Config、Permission）
- **Adapter** — 多平台适配器（QQ、Discord、Telegram、KOOK 等 12 个平台）
- **MessageDispatcher** — 三阶段消息处理管线（Guardrail → Route → Handle）
- **ZhinAgent** — 内置 AI 智能体，支持工具调用和多轮对话

## AI 与多 Agent

本包在此层提供 **多 Agent 编排** API（基于 `ctx.ai.createAgent()`）：

- **runPipeline(ai, steps, initialInput)** — 多步串联，每步输出作为下一步输入
- **runParallel(ai, tasks)** — 多 Agent 并行执行，返回 `Record<key, 输出>`
- **route(ai, content, rules, defaultOptions?)** — 按条件路由到不同专业 Agent

插件从 `zhin.js` 引入后，在 `useContext('ai', ...)` 内使用即可。按 bot/群组配置多个 ZhinAgent 的调度与路由规划在后续版本提供。

### 编排示例

以下示例中的 `prompt` / `systemPrompt` 可按需细化，使模型输出更稳定、格式更可控。

```typescript
import { useContext, runPipeline, runParallel, route } from 'zhin.js'

// 串联：先总结再翻译（每步的 {input} 会替换为上一步输出）
useContext('ai', async (ai) => {
  const result = await runPipeline(ai, [
    {
      prompt: '请严格用 3 条 bullet 总结以下内容，每条一行，不要多余解释：\n\n{input}',
      systemPrompt: '你是总结助手。只输出 3 条要点，每条一行，不要编号以外的多余文字。',
    },
    {
      prompt: '将以下中文要点逐条翻译成英文，保持 3 条、每行一条，不要增删内容：\n\n{input}',
      systemPrompt: '你是翻译。只输出翻译后的 3 行英文，不要前言或结语。',
    },
  ], userMessage)
})

// 并行：同时生成代码与文档
useContext('ai', async (ai) => {
  const out = await runParallel(ai, [
    {
      key: 'code',
      prompt: '用 TypeScript 写一个在控制台输出 "Hello World" 的示例，仅代码、无注释。',
      systemPrompt: '你只输出可运行的 TypeScript/JavaScript 代码，不要 markdown 包裹、不要解释。',
    },
    {
      key: 'doc',
      prompt: '为「在控制台打印 Hello World 的 TypeScript 程序」写一段 2–3 句的简短说明。',
      systemPrompt: '你只输出纯文本说明，2–3 句，不要代码块或标题。',
    },
  ])
  // out.code, out.doc
})

// 路由：按关键词分发给专业 Agent（{content} 会替换为用户原文）
useContext('ai', async (ai) => {
  const reply = await route(ai, userInput, [
    {
      when: (c) => /代码|code|实现|写一个|示例/.test(c),
      systemPrompt: '你是代码助手。根据用户需求只输出代码或最小可运行示例，必要时加一行注释说明运行方式。',
      prompt: '{content}',
    },
    {
      when: (c) => /翻译|translate|译成|译成英文/.test(c),
      systemPrompt: '你是翻译。只输出翻译结果，保持原有格式（列表/段落），不添加「翻译如下」等前缀。',
      prompt: '{content}',
    },
  ], { systemPrompt: '你是通用助手，简明回答用户问题。' })
})
```

## 常用命令

```bash
pnpm dev          # 开发模式（热重载 + 文件监听）
pnpm start        # 生产模式
npx zhin stop     # 停止守护进程
npx zhin new      # 创建插件模板
npx zhin build    # 构建插件
```

## 文档

- [快速开始](https://zhin.js.org/getting-started/)
- [核心概念](https://zhin.js.org/essentials/)
- [AI 模块](https://zhin.js.org/advanced/ai)
- [API 参考](https://zhin.js.org/api/)

## 许可证

MIT License
