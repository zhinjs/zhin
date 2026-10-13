---
title: Zhin.js 是什么
description: 用一页说清 Zhin.js 解决什么问题、适合谁、一个 Bot 由哪些部分组成，以及接下来该读哪里
---

# Zhin.js 是什么

**Zhin.js 是一个用 TypeScript 写聊天机器人的框架。** 你写一次业务逻辑（命令、自动回复、定时推送、AI 对话），它就能同时跑在 QQ、微信、Discord、Telegram、Slack、钉钉、飞书等 20 多个平台上。

如果用一句话概括它和"直接调平台 SDK"的区别：**平台差异交给适配器，你的代码只面对一种统一的消息。**

## 它适合做什么

| 场景 | 例子 |
| --- | --- |
| 社区 / 群管理 Bot | 签到、抽奖、小游戏、关键词回复、入群欢迎 |
| 个人或团队助手 | 提醒、日程、RSS 订阅、每日简报推送 |
| 多平台客服 / 通知 | 同一套逻辑同时接 QQ 群、企业微信和 Telegram |
| AI 对话助手 | 接入 OpenAI / Ollama 等模型，让 AI 调用你写的工具 |

它**不是**代码编辑器里的编程 Agent（例如 Cursor、Claude Code）。Zhin 的 AI 能力服务于"聊天平台里的机器人"。

## 一个 Bot 由什么组成

先记住这张图，其余文档都是在展开其中某一格：

```text
  聊天平台                       你的项目（一个插件）                      聊天平台
┌──────────┐   ┌──────────┐   ┌──────────────────────────────┐   ┌──────────┐
│ QQ / 微信 │──▶│  适配器   │──▶│ 中间件 → 命令 → （可选）AI Agent │──▶│  适配器   │──▶ 回复
│ Discord… │   │ Adapter  │   │      ↑ 工具 / 组件 / 定时任务   │   │          │
└──────────┘   └──────────┘   └──────────────────────────────┘   └──────────┘
                                         ▲
                        Console（浏览器）：看日志、改配置、发测试消息
```

| 组成部分 | 它是什么 | 你需要做什么 |
| --- | --- | --- |
| **插件** | 你的项目本身就是一个插件；功能多了还可以拆成多个子插件 | 写 `plugin.ts`，并在 `package.json` 里加一个 `zhin` 字段 |
| **命令** | 用户发 `/hello` 时执行的函数 | 在 `commands/hello/index.ts` 里写 `defineCommand()` |
| **中间件** | 每条消息都会经过的拦截器，适合关键词回复、过滤 | 在 `middlewares/` 里写 `defineMiddleware()` |
| **适配器** | 把某个平台接进来的 npm 包，如 `@zhin.js/adapter-qq` | 用 `npx zhin setup --adapters` 选择并填凭据 |
| **AI Agent**（可选） | 没匹配到命令的消息交给大模型回答，模型还能调用你写的工具 | 运行 `npx zhin setup --ai`，在 `tools/` 里写工具 |
| **Console** | 浏览器里的管理后台 [console.zhin.dev](https://console.zhin.dev) | 无需部署，填入 Bot 的地址和 Token 即可 |

每个名词的准确含义见 [核心概念速览](./concepts.md)。

## 三个设计取舍

1. **默认很小，按需加装。** 只装 IM 核心时不到 10MB；需要 AI、图片渲染、语音时再装对应的包。没有模型 Key 也能完整开发和测试。
2. **按目录约定发现能力。** 把文件放进 `commands/`、`middlewares/`、`tools/` 等目录就会自动注册，不需要在入口里手写一长串注册代码。
3. **改代码不用重启。** 保存文件后 Bot 会热重载；如果新代码加载失败，旧版本会继续服务，不会把 Bot 弄挂。

## 你应该从哪里开始

| 你是谁 | 先读 | 然后 |
| --- | --- | --- |
| 第一次接触，想先跑起来 | [快速开始](./index.md)（10 分钟，不需要任何账号或 Key） | [核心概念速览](./concepts.md) |
| 要写自己的功能 | [第一个插件](./first-plugin.md) | [命令](../authoring/commands.md) · [约定目录](../authoring/conventions.md) |
| 要接真实平台 | [平台适配器](../adapters/index.md) | [配置参考](../configuration/index.md) |
| 要加 AI | [AI 总览](../ai/index.md) | [AI Agent 学习路径](../paths/ai-agent.md) |
| 要部署上线 | [部署与恢复](../operations/production.md) | [故障排查](../troubleshooting/index.md) |
| 想理解内部原理或参与贡献 | [分层架构](../concepts/architecture.md) | [贡献指南](../contributing/development.md) |

不想安装？先去 [在线 Demo](https://demo.zhin.dev) 试一试。
