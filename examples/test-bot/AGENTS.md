# Agent Memory

## 仓库定位（必读）

- **本目录是维护者厨房水槽**，不是用户/脚手架默认模板。
- 新功能验证优先 [`../minimal-bot`](../minimal-bot/)（Stable）或 [`../full-bot`](../full-bot/)（L4）。
- 根目录 `pnpm dev` 指向此处，仅供本仓库全 adapter / MCP 回归。

## AI 配置注意

- **OpenCode 等网关**：`ai.providers.opencode` 可省略 `sdk`（preset 自动 `openai-compatible`）；务必设 `contextWindow` 或使用 preset 默认 32768。
- **默认 zhin agent** 仅挂载 `icqq` MCP；`github` MCP 注释掉以减小 Agent prompt（需要时再开）。
- 免费/推理模型 + 全量工具易触发上下文溢出或空回复；私聊可先 `/reset`。

## User Preferences

- Language: 简体中文
- Style: concise, action-first
- Tech stack: TypeScript, Node.js, pnpm
