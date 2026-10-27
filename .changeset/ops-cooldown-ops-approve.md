---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
---

群管冷却与 `ops:approve` 审批权限（ADR 0037 第 1 期切片 E，§3）。

- 会话运营配置新增 `ops.cooldownMs`（实例默认 60 秒 + 会话覆盖，`0` 关闭）；同一 `platform + scene_id + 工具名` 在冷却期内只能发起一张硬闸审批卡。冷却记录为进程内，重启清空。
- 冷却判定在控制面之后、生成新审批卡之前：命中不入队、不弹卡，本回合同类危险工具 latch，模型收到"冷却中、勿重试/换工具"说明。冷却表自身出错时不拦（冷却是节流不是授权）。
- 审计新增 kind `ops_cooldown` 与码 `ops_cooldown_passed` / `ops_cooldown_hit`；命中同时写一条 `tool_hard_gate` 拒绝，回放串成一条链。
- Console 新权限点 `ops:approve`：结算硬闸审批卡（与旧的 `tool_approvals:resolve` 任一即可）、读审批卡（与 `tool_approvals:read` 任一即可），以及公告 approve / reject / resend（不再接受只有 `control:write` 的令牌）。
- `PluginConsoleRpcMethod` 新增可选 `anyOfPermissions`：持有其中任一权限即满足，对动作算作方法自身的要求。
