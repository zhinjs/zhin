# @zhin.js/kernel

## 1.0.4

### Patch Changes

- Updated dependencies [cc5c94d]
  - @zhin.js/schedule@0.0.3
  - @zhin.js/logger@1.0.75

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/logger@1.0.74
  - @zhin.js/schedule@0.0.2

## 1.0.2

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/logger@1.0.73
  - @zhin.js/schedule@0.0.1
  - @zhin.js/schema@1.0.71

## 1.0.1

### Patch Changes

- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72

## 1.0.0

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.1.1)

## 0.1.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71

## 0.1.0

### Minor Changes

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

## 0.0.50

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 0.0.49

### Patch Changes

- 3735e96: fix: 智能家居控制

## 0.0.48

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/schema@1.0.70

## 0.0.47

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 0.0.46

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/schema@1.0.69

## 0.0.45

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68
  - @zhin.js/schema@1.0.68

## 0.0.44

### Patch Changes

- @zhin.js/logger@0.1.67
- @zhin.js/schema@1.0.67

## 0.0.43

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/logger@0.1.66
  - @zhin.js/schema@1.0.66

## 0.0.42

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/logger@0.1.65
  - @zhin.js/schema@1.0.65

## 0.0.41

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/schema@1.0.64

## 0.0.40

### Patch Changes

- @zhin.js/logger@0.1.63
- @zhin.js/schema@1.0.63

## 0.0.39

### Patch Changes

- @zhin.js/logger@0.1.62
- @zhin.js/schema@1.0.62

## 0.0.38

### Patch Changes

- @zhin.js/logger@0.1.61
- @zhin.js/schema@1.0.61

## 0.0.37

### Patch Changes

- @zhin.js/logger@0.1.60
- @zhin.js/schema@1.0.60

## 0.0.36

### Patch Changes

- @zhin.js/logger@0.1.59
- @zhin.js/schema@1.0.59

## 0.0.35

### Patch Changes

- @zhin.js/logger@0.1.58
- @zhin.js/schema@1.0.58

## 0.0.34

### Patch Changes

- @zhin.js/logger@0.1.57
- @zhin.js/schema@1.0.57

## 0.0.33

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
  - @zhin.js/logger@0.1.56
  - @zhin.js/schema@1.0.56

## 0.0.32

### Patch Changes

- @zhin.js/logger@0.1.55
- @zhin.js/schema@1.0.55

## 0.0.31

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - @zhin.js/schema@1.0.54

## 0.0.30

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53

## 0.0.29

### Patch Changes

- @zhin.js/logger@0.1.52
- @zhin.js/schema@1.0.52

## 0.0.28

### Patch Changes

- @zhin.js/logger@0.1.51
- @zhin.js/schema@1.0.51

## 0.0.27

### Patch Changes

- @zhin.js/logger@0.1.50
- @zhin.js/schema@1.0.50

## 0.0.26

### Patch Changes

- @zhin.js/logger@0.1.49
- @zhin.js/schema@1.0.49

## 0.0.25

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48

## 0.0.24

### Patch Changes

- @zhin.js/logger@0.1.47
- @zhin.js/schema@1.0.47

## 0.0.23

### Patch Changes

- @zhin.js/logger@0.1.46
- @zhin.js/schema@1.0.46

## 0.0.22

### Patch Changes

- @zhin.js/logger@0.1.45
- @zhin.js/schema@1.0.45

## 0.0.21

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44

## 0.0.20

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43

## 0.0.19

### Patch Changes

- @zhin.js/logger@0.1.42
- @zhin.js/schema@1.0.42

## 0.0.18

### Patch Changes

- @zhin.js/logger@0.1.41
- @zhin.js/schema@1.0.41

## 0.0.17

### Patch Changes

- @zhin.js/logger@0.1.40
- @zhin.js/schema@1.0.40

## 0.0.16

### Patch Changes

- @zhin.js/logger@0.1.39
- @zhin.js/schema@1.0.39

## 0.0.15

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38

## 0.0.14

### Patch Changes

- @zhin.js/logger@0.1.37
- @zhin.js/schema@1.0.37

## 0.0.13

### Patch Changes

- @zhin.js/logger@0.1.36
- @zhin.js/schema@1.0.36

## 0.0.12

### Patch Changes

- @zhin.js/logger@0.1.35
- @zhin.js/schema@1.0.35

## 0.0.11

### Patch Changes

- @zhin.js/logger@0.1.34
- @zhin.js/schema@1.0.34

## 0.0.10

### Patch Changes

- b00b6c9: fix: 代码逃逸拦截增强
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33

## 0.0.9

### Patch Changes

- 7d09e5e: fix: 代码安全漏洞修复
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32

## 0.0.8

### Patch Changes

- @zhin.js/logger@0.1.31
- @zhin.js/schema@1.0.31

## 0.0.7

### Patch Changes

- @zhin.js/logger@0.1.30
- @zhin.js/schema@1.0.30

## 0.0.6

### Patch Changes

- @zhin.js/logger@0.1.29
- @zhin.js/schema@1.0.29

## 0.0.5

### Patch Changes

- @zhin.js/logger@0.1.28
- @zhin.js/schema@1.0.28

## 0.0.4

### Patch Changes

- @zhin.js/logger@0.1.27
- @zhin.js/schema@1.0.27

## 0.0.3

### Patch Changes

- @zhin.js/logger@0.1.26
- @zhin.js/schema@1.0.26

## 0.0.2

### Patch Changes

- @zhin.js/logger@0.1.25
- @zhin.js/schema@1.0.25

## 0.0.1

### Patch Changes

- @zhin.js/logger@0.1.24
- @zhin.js/schema@1.0.24
