---
layout: home

hero:
  name: "Zhin.js"
  text: "用 TypeScript 写一个跨平台聊天机器人"
  tagline: 一套代码，同时跑在 QQ、Discord、Telegram、飞书、钉钉、Slack 等 20+ 平台。可选接入 AI Agent。
  image:
    src: /logo.svg
    alt: Zhin
  actions:
    - theme: brand
      text: 5 分钟上手 →
      link: /getting-started/
    - theme: alt
      text: 这是什么？
      link: /what-is-zhin

features:
  - icon: "💬"
    title: 20+ 平台，一套代码
    details: QQ、Discord、Telegram、飞书、钉钉、Slack、KOOK、邮件、GitHub……写一次插件，所有平台通用。

  - icon: "🧠"
    title: AI Agent（可选）
    details: 另装 @zhin.js/agent 即可接入 OpenAI / Ollama / DeepSeek，支持多轮对话、工具调用、技能路由。不装 AI 照样用。

  - icon: "⚡"
    title: 改代码即生效
    details: 插件热重载，改完保存自动加载，不用重启机器人。语法错误自动回滚，不影响正在运行的服务。

  - icon: "💪"
    title: TypeScript 原生
    details: 完整类型推导，命令参数、平台差异、AI 工具全部有类型提示。

  - icon: "🔌"
    title: 插件化，按需组合
    details: 命令、定时任务、数据库、AI 工具——每个能力都是独立插件，用什么装什么。

  - icon: "🛡️"
    title: 安全沙箱
    details: AI 执行命令有 5 层安全策略：命令白名单、文件访问、网络域名、资源预算、审计日志。

---

## 10 行代码，一个能用的机器人

```typescript
import { usePlugin, addCommand } from 'zhin.js'

const plugin = usePlugin()

addCommand('hello')
  .action(() => '你好！我是 Zhin.js 机器人 🤖')

addCommand('echo <text>')
  .action((_, text) => text)
```

保存文件，机器人自动热重载。在 QQ、Discord 或任何已配置的平台发送 `/hello`，立刻收到回复。
