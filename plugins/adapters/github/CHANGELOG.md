# @zhin.js/adapter-github

## 3.0.1

### Patch Changes

- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [7700903]
  - zhin.js@4.1.1
  - @zhin.js/host-router@2.0.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

- ae5239c: fix: 核心包瘦身
- Updated dependencies [ae5239c]
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 2.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/host-router@2.0.0

## 1.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
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
  - @zhin.js/host-router@1.0.0

## 0.1.63

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 0.1.62

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 0.1.61

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 0.1.60

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89

## 0.1.59

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.1.58

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/host-router@0.0.1

## 0.1.57

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86
  - @zhin.js/host-router@1.0.79

## 0.1.56

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/host-router@1.0.78

## 0.1.55

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/host-router@1.0.77

## 0.1.54

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/host-router@1.0.76
  - zhin.js@1.0.83

## 0.1.53

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/host-router@1.0.75
  - zhin.js@1.0.82

## 0.1.52

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/host-router@1.0.74

## 0.1.51

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/host-router@1.0.73

## 0.1.50

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/host-router@1.0.72

## 0.1.49

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/host-router@1.0.71

## 0.1.48

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/host-router@1.0.70

## 0.1.47

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/host-router@1.0.69

## 0.1.46

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/host-router@1.0.68

## 0.1.45

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/host-router@1.0.67

## 0.1.44

### Patch Changes

- zhin.js@1.0.73
- @zhin.js/host-router@1.0.66

## 0.1.43

### Patch Changes

- 57bdf7a: fix: github adapter error

## 0.1.42

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/host-router@1.0.65

## 0.1.41

### Patch Changes

- 4304825: fix: 重新发版
- ed66fb1: fix: 适配器优化
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/host-router@1.0.64

## 0.1.40

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/host-router@1.0.63

## 0.1.39

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67

## 0.1.38

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/host-router@1.0.61

## 0.1.37

### Patch Changes

- d73a3b7: fix: ai error
  - zhin.js@1.0.65
  - @zhin.js/host-router@1.0.60

## 0.1.36

### Patch Changes

- 36c1b8f: fix: 重构 icqq\github 适配器

## 0.1.35

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/host-router@1.0.59

## 0.1.34

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63

## 0.1.33

### Patch Changes

- 6b146fd: fix: 补齐工具

## 0.1.32

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/host-router@1.0.57

## 0.1.31

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/host-router@1.0.56

## 0.1.30

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
  - @zhin.js/host-router@1.0.55

## 0.1.29

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 0.1.28

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/host-router@1.0.53

## 0.1.27

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/host-router@1.0.52

## 0.1.26

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/host-router@1.0.51

## 0.1.25

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/host-router@1.0.50

## 0.1.24

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 0.1.23

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 0.1.22

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 0.1.21

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/host-router@1.0.46

## 0.1.20

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45

## 0.1.19

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/host-router@1.0.44

## 0.1.18

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/host-router@1.0.43

## 0.1.17

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/host-router@1.0.42

## 0.1.16

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/host-router@1.0.41

## 0.1.15

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/host-router@1.0.40

## 0.1.14

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/host-router@1.0.39

## 0.1.13

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/host-router@1.0.38

## 0.1.12

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/host-router@1.0.37
  - zhin.js@1.0.43

## 0.1.11

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/host-router@1.0.36

## 0.1.10

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/host-router@1.0.35

## 0.1.9

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 0.1.8

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/host-router@1.0.33

## 0.1.7

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 0.1.6

### Patch Changes

- 631da6e: fix: 约定公开路由前缀/pub
- Updated dependencies [631da6e]
  - @zhin.js/host-router@1.0.31

## 0.1.5

### Patch Changes

- d7bdca3: fix: add public url

## 0.1.4

### Patch Changes

- e23e732: fix: 增强平台 AI 能力
- bb0be4c: fix: 平台能力增强

## 0.1.3

### Patch Changes

- a8ce720: fix: ai 优化,github 优化
  - zhin.js@1.0.37
  - @zhin.js/host-router@1.0.30

## 0.1.2

### Patch Changes

- d4a7daa: fix: github 优化

## 0.1.1

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - zhin.js@1.0.36
