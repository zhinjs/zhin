---
title: "核心概念速览"
description: "用大白话解释 Zhin.js 文档里反复出现的名词：插件、约定目录、Feature、适配器、Endpoint、Host、Console、Agent、Generation 等"
---

# 核心概念速览

Zhin 的文档会频繁用到一些名词。本页用一两句话解释每个名词、**你什么时候需要关心它**，以及深入阅读的链接。第一次读时只看 [必须知道的 6 个](#必须知道的-6-个) 就够了。

## 必须知道的 6 个

### 插件（Plugin）

Zhin 里**一切功能都装在插件里，你的项目本身就是一个插件**（称为 Root 插件）。一个插件就是一个普通的 npm 包，只是：

- `package.json` 里多了一个 `zhin` 字段（插件清单），
- 有一个入口文件 `plugin.ts`，默认导出 `definePlugin({ ... })`。

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-bot',
  setup(context) {
    // 可选：启动时要做的事。返回的函数会在卸载 / 热重载时执行。
  },
});
```

功能多了可以拆成多个**子插件**，在 `package.json#zhin.plugins` 里挂载。深入：[插件模型](../concepts/plugin-model.md) · [definePlugin 全景](../authoring/define-plugin.md)

### 约定目录

**把文件放进特定目录，能力就自动注册**，不用在入口里写注册代码。每个能力一个目录，入口叫 `index.ts`，目录路径就是名字：

| 放在这里 | 得到 | 写法 |
| --- | --- | --- |
| `commands/hello/index.ts` | `/hello` 命令 | `defineCommand()` |
| `middlewares/<name>/index.ts` | 每条消息都会经过的中间件 | `defineMiddleware()` |
| `components/<name>/index.tsx` | 可复用的消息卡片（JSX） | `defineComponent()` |
| `handlers/<name>/index.ts` | 平台事件处理（入群、撤回…） | `defineHandler()` |
| `schedules/<name>/index.ts` | 定时任务 | `defineSchedule()` |
| `tools/<name>/index.ts` | 给 AI 调用的工具 | `defineAgentTool()` |
| `pages/<name>/index.tsx` | Console 里的自定义页面 | `definePage()` |

小项目也可以不用目录，直接在 `setup({ addCommand })` 里注册，效果相同。完整列表：[约定目录](../authoring/conventions.md)

### 命令（Command）

用户发 `/hello`、`/remind 10 喝水` 这类消息时执行的函数。参数、选项、权限和 `--help` 都在 `defineCommand()` 里声明。命令前缀由每个平台连接的 `commandPrefix` 单独配置（脚手架生成的 Sandbox 设为 `/`）。深入：[命令](../authoring/commands.md)

### 适配器（Adapter）与 Endpoint

- **适配器**是接入某个平台的 npm 包，例如 `@zhin.js/adapter-qq`、`@zhin.js/adapter-telegram`。
- **Endpoint** 是适配器下的**一个具体账号 / 连接**。一个适配器可以挂多个 Endpoint，所以一个 Bot 能同时登录多个 QQ 号。

本地开发用 **Sandbox** 适配器：它是一个浏览器里的模拟聊天窗口，不需要任何平台账号。深入：[平台适配器](../adapters/index.md) · [端点生命周期](../authoring/endpoint-lifecycle.md)

### 两个配置文件

新手最容易混淆的一点：Zhin 项目有**两处**配置，分工不同。

| 文件 | 回答的问题 | 典型内容 |
| --- | --- | --- |
| `package.json` 的 `zhin` 字段 | **装了什么**（结构） | 入口文件、用到哪些 Feature、挂载哪些子插件 |
| `zhin.config.yml` | **怎么配**（数值） | HTTP 端口、平台凭据、AI 模型、各插件的配置项 |
| `.env` | **秘密** | Token、API Key，在 yml 里用 `${HTTP_TOKEN}` 引用 |

在 `zhin.config.yml` 里，Root 插件的配置写在 `plugin:` 下，子插件的配置写在 `plugins.<instanceKey>:` 下。深入：[配置即数据](../concepts/config-as-data.md) · [配置参考](../configuration/index.md)

### Console

浏览器里的管理后台，地址固定为 [console.zhin.dev](https://console.zhin.dev)，**不需要你部署**。Bot 启动时会打印一个 API 地址（新项目默认 `http://127.0.0.1:8068`），在 Console 里填入这个地址和 `.env` 里的 `HTTP_TOKEN`，就能发测试消息、看日志、改配置、管理插件。深入：[Console](../console/index.md)

## 开始写插件后会遇到的

### Feature

**负责"扫描某个约定目录"的能力包。**比如 `@zhin.js/command` 负责发现 `commands/`，`@zhin.js/tool` 负责发现 `tools/`。在 `package.json#zhin.features` 里声明后才会生效。

你的 Root 插件依赖 `zhin.js` 时，会自动继承常用的 Stable Features（适配器、命令、组件、中间件、事件处理、定时任务），所以大多数项目不用手写。只有 AI 相关目录（`tools/`、`prompt-sections/` 等）需要额外声明——`npx zhin setup --ai` 会替你写好。深入：[插件模型 · Plugin 与 Feature](../concepts/plugin-model.md)

### instanceKey（插件实例）

挂载子插件时给它起的名字，例如 `{ "package": "./plugins/ping-pong", "instanceKey": "ping-pong" }`。它决定了这个子插件读取 `zhin.config.yml` 里哪一段配置。同一个插件包可以用不同 instanceKey 挂载多次，各自独立配置。

### Host

Bot 进程对外开放的 HTTP 服务。Console、Webhook 类平台回调、MCP 等都通过它访问 Bot。由 CLI 在 `zhin runtime start` 时自动装配，端口在 `zhin.config.yml` 的 `http.port`。深入：[部署与恢复](../operations/production.md)

### 消息流与出站

消息的走向是固定的一条线：**平台 → 适配器 → 中间件 → 命令（没匹配时交给 AI）→ 回复 → 适配器 → 平台**。插件发消息要用 `message.$reply()` 或框架提供的发送接口，不要直接调用平台 SDK 发消息，否则会绕过渲染、过滤和日志。深入：[消息流](../concepts/message-flow.md)

### 热重载与 Generation

保存文件后，Zhin 会在后台把整个插件树重新装配一遍（这份装配结果叫一个 **Generation**）。新 Generation 校验通过后一次性切换；**已经在处理中的消息继续用旧版本跑完**，新消息使用新版本。新代码报错时，旧版本继续服务。

写插件时只需记住一条：**在 `setup()` 里申请的资源（定时器、连接），要在返回的清理函数里释放。** 深入：[Generation 生命周期](../concepts/generation-lifecycle.md) · [模块级状态](../authoring/module-state.md)

## 用到 AI 时才需要的

| 名词 | 一句话解释 | 深入 |
| --- | --- | --- |
| **Agent** | 接管"没匹配到命令的消息"，用大模型回答。私聊默认触发；群里用 `ai:` 等前缀或 @ 触发 | [AI 总览](../ai/index.md) |
| **Provider** | 模型服务的连接配置（OpenAI、Ollama…），写在 `ai.providers` | [AI 总览](../ai/index.md) |
| **Tool** | 让 AI 能调用的函数，例如查天气、查数据库。权限与审批由框架策略控制 | [Agent 工具](../authoring/agent-tools.md) |
| **Skill** | 一份 `SKILL.md` 说明书，AI 需要时才加载，适合封装一套操作流程 | [Agent 工具](../authoring/agent-tools.md) |
| **Prompt Section** | 插件贡献给 AI 的背景知识片段（产品术语、规则），只影响上下文，不授予权限 | [Agent 工具](../authoring/agent-tools.md) |
| **MCP** | 两个方向：让 AI 使用外部 MCP 服务器的工具；或把你的 Bot 暴露成 MCP 服务器 | [AI 总览](../ai/index.md) |
| **Workroom** | 让 Agent 处理多步骤、可持久化、需要审核的长任务 | [受治理的业务 Agent](../solutions/governed-agent.md) |

## 下一步

- 还没跑过？[快速开始](./index.md)
- 写第一个功能：[第一个插件](./first-plugin.md)
- 想看完整的分层与包结构：[分层架构](../concepts/architecture.md)
