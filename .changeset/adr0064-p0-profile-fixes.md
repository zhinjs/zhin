---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-github": patch
---

出站段策略按会话类型生效，GitHub 评论保留 Markdown 格式（ADR 0064 P0）。

- F1：适配器画像里按会话类型（`private` / `group` / `channel`，有 `threadId` 时再加 `thread`）声明的 `messaging.segments` 现在会生效：类型段写了 `segments` 就整段替换 `default` 的那份。之前出站投影只读 `default`。`resolveOutboundHtmlPolicy`、`resolveOutboundMediaPolicy`、`resolveOutboundInteractivePolicy`、`resolveOutboundMarkdownPolicy`、`resolveOutboundSupportedSegments` 新增可选参数 `conversation`；`resolveAiOutboundSegments` 的第三个参数也可以直接传会话。不传会话时行为不变。`projectOutboundPayload`、指令菜单翻页和 Agent 的回复段解析都按当前会话解析。
- 受影响的官方适配器只有 QQ 官方：频道会话不再接受图文卡片（`card` / `share`），模型在频道里也看不到这两种段；手写的图文卡片在发送前就以 `unsupported_operation` 拒绝。私聊、群聊和其他适配器不变。
- F2：GitHub 适配器声明 `markdown: 'native'`。`markdown` 段在 Issue / PR 评论里原样发送并保留格式，不再先被转成纯文本；它作为单独的块写进评论，和相邻文字之间空一行。
