# Zhin.js 是什么？

**一句话**：Zhin.js 是用 TypeScript 编写**跨平台 IM 机器人**的框架；可选叠加 **AI Agent** 做自然语言对话与工具调用。

若你熟悉 [Koishi](https://koishi.chat/zh-CN/) 的「插件 + 多平台」或 [Karin](https://karin.deno.dev/) 的「几行代码起 bot」，可以把 Zhin 理解为：**TypeScript 优先、出站链路统一、IM 核心可单独安装（&lt;10MB）** 的同类方案，并内置可选 Agent 编排与安全 Harness。

## 能做什么？

| 场景 | 你会用到 |
|------|----------|
| 多平台客服 / 群管 | 一套插件逻辑，QQ、Discord、Telegram 等同跑 |
| AI 助手 | `@zhin.js/agent` + Provider，多轮对话与工具 |
| 运维通知 | Webhook、邮件、GitHub 等 Endpoint |
| 本地调试 | Sandbox + Remote Console，无需先接真机 |

**产品边界**：面向生活/工作类 IM 助手，**不是** Cursor / Claude Code 类 coding agent。见 [能力分档](/essentials/capability-tiers)。

## 核心概念（30 秒）

```
Adapter（平台协议） → Endpoint（账号实例） → Plugin（你的功能）
入站消息 → Dispatcher → 命令 / AI → 统一出站链路 → 平台
```

- **Plugin**：`usePlugin()` 注册命令、中间件、工具（须在文件顶层调用）
- **Endpoint**：一个 QQ 号、一个 Discord Bot、一个 Sandbox 会话
- **ZhinAgent**（可选）：在入站消息上跑大模型与工具

一页展开：[核心概念速查](/essentials/)。

## 和常见方案对比

| | Zhin.js | Koishi | 从零写 SDK |
|---|---------|--------|------------|
| 语言 | TypeScript 原生 | 以 JS 为主，支持 TS | 自定 |
| 多平台 | 20+ Adapter，统一 Message API | 生态以 QQ 为主，平台丰富 | 每平台一套 |
| AI | 可选 `@zhin.js/agent`，编排 + Harness | 靠插件组合 | 自研 |
| 热重载 | 插件/配置保存即加载 | 支持 | 自研 |
| 安装体积 | IM 核心 &lt;10MB（4.x 分档） | 视插件而定 | — |

与 **协议端**（如 [NapCatQQ](https://napneko.github.io/)）的关系：NapCat 提供 QQ 协议能力；Zhin 通过 `@zhin.js/adapter-napcat` 等适配器接入，上层仍写 Zhin 插件与命令。

## 两个安装层级

| 层级 | 包 | 约体积 | 能力 |
|------|-----|--------|------|
| **IM 核心** | `zhin.js` | &lt;10 MB | 多平台、命令、插件、热重载 |
| **+ AI** | `@zhin.js/agent` 等 | +约 12–15 MB | Agent、会话、工具、压缩 |

详见 [Install tiers](/getting-started/#install-tierszhinjs-4x) 与 [ADR 0019](/adr/0019-install-size-layering)。

## 建议阅读顺序

::: tip 先跑起来，再加深
1. [快速开始](/getting-started/) — 5 分钟 Sandbox 首跑  
2. [消息如何流转](/essentials/message-flow) — 弄清入站/出站  
3. [插件开发](/guide/plugin-development) — 写自己的功能  
4. [学习路径](/essentials/learning-paths) — 按 L1–L4 选读  
:::

完整资源索引：[生态与资源](/ecosystem)。
