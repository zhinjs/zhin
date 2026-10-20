---
"@zhin.js/adapter-qq": patch
---

修复 QQ 官方机器人分页「菜单」只显示标题和翻页按钮、指令列表丢失的问题：一条 QQ 消息只能携带一个 markdown，按钮消息或含内联 markdown 的消息中，文本与内联 markdown 现按顺序合并为同一 markdown 段（模板 markdown 与纯文本消息不变）。图片 + markdown + 按钮（菜单渲染成图片）时，图片先作为独立富媒体消息发送，再发送 markdown 与按钮，避免 msg_type 冲突导致图片丢失。新增导出 `formatOutboundMessages`。
