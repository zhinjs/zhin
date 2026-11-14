---
"@zhin.js/agent": minor
"@zhin.js/ai": patch
---

`zhin trace` 记录并显示触发消息（脱敏、截断到 120 字的文本、发送者、会话、消息 id）以及「收到 → 回合开始」的等待时间、合流消息数和排队时长；时间线首行显示回合开始前收到消息的时刻（#1250）。trace 因此包含用户发言摘录与发送者 / 会话标识，Console 读取（`/api/agent/traces`、`/api/agent/trace-archive/*`）需要 `agent.view`，见 CLI 文档「触发消息」。修复同一回合内在工具变更后的再补全里调用 `load_tool` 时，下一次模型请求仍未声明该工具、模型只能再调 `discover` 的问题：Agent 循环在下一次请求前刷新工具列表；`load_tool` 成功但本回合策略不允许该工具时返回明确错误。
