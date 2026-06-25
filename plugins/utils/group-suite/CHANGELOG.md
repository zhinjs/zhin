# @zhin.js/plugin-group-suite

## 2.0.1

### Patch Changes

- Updated dependencies [7dfafc2]
- Updated dependencies [ae5239c]
  - @zhin.js/satori@0.2.14
  - zhin.js@4.0.1
  - @zhin.js/plugin-html-renderer@2.0.1

## 2.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/plugin-html-renderer@2.0.0

## 1.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - zhin.js@2.0.1
  - @zhin.js/plugin-html-renderer@1.0.1

## 1.0.0

### Patch Changes

- 65f4b0a: 架构优化、类型安全提升与构建系统清理

  **kernel** (minor)

  - PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

  **core** (minor)

  - Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
  - Plugin.stop() 委托 `super.stop()` 消除重复代码
  - Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

  **ai** (minor)

  - BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
  - 修复 fetch/fetchText 的 AbortController 泄漏

  **agent** (minor)

  - 为 7 个模块级单例添加 reset() 函数支持测试隔离
  - 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

  **host-api / plugins** (patch)

  - handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
  - adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.
- Updated dependencies [e62c23a]
  - @zhin.js/plugin-html-renderer@1.0.0
  - @zhin.js/satori@0.2.13
  - zhin.js@2.0.0

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
