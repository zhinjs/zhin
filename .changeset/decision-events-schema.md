---
"@zhin.js/agent": patch
---

新增决策审计表 `ai_decision_events`（ADR 0036 切片 A，只有表结构与码表，尚无写入）：

- 字段与 ADR 一一对应：`id`、`ts`、`turn_id`、`instance_id`、`platform`、`scene_id`（与会话画像 `scene_key` 同口径）、`user_id`、`kind`、`outcome`、`reason_code`、`reason_detail`、`payload`、`actor`、`actor_id`；随 AI 持久化表一起注册，append-only。
- `kind` / `outcome` / `actor` 枚举与 `reason_code` 码表集中定义；码表外的值一律记为 `unknown`，原值写进 `reason_detail`。
- 序列化时 `reason_detail` 截到 200 字，`payload` 去掉密钥、Cookie、token 与完整提示词；`actor=operator` 必须带 `actor_id`。
