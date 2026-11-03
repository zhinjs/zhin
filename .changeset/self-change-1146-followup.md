---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

自变更跨 #1146 升级：旧版本遗留的 `applying` / `verifying` 记录若带配置补丁但缺少 `configRevision`，恢复时不再自动续作（无论是否存在配置快照或配置端口，回滚前即停止，不改动任何文件），记录转为 `failed` 并保留现场等待人工核验（补充回归测试）。配置回执出现 `restart-pending` 分组但保存结果 `restartRequired` 不为 true 时，按 `unconfirmed` 处理。文档说明 `change_config_unconfirmed` / `change_config_superseded` 下记录为 `failed`、决策事件 outcome 保持 `defer`。
