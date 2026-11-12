---
title: "案例：个人生活助手"
description: "用本地 Ollama 模型搭一个会聊天、记事、查笔记、按时提醒的私人助手，数据不出本机"
---

# 案例：个人生活助手

::: info 案例信息
- 对应示例：[`examples/life-assistant-bot`](https://github.com/zhinjs/zhin/tree/main/examples/life-assistant-bot)
- 关键词：本地模型、知识库、三层记忆、定时任务、零云成本
:::

## 场景

一个跑在自己机器上的私人助手：能聊天、记得住事、会查我的笔记、按时提醒我。
不想把数据交给云厂商，模型用本地 Ollama。

## 为什么选 zhin

| 候选 | 放弃原因 |
|------|----------|
| 直接写 Ollama HTTP 调用 | 记忆、工具、会话压缩都要自己造，两周后变成一坨 |
| Koishi / NoneBot | 插件生态强，但 AI Agent 面（工具编排、记忆、子任务）不是一等公民 |
| LangChain 脚本 | 是库不是产品：没有 IM 接入、没有管理台、没有权限 |

zhin 的契合点：**IM 框架和 AI 是可拆开的**——这个案例里 AI 全本地，但将来想接 QQ/微信
只需加一个适配器包，助手逻辑一行不改。

## 部署架构

```
┌────────────┐   ws    ┌─────────────────────────────────┐
│  浏览器     │ ──────▶ │  zhin（life-assistant-bot）      │
│  Console   │  API    │  ├─ Sandbox 适配器（本地调试）    │
└────────────┘  :8068  │  ├─ ZhinAgent（对话/工具/压缩）  │
                       │  ├─ knowledge_search（知识库）   │
┌────────────┐         │  ├─ 三层 Markdown 记忆           │
│  Ollama    │ ◀────── │  └─ Assistant Runtime（定时任务）│
│  :11434    │  HTTP   └─────────────────────────────────┘
└────────────┘
```

## 关键配置（脱敏）

```yaml
# zhin.config.yml
configVersion: 2

http:
  host: 127.0.0.1
  port: 8068
  token: ${HTTP_TOKEN}

plugins:
  sandbox: '@zhin.js/adapter-sandbox'

sandbox:
  endpoints:
    - id: local-sandbox
      owner: assistant-user

ai:
  enabled: true
  knowledge:
    baseDir: ./knowledge        # 我的笔记目录，knowledge_search 自动检索
```

```yaml
# ai.plan.yml（由 npx zhin setup --ai 生成，首次启动自动导入）
version: 1
services:
  - id: ollama
    label: Ollama (Local)
    driver: ollama
    baseUrl: http://127.0.0.1:11434
accounts:
  - id: ollama-local
    label: Local Ollama
    serviceId: ollama
    authKind: none
profiles:
  - id: default-chat
    label: Local Qwen
    serviceId: ollama
    accountId: ollama-local
    model: qwen3:8b
defaults:
  chatProfileId: default-chat
```

## 踩过的坑

1. **本地模型上下文短**：qwen3:8b 长对话会爆上下文。解法：zhin 的会话压缩是内置的，
   不用自己写；把 `knowledge/` 里大文档拆小，检索命中率明显更好。
2. **提醒任务想"别烦我"**：assistant 的定时任务默认失败也通知。
   `assistant.defaults.notifyOnFailure: false` 关掉。
3. **Console 连不上**：Console 里填 `http://127.0.0.1:8068`。第一次连接时用 `.env` 里的 `HTTP_TOKEN`（初始化令牌）创建所有者账号，
   之后用账号登录（或先运行 `npx zhin console init`）；只想聊天可以直接打开 `http://127.0.0.1:8068/sandbox`。

## 后续扩展方向

- 加 `@zhin.js/adapter-qq` → 同一个助手进 QQ
- `pnpm add @zhin.js/speech` → 语音输入/播报
- 换云模型只需在 `ai.plan.yml` 或 Console 里新增云端 Service / Profile，本地与云端模型可并存分流

## 下一步

- [AI Agent 路径](../paths/ai-agent.md)：一步步给 Bot 加上模型和工具
- [AI 总览](../ai/index.md)：模型服务、记忆与助手配置
- [多平台社区 Bot](./community-bot.md)：另一个案例
