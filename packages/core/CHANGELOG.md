# @zhin.js/core

## 1.1.8

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/database@1.0.53
  - @zhin.js/logger@0.1.50
  - @zhin.js/schema@1.0.50
  - @zhin.js/kernel@0.0.27

## 1.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/database@1.0.52
  - @zhin.js/logger@0.1.49
  - @zhin.js/schema@1.0.49
  - @zhin.js/kernel@0.0.26

## 1.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/database@1.0.51
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48
  - @zhin.js/ai@1.1.6
  - @zhin.js/kernel@0.0.25

## 1.1.5

### Patch Changes

- @zhin.js/database@1.0.50
- @zhin.js/logger@0.1.47
- @zhin.js/schema@1.0.47
- @zhin.js/ai@1.1.5
- @zhin.js/kernel@0.0.24

## 1.1.4

### Patch Changes

- @zhin.js/database@1.0.49
- @zhin.js/logger@0.1.46
- @zhin.js/schema@1.0.46
- @zhin.js/ai@1.1.4
- @zhin.js/kernel@0.0.23

## 1.1.3

### Patch Changes

- @zhin.js/database@1.0.48
- @zhin.js/logger@0.1.45
- @zhin.js/schema@1.0.45
- @zhin.js/ai@1.1.3
- @zhin.js/kernel@0.0.22

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
  - @zhin.js/kernel@0.0.21
  - @zhin.js/database@1.0.47
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44
  - @zhin.js/ai@1.1.2

## 1.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/database@1.0.46
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43
  - @zhin.js/ai@1.1.1
  - @zhin.js/kernel@0.0.20

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

- Updated dependencies [8280fe7]
  - @zhin.js/ai@1.1.0
  - @zhin.js/database@1.0.45
  - @zhin.js/logger@0.1.42
  - @zhin.js/schema@1.0.42
  - @zhin.js/kernel@0.0.19

## 1.0.57

### Patch Changes

- c606a57: fix: ask_user 优化
  - @zhin.js/database@1.0.44
  - @zhin.js/logger@0.1.41
  - @zhin.js/schema@1.0.41
  - @zhin.js/ai@1.0.18
  - @zhin.js/kernel@0.0.18

## 1.0.56

### Patch Changes

- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/database@1.0.43
  - @zhin.js/logger@0.1.40
  - @zhin.js/schema@1.0.40
  - @zhin.js/kernel@0.0.17

## 1.0.55

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
  - @zhin.js/database@1.0.42
  - @zhin.js/logger@0.1.39
  - @zhin.js/schema@1.0.39
  - @zhin.js/ai@1.0.16
  - @zhin.js/kernel@0.0.16

## 1.0.54

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/database@1.0.41
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38
  - @zhin.js/ai@1.0.15
  - @zhin.js/kernel@0.0.15

## 1.0.53

### Patch Changes

- Updated dependencies [daee7f6]
  - @zhin.js/database@1.0.40
  - @zhin.js/logger@0.1.37
  - @zhin.js/schema@1.0.37
  - @zhin.js/ai@1.0.14
  - @zhin.js/kernel@0.0.14

## 1.0.52

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- bb6bfa8: feat: 技能全面文件化——仓库内插件/适配器使用 `skills/<name>/SKILL.md`；Core 已移除 `plugin.declareSkill` / `Adapter.declareSkill` API
  - @zhin.js/database@1.0.39
  - @zhin.js/logger@0.1.36
  - @zhin.js/schema@1.0.36
  - @zhin.js/ai@1.0.13
  - @zhin.js/kernel@0.0.13

## 1.0.51

### Patch Changes

- @zhin.js/database@1.0.38
- @zhin.js/logger@0.1.35
- @zhin.js/schema@1.0.35
- @zhin.js/ai@1.0.12
- @zhin.js/kernel@0.0.12

## 1.0.50

### Patch Changes

- @zhin.js/database@1.0.37
- @zhin.js/logger@0.1.34
- @zhin.js/schema@1.0.34
- @zhin.js/ai@1.0.11
- @zhin.js/kernel@0.0.11

## 1.0.49

### Patch Changes

- b00b6c9: fix: 代码逃逸拦截增强
- Updated dependencies [b00b6c9]
  - @zhin.js/kernel@0.0.10
  - @zhin.js/database@1.0.36
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33
  - @zhin.js/ai@1.0.10

## 1.0.48

### Patch Changes

- 7d09e5e: fix: 代码安全漏洞修复
- Updated dependencies [7d09e5e]
  - @zhin.js/kernel@0.0.9
  - @zhin.js/database@1.0.35
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32
  - @zhin.js/ai@1.0.9

## 1.0.47

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
  - @zhin.js/database@1.0.34
  - @zhin.js/logger@0.1.31
  - @zhin.js/schema@1.0.31
  - @zhin.js/ai@1.0.8
  - @zhin.js/kernel@0.0.8

## 1.0.46

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/database@1.0.33
  - @zhin.js/logger@0.1.30
  - @zhin.js/schema@1.0.30
  - @zhin.js/kernel@0.0.7

## 1.0.45

### Patch Changes

- 63b83ef: fix: 自定义 schema
- Updated dependencies [63b83ef]
  - @zhin.js/ai@1.0.6
  - @zhin.js/database@1.0.32
  - @zhin.js/logger@0.1.29
  - @zhin.js/schema@1.0.29
  - @zhin.js/kernel@0.0.6

## 1.0.44

### Patch Changes

- @zhin.js/database@1.0.31
- @zhin.js/logger@0.1.28
- @zhin.js/schema@1.0.28
- @zhin.js/ai@1.0.5
- @zhin.js/kernel@0.0.5

## 1.0.43

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
  - @zhin.js/database@1.0.30
  - @zhin.js/logger@0.1.27
  - @zhin.js/schema@1.0.27
  - @zhin.js/ai@1.0.4
  - @zhin.js/kernel@0.0.4

## 1.0.42

### Patch Changes

- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/database@1.0.29
  - @zhin.js/logger@0.1.26
  - @zhin.js/schema@1.0.26
  - @zhin.js/kernel@0.0.3

## 1.0.41

### Patch Changes

- 5a68249: fix: 文档优化
  - @zhin.js/database@1.0.28
  - @zhin.js/logger@0.1.25
  - @zhin.js/schema@1.0.25
  - @zhin.js/ai@1.0.2
  - @zhin.js/kernel@0.0.2

## 1.0.40

### Patch Changes

- 7ef9057: fix: 架构调整优化
  - @zhin.js/database@1.0.27
  - @zhin.js/logger@0.1.24
  - @zhin.js/schema@1.0.24
  - @zhin.js/ai@1.0.1
  - @zhin.js/kernel@0.0.1

## 1.0.39

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - @zhin.js/database@1.0.26
  - @zhin.js/logger@0.1.23
  - @zhin.js/schema@1.0.23

## 1.0.38

### Patch Changes

- ab5c54a: fix: ai 架构优化
  - @zhin.js/database@1.0.25
  - @zhin.js/logger@0.1.22
  - @zhin.js/schema@1.0.22

## 1.0.37

### Patch Changes

- a8ce720: fix: ai 优化,github 优化
  - @zhin.js/database@1.0.24
  - @zhin.js/logger@0.1.21
  - @zhin.js/schema@1.0.21

## 1.0.36

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth
  - @zhin.js/database@1.0.23
  - @zhin.js/logger@0.1.20
  - @zhin.js/schema@1.0.20

## 1.0.35

### Patch Changes

- 8502351: fix: token 优化
  - @zhin.js/database@1.0.22
  - @zhin.js/logger@0.1.19
  - @zhin.js/schema@1.0.19

## 1.0.34

### Patch Changes

- 634e2d7: fix: ai 强化
  - @zhin.js/database@1.0.21
  - @zhin.js/logger@0.1.18
  - @zhin.js/schema@1.0.18

## 1.0.33

### Patch Changes

- 4abae79: fix: msg compile
  - @zhin.js/database@1.0.20
  - @zhin.js/logger@0.1.17
  - @zhin.js/schema@1.0.17

## 1.0.32

### Patch Changes

- 10d8bdc: fix: win 下 dev 错误
  - @zhin.js/database@1.0.19
  - @zhin.js/logger@0.1.16
  - @zhin.js/schema@1.0.16

## 1.0.31

### Patch Changes

- 771706d: fix: 技能优化
  - @zhin.js/database@1.0.18
  - @zhin.js/logger@0.1.15
  - @zhin.js/schema@1.0.15

## 1.0.30

### Patch Changes

- @zhin.js/database@1.0.17
- @zhin.js/logger@0.1.14
- @zhin.js/schema@1.0.14

## 1.0.29

### Patch Changes

- 4ec9176: fix: ai
  - @zhin.js/database@1.0.16
  - @zhin.js/logger@0.1.13
  - @zhin.js/schema@1.0.13

## 1.0.28

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
  - @zhin.js/database@1.0.15
  - @zhin.js/logger@0.1.12
  - @zhin.js/schema@1.0.12

## 1.0.27

### Patch Changes

- b27e633: fix: cli 优化
  - @zhin.js/database@1.0.14
  - @zhin.js/logger@0.1.11
  - @zhin.js/schema@1.0.11

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/database@1.0.13
  - @zhin.js/logger@0.1.10
  - @zhin.js/schema@1.0.10

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/database@1.0.12
  - @zhin.js/logger@0.1.9
  - @zhin.js/schema@1.0.9

## 1.0.24

### Patch Changes

- 6108e5d: fix: component
  - @zhin.js/database@1.0.11
  - @zhin.js/logger@0.1.8
  - @zhin.js/schema@1.0.8

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
  - @zhin.js/database@1.0.10
  - @zhin.js/logger@0.1.7
  - @zhin.js/schema@1.0.7

## 1.0.22

### Patch Changes

- @zhin.js/database@1.0.9
- @zhin.js/logger@0.1.6
- @zhin.js/schema@1.0.6

## 1.0.21

### Patch Changes

- 3960e70: fix: runtime err
  - @zhin.js/database@1.0.8
  - @zhin.js/logger@0.1.5
  - @zhin.js/schema@1.0.5

## 1.0.20

### Patch Changes

- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
  - @zhin.js/dependency@1.0.5
  - @zhin.js/database@1.0.7
  - @zhin.js/logger@0.1.4
  - @zhin.js/schema@1.0.4

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/database@1.0.6
  - @zhin.js/dependency@1.0.4
  - @zhin.js/logger@0.1.3
  - @zhin.js/schema@1.0.3

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/database@1.0.5
  - @zhin.js/dependency@1.0.3
  - @zhin.js/logger@0.1.2
  - @zhin.js/schema@1.0.2

## 1.0.17

### Patch Changes

- 3bc5d56: fix: 内存优化
- Updated dependencies [3bc5d56]
  - @zhin.js/hmr@1.0.8

## 1.0.16

### Patch Changes

- e733fab: fix: 异步组件优化

## 1.0.15

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- e783f90: fix:保护 bun
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy

## 1.0.14

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/database@1.0.4
  - @zhin.js/hmr@1.0.7

## 1.0.13

### Patch Changes

- a2e1ebc: fix: 优化监听
- Updated dependencies [a2e1ebc]
  - @zhin.js/hmr@1.0.6

## 1.0.12

### Patch Changes

- ff5a7ed: fix: 文件监听
- Updated dependencies [ff5a7ed]
  - @zhin.js/hmr@1.0.5

## 1.0.11

### Patch Changes

- Updated dependencies [ae680db]
  - @zhin.js/hmr@1.0.4

## 1.0.10

### Patch Changes

- c8c3996: fix: 修复 segment-matcher
- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1
  - @zhin.js/hmr@1.0.3

## 1.0.9

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/database@1.0.3
  - @zhin.js/hmr@1.0.2

## 1.0.7

### Patch Changes

- 47845fb: fix: err
- Updated dependencies [47845fb]
  - @zhin.js/database@1.0.2

## 1.0.6

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑

## 1.0.5

### Patch Changes

- f347667: fix: runtime error

## 1.0.4

### Patch Changes

- 15be776: fix: 修改 cli 错误,增加 permit

## 1.0.3

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [727963c]
  - @zhin.js/database@1.0.1
  - @zhin.js/hmr@1.0.1

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- 3ecd487: fix: 函数式组件,更新文档

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/hmr@1.0.1
