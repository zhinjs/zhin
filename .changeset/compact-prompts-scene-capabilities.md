---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/core": patch
"@zhin.js/adapter": patch
"@zhin.js/prompt-section": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-telegram": patch
---

精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
