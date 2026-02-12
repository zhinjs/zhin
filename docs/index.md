---
layout: home

hero:
  name: "Zhin.js"
  text: "AI 驱动的 TypeScript 机器人框架"
  tagline: AI 驱动 · 插件化 · 热重载 · TypeScript · 多平台
  image:
    src: /logo.svg
    alt: Zhin
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started/
    - theme: alt
      text: AI 智能
      link: /advanced/ai
    - theme: alt
      text: 插件开发
      link: /essentials/plugins
    - theme: alt
      text: API 文档
      link: /api/

features:
  - icon: "\uD83E\uDDE0"
    title: AI 驱动
    details: 内置 ZhinAgent 智能体，接入 OpenAI / Ollama 等大模型。支持多轮对话、流式输出、Tool 工具调用、Skill 语义路由。

  - icon: "\uD83E\uDDE9"
    title: Feature 可扩展架构
    details: 命令、工具、技能、定时任务、数据库等所有能力统一抽象为 Feature，插件按需组合，自动管理生命周期。

  - icon: "\uD83D\uDD0C"
    title: 插件化架构
    details: 基于 AsyncLocalStorage 的上下文管理，React Hooks 风格 API。支持热插拔、Web 控制台管理。

  - icon: "\u26A1"
    title: 智能热重载
    details: 插件代码、配置文件修改即时生效，无需重启。智能依赖管理，语法错误自动回滚。

  - icon: "\uD83D\uDCAA"
    title: TypeScript 全量类型
    details: 完整的类型推导和提示，提供极佳的开发体验。100% 类型覆盖。

  - icon: "\uD83C\uDF10"
    title: 多平台生态
    details: 支持 QQ、Discord、Telegram、KOOK、Slack、钉钉、飞书等 12 个平台。统一 API 接口，适配器自动暴露 AI 能力。

---
