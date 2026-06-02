# @zhin.js/plugin-group-suite

## 0.1.2

### Patch Changes

- zhin.js@1.0.87
- @zhin.js/plugin-html-renderer@0.0.65

## 0.1.1

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86
  - @zhin.js/plugin-html-renderer@0.0.64

## 0.1.0

### Breaking

- 合并并取代 `@zhin.js/plugin-group-admin`、`plugin-checkin`、`plugin-stats`、`plugin-group-daily-analysis`、`plugin-teach`。
- 配置统一为顶层 **`groupSuite`**，不再支持 `checkin` / `stats` / `teach` / `group-daily-analysis` 等旧键。
- **`groupSuite` 为扁平单层字段**（无 `admin:` / `checkin:` 嵌套）；`rankSize` 共用，`statsRetentionDays`、`teachCooldownMs`、`analysisGroups` 等见 README。
