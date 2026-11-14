---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
---

所有用途支持备用模型（#1250 chat-purpose-no-fallback）：聊天、摘要、旁听、Agent 角色（`purposes.agents`）以及 Adapter / Endpoint / 场景的聊天覆盖都可以写 `{ profile, fallbacks }`。只有额度用完、余额不足或鉴权失败时才按顺序换下一个备用模型，从当前对话继续、不重放已执行的工具；失败的模型在恢复前跳过（有供应商提示按提示，日配额到太平洋时间午夜，其他固定冷却）。用了备用模型的回合在 trace 中标记「本轮由备用模型回答」，Console 管理视图可读取跳过中的模型与最近切换。
