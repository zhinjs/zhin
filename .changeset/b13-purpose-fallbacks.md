---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"zhin.js": patch
---

所有用途支持备用模型（#1250 chat-purpose-no-fallback）：聊天、摘要、旁听、Agent 角色（`purposes.agents`）以及 Adapter / Endpoint / 场景的聊天覆盖都可以写 `{ profile, fallbacks }`。额度用完、余额不足或密钥被拒（单纯的 403 不算）时按顺序换下一个备用模型；同一模型连续 2 次超时后下一次尝试也换（#1270）。只换到能接得住这次请求的模型（输入媒体、上下文窗口、工具循环协议），从当前对话继续、不重放已执行的工具；失败的模型在恢复前跳过（有供应商提示按提示，日配额到太平洋时间午夜，其他固定冷却）。用了备用模型的回合在 trace 中标记「本轮由备用模型回答」，Console 管理视图可读取跳过中的模型与最近切换；配置校验错误指明出错的链路径（如 `purposes.adapters.qq.chat.fallbacks[1]`）。
