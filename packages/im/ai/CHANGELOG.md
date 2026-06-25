# @zhin.js/ai

## 1.4.2

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72

## 1.4.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身

## 1.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

## 1.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71

## 1.2.0

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

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.

## 1.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 1.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化

## 1.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70

## 1.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69

## 1.1.26

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68

## 1.1.25

### Patch Changes

- @zhin.js/logger@0.1.67

## 1.1.24

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [f19d2e0]
  - @zhin.js/logger@0.1.66

## 1.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/logger@0.1.65

## 1.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64

## 1.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
  - @zhin.js/logger@0.1.63

## 1.1.20

### Patch Changes

- @zhin.js/logger@0.1.62

## 1.1.19

### Patch Changes

- @zhin.js/logger@0.1.61

## 1.1.18

### Patch Changes

- @zhin.js/logger@0.1.60

## 1.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
  - @zhin.js/logger@0.1.59

## 1.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
  - @zhin.js/logger@0.1.58

## 1.1.15

### Patch Changes

- efad4ef: fix: 幻觉优化
  - @zhin.js/logger@0.1.57

## 1.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
  - @zhin.js/logger@0.1.56

## 1.1.13

### Patch Changes

- @zhin.js/logger@0.1.55

## 1.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54

## 1.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53

## 1.1.10

### Patch Changes

- @zhin.js/logger@0.1.52

## 1.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
  - @zhin.js/logger@0.1.51

## 1.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
  - @zhin.js/logger@0.1.50

## 1.1.7

### Patch Changes

- d73a3b7: fix: ai error
  - @zhin.js/logger@0.1.49

## 1.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48

## 1.1.5

### Patch Changes

- @zhin.js/logger@0.1.47

## 1.1.4

### Patch Changes

- @zhin.js/logger@0.1.46

## 1.1.3

### Patch Changes

- @zhin.js/logger@0.1.45

## 1.1.2

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

## 1.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43

## 1.1.0

### Minor Changes

- 8280fe7: feat: ModelRegistry 模型自动发现与智能选择

  - 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
  - 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
  - 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
  - providers.models 配置现为可选 — 框架自动发现并按评分排序
  - 新增 chatModel / visionModel 配置项，留空自动选择最优模型
  - 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
  - Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎

### Patch Changes

- @zhin.js/logger@0.1.42

## 1.0.18

### Patch Changes

- @zhin.js/logger@0.1.41

## 1.0.17

### Patch Changes

- 20ab379: fix: ai 优化
  - @zhin.js/logger@0.1.40

## 1.0.16

### Patch Changes

- @zhin.js/logger@0.1.39

## 1.0.15

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38

## 1.0.14

### Patch Changes

- @zhin.js/logger@0.1.37

## 1.0.13

### Patch Changes

- @zhin.js/logger@0.1.36

## 1.0.12

### Patch Changes

- @zhin.js/logger@0.1.35

## 1.0.11

### Patch Changes

- @zhin.js/logger@0.1.34

## 1.0.10

### Patch Changes

- @zhin.js/logger@0.1.33

## 1.0.9

### Patch Changes

- @zhin.js/logger@0.1.32

## 1.0.8

### Patch Changes

- @zhin.js/logger@0.1.31

## 1.0.7

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
  - @zhin.js/logger@0.1.30

## 1.0.6

### Patch Changes

- 63b83ef: fix: 自定义 schema
  - @zhin.js/logger@0.1.29

## 1.0.5

### Patch Changes

- @zhin.js/logger@0.1.28

## 1.0.4

### Patch Changes

- @zhin.js/logger@0.1.27

## 1.0.3

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
  - @zhin.js/logger@0.1.26

## 1.0.2

### Patch Changes

- @zhin.js/logger@0.1.25

## 1.0.1

### Patch Changes

- @zhin.js/logger@0.1.24
