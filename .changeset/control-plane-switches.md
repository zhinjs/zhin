---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

控制面四开关（ADR 0036 切片 D）：`emergency_stop` / `muted` / `read_only` / `mention_only`。

- 两级：实例默认 + 会话覆盖（`platform + scene_id`），会话覆盖只能更严；生效顺序 `emergency_stop → 实例 muted → 会话 muted → read_only → mention_only → 常规策略`，先命中先返回。
- 接入 IM 入站、旁听、scene event 唤醒（位于 #995 会话画像发言判定之前，拦下时不调模型），回合中途变更时回复 / scene event / 主动出站在发送前再判一次止损类开关。
- Console `plugin.root.control`（`control:read`）/ `plugin.root.control-set`（`control:write`，必须带 `expectedRevision`，不符返回 conflict）。拦截写 `control_gate`，变更写 `control_change`（`actor=operator`，前后值）。
- 持久化到新表 `ai_control_state`；读不出时 fail closed（按 `emergency_stop` 处理）并拒绝写入，直到重新读成功。模型没有任何工具能读写这些开关。
