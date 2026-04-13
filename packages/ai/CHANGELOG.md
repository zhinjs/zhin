# @zhin.js/ai

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
