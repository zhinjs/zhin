---
"@zhin.js/agent": patch
---

#1250 第 26 批：一条请求只给一条结论，工具返回的错误按失败记录。

- 协作守卫的上限（如「Actors … above the limit」）不再发到聊天，也不再说「需要你来决定」（被停止的协作无法恢复，没有可决定的入口）：原因只写日志和协作 journal；主 Agent 回合还在跑时由它在回复里用一句话交代，后台协作被停时只发一句本地化说明（「后台任务已停止：这次请求的协作次数到了上限。」）。模型主动调用 `escalate` 时，提问末尾说明直接回复即可。
- 委派结果全是内部结局（失败、预算用完、取消、拒绝）时，以下情况不再唤醒主 Agent 另发消息，只留在 trace：同一子 Agent 已为主 Agent 完成过其他子回合（同一委派的 `follow_up`，或后来的 ask / delegate）；本次请求已经告诉过用户一次失败；本次请求的协作已被守卫停止。
- 工具返回 `{ error: '…' }`（非空字符串、Error 或带 message 的对象）或 MCP `isError: true` 时，`TurnToolRuntime` 与旧文本流水线的 `ToolRuntime` 统一按失败处理：journal 记 `tool_failed`（trace、协作工具统计随之为失败），模型读到失败结果，实例日志写一条脱敏后的 warn。`error: null` / `''` / `false`、数组、字符串和带 `ok: true` / `success: true` 的结果不受影响。
- 未执行操作提示把语音工具归为「语音」，不再显示工具名。
