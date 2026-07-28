# 案例：个人生活助手

> 对应示例：[`examples/life-assistant-bot`](../../examples/life-assistant-bot/)
> 关键词：本地模型、知识库、三层记忆、定时任务、零云成本

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
└────────────┘  :8086  │  ├─ ZhinAgent（对话/工具/压缩）  │
                       │  ├─ knowledge_search（知识库）   │
┌────────────┐         │  ├─ 三层 Markdown 记忆           │
│  Ollama    │ ◀────── │  └─ Assistant Runtime（定时任务）│
│  :11434    │  HTTP   └─────────────────────────────────┘
└────────────┘
```

## 关键配置（脱敏）

```yaml
# zhin.config.yml
plugins:
  sandbox:
    endpoints:
      - context: sandbox
        name: assistant
        owner: assistant-user

ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
  knowledge:
    baseDir: ./knowledge        # 我的笔记目录，knowledge_search 自动检索
```

## 踩过的坑

1. **本地模型上下文短**：qwen3:8b 长对话会爆上下文。解法：zhin 的会话压缩是内置的，
   不用自己写；把 `knowledge/` 里大文档拆小，检索命中率明显更好。
2. **提醒任务想"别烦我"**：assistant 的定时任务默认失败也通知。
   `assistant.defaults.notifyOnFailure: false` 关掉。
3. **Console 连不上**：Host  token 在 `.env` 的 `HTTP_TOKEN`，
   Console 里填 `http://127.0.0.1:8086` + 该 token 即可，不用配任何账号系统。

## 后续扩展路径

- 加 `@zhin.js/adapter-qq` → 同一个助手进 QQ
- `pnpm add @zhin.js/speech` → 语音输入/播报
- 换云模型只需改 `ai.providers`，本地/云可并存做分流
