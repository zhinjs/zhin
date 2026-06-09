# @zhin.js/plugin-group-suite

## 0.1.8

### Patch Changes

- acf5e0e: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.
- Updated dependencies [acf5e0e]
  - @zhin.js/plugin-html-renderer@0.0.71
  - @zhin.js/satori@0.2.13
  - zhin.js@1.0.93

## 0.1.7

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/plugin-html-renderer@0.0.70

## 0.1.6

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91
  - @zhin.js/plugin-html-renderer@0.0.69

## 0.1.5

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90
  - @zhin.js/plugin-html-renderer@0.0.68

## 0.1.4

### Patch Changes

- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89
  - @zhin.js/plugin-html-renderer@0.0.67

## 0.1.3

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88
  - @zhin.js/plugin-html-renderer@0.0.66

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
