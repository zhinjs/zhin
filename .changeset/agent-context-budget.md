---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
---

feat(agent): 上下文量化与按需披露（#729）。每轮第一次模型请求的上下文开销按段估算（系统提示、工具 schema、按需工具索引、技能目录、专家 agent 目录、已加载技能、记忆、bootstrap、历史、本轮输入），写入回合追踪的 `context_budget`，`zhin trace last` 可见。插件运行时的技能目录和专家 agent 目录改为只列名称加一行说明（最多 96 字符、40 条），技能正文在 `load_skill` 后才注入；未常驻的工具在系统提示 `## Deferred tools` 段列出名称和短说明（只含本回合有权使用的工具）。修复 `load_tool` / `load_skill` 之后模型直接给出文字回复时，agent loop 仍多发一次模型请求的问题。
