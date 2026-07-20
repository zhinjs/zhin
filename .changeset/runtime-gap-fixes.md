---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-satori": patch
---

迁移缺口修复（legacy 功能对齐）：

- html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
- 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
- im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
- `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
- `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。
