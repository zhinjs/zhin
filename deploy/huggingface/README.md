---
title: Zhin.js Playground
emoji: 🤖
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
license: mit
app_port: 7860
short_description: Zhin.js Plugin Runtime Sandbox playground
---

# Zhin.js Playground

在线体验 [Zhin.js](https://github.com/zhinjs/zhin) **Plugin Runtime**（`zhin runtime start`）。

- Space：https://huggingface.co/spaces/zhinjs/demo （旧名 `zhinjs/zhin-playground` 会 307 到这里）
- App：https://zhinjs-demo.hf.space

## 怎么玩

1. 打开 App → [/sandbox](https://zhinjs-demo.hf.space/sandbox)（或 [/console](https://zhinjs-demo.hf.space/console) 进沙盒）
2. 或打开 [console.zhin.dev](https://console.zhin.dev)，API Base 填 `https://zhinjs-demo.hf.space`，Token 填 `zhin-demo`
3. 命令以 `/` 开头；AI 对话用前缀 `ai:` / `AI:` / `#`（例如 `ai: 你好`）

## 可用命令

| 命令 | 说明 |
|------|------|
| `/hello [name]` | 向你问好 |
| `/playground` | 查看帮助 |
| `/echo <msg>` | 复读消息 |
| `/time` | 查看服务器时间 |
| `/dice [faces]` | 掷骰子 |
| `ai: …` | OpenRouter `openrouter/free` Agent |

## 说明

- 栈：Plugin Runtime + Sandbox + `@zhin.js/agent`（OpenRouter free）
- Secret：`OPENROUTER_API_KEY`（可选 `OPENROUTER_BASE_URL`，默认 `https://openrouter.ai/api/v1`）
- Host 由 CLI 装配；仓库镜像：[`deploy/huggingface`](https://github.com/zhinjs/zhin/tree/main/deploy/huggingface)
