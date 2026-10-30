---
"@zhin.js/ai": patch
---

DeepSeek 默认 `midConversationSystem` 改为 `none`：实测 DeepSeek 的 context 中不能放多段 system，对话中途的 system 消息（事件等）统一降级为带 `user_id:system` 头的 user 消息。显式配置 `compat.midConversationSystem` 仍优先。
