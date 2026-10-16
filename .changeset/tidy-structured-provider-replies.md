---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

修复 MiniMax 结构化回复的 JSON 文本被 SDK 丢弃后误解析 thinking 的问题。保留完整 JSON 文本并继续严格校验；格式错误最多进行一次无历史、无业务工具的纠正，失败时返回固定提示，不重跑工具或放宽消息契约。
