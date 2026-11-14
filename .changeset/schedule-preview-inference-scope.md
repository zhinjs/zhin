---
"@zhin.js/agent": patch
---

`schedule_preview` 不再因 `AI provider: forbidden` 失败（#1250）：预演在聊天回合的工具调用里启动自己的回合，却沿用了外层聊天回合捕获的推理快照，而该快照只属于外层回合的操作与会话，于是被拒绝、模型都没选出（`ai.usage` 记录 `model: ?`）。现在回合只复用属于自己的快照，预演、正式执行与聊天走同一套模型解析。定时任务执行失败的日志改为 `op=schedule_execute_failed`，带 `jobId`、`purpose`（preview / scheduled）与 Agent 绑定名。
