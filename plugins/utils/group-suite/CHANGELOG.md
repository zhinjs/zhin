# @zhin.js/plugin-group-suite

## 0.1.0

### Breaking

- 合并并取代 `@zhin.js/plugin-group-admin`、`plugin-checkin`、`plugin-stats`、`plugin-group-daily-analysis`、`plugin-teach`。
- 配置统一为顶层 **`groupSuite`**，不再支持 `checkin` / `stats` / `teach` / `group-daily-analysis` 等旧键。
- **`groupSuite` 为扁平单层字段**（无 `admin:` / `checkin:` 嵌套）；`rankSize` 共用，`statsRetentionDays`、`teachCooldownMs`、`analysisGroups` 等见 README。
