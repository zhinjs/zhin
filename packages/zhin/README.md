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
