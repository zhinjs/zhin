---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

决策审计开始写入 `ai_decision_events`（ADR 0036 切片 B，写路径埋点）：

- 每条 IM 入站与每次 scene event 唤醒按回合写 append-only 记录，同一回合共享 `turn_id`：入站唤醒（`inbound_wake`）、会话画像不能发言（`speak_gate` + `model_skip`，码 `cannot_speak_muted` / `cannot_speak_muted_all` / `cannot_speak_restricted`，scene event 唤醒同码）、旁听判定（`ambient_decision`）、scene event 无新内容（`scene_event_nothing_new`）、模型调用摘要（`model_run`：模型、耗时、状态、是否发言，不记提示词）、出站（`outbound`：已发 / 抑制 / 失败）。
- 码表追加写路径用码（只增不改）。
- 审计写失败只记日志，不阻断、不拖慢回合；现有日志不变。
