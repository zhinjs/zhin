---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/ai": patch
"@zhin.js/runtime": patch
---

决策审计 Console 回放（ADR 0036 切片 C）：

- Host 新增只读查询 `plugin.root.decisions`（倒序列表，按平台 / 会话 / kind / outcome / 时间过滤，`nextBefore` 翻页）、`plugin.root.decision-turn`（按 `turn_id` 展开时间线）、`plugin.root.decisions-export`（时间窗导出 JSON，字段与表结构一致，`nextSince` 分页），都需要 `decisions:read`；入口在「机器人状态」页。
- `DecisionEventLog` 增加 `query` / `turn` / `prune` 读取与保留期清理；新增配置 `ai.audit.retentionDays`（默认 14 天），启动时与之后每小时清理过期行，并为 `ts`、`turn_id` 建索引（SQLite / MySQL / PostgreSQL）。
- 不含控制面开关（切片 D）与危险工具硬闸（切片 E）。
