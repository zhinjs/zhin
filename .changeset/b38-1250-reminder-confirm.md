---
"@zhin.js/plugin-reminder": patch
---

`remind create` 的预览与确认合并为一条消息，并改用 Core 的 `confirm` 交互（#1250 第 38 批）：支持按钮的平台显示「确认 / 取消」按钮，其他平台显示编号选项；只有发起人能回答。正文、会话与账号以代码形式显示，不会被 Markdown 解释。
