---
"@zhin.js/adapter-sandbox": patch
---

Sandbox：群聊里输入的 `[@<机器人 id 或 nickname>]` 现在解析为对机器人的 mention（此前只是普通文本，消息被静默忽略）；其他 `[@名称]` 解析为普通 mention 段。（#1250）
