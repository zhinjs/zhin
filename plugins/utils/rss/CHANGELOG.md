# @zhin.js/plugin-rss

## 2.0.0

### Patch Changes

- zhin.js@3.0.0

## 1.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - zhin.js@2.0.1

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
  - zhin.js@2.0.0

## 0.0.28

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92

## 0.0.27

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91

## 0.0.26

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90

## 0.0.25

### Patch Changes

- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89

## 0.0.24

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.0.23

### Patch Changes

- zhin.js@1.0.87

## 0.0.22

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 0.0.21

### Patch Changes

- zhin.js@1.0.85

## 0.0.20

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 0.0.19

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 0.0.18

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 0.0.17

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 0.0.16

### Patch Changes

- zhin.js@1.0.80

## 0.0.15

### Patch Changes

- zhin.js@1.0.79

## 0.0.14

### Patch Changes

- zhin.js@1.0.78

## 0.0.13

### Patch Changes

- zhin.js@1.0.77

## 0.0.12

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 0.0.11

### Patch Changes

- zhin.js@1.0.75

## 0.0.10

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 0.0.9

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73

## 0.0.8

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 0.0.7

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 0.0.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 0.0.5

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - zhin.js@1.0.60

## 0.0.4

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.0.3

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.0.2

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
