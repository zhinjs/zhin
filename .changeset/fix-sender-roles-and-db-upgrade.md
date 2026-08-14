---
'@zhin.js/command': patch
'@zhin.js/agent': patch
---

fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

`resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。
