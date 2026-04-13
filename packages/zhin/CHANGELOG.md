# zhin.js

## 1.0.66

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/agent@0.1.8
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8
  - @zhin.js/logger@0.1.50
  - @zhin.js/schema@1.0.50
  - @zhin.js/kernel@0.0.27

## 1.0.65

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/agent@0.1.7
  - @zhin.js/core@1.1.7
  - @zhin.js/logger@0.1.49
  - @zhin.js/schema@1.0.49
  - @zhin.js/kernel@0.0.26

## 1.0.64

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48
  - @zhin.js/agent@0.1.6
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6
  - @zhin.js/kernel@0.0.25

## 1.0.63

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/agent@0.1.5
  - @zhin.js/logger@0.1.47
  - @zhin.js/schema@1.0.47
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5
  - @zhin.js/kernel@0.0.24

## 1.0.62

### Patch Changes

- Updated dependencies [bf0dc75]
  - @zhin.js/agent@0.1.4
  - @zhin.js/logger@0.1.46
  - @zhin.js/schema@1.0.46
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4
  - @zhin.js/kernel@0.0.23

## 1.0.61

### Patch Changes

- Updated dependencies [a257f3f]
  - @zhin.js/agent@0.1.3
  - @zhin.js/logger@0.1.45
  - @zhin.js/schema@1.0.45
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3
  - @zhin.js/kernel@0.0.22

## 1.0.60

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
  - @zhin.js/agent@0.1.2
  - @zhin.js/core@1.1.2
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44
  - @zhin.js/ai@1.1.2

## 1.0.59

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43
  - @zhin.js/agent@0.1.1
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1
  - @zhin.js/kernel@0.0.20

## 1.0.58

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/agent@0.1.0
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0
  - @zhin.js/logger@0.1.42
  - @zhin.js/schema@1.0.42
  - @zhin.js/kernel@0.0.19

## 1.0.57

### Patch Changes

- Updated dependencies [c606a57]
  - @zhin.js/agent@0.0.20
  - @zhin.js/core@1.0.57
  - @zhin.js/logger@0.1.41
  - @zhin.js/schema@1.0.41
  - @zhin.js/ai@1.0.18
  - @zhin.js/kernel@0.0.18

## 1.0.56

### Patch Changes

- Updated dependencies [20ab379]
  - @zhin.js/agent@0.0.19
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56
  - @zhin.js/logger@0.1.40
  - @zhin.js/schema@1.0.40
  - @zhin.js/kernel@0.0.17

## 1.0.55

### Patch Changes

- Updated dependencies [75709e1]
  - @zhin.js/agent@0.0.18
  - @zhin.js/core@1.0.55
  - @zhin.js/logger@0.1.39
  - @zhin.js/schema@1.0.39
  - @zhin.js/ai@1.0.16
  - @zhin.js/kernel@0.0.16

## 1.0.54

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38
  - @zhin.js/agent@0.0.17
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54
  - @zhin.js/kernel@0.0.15

## 1.0.53

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/agent@0.0.16
- @zhin.js/logger@0.1.37
- @zhin.js/schema@1.0.37
- @zhin.js/ai@1.0.14
- @zhin.js/kernel@0.0.14

## 1.0.52

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- bb6bfa8: feat: 技能全面文件化——仓库内插件/适配器使用 `skills/<name>/SKILL.md`；Core 已移除 `plugin.declareSkill` / `Adapter.declareSkill` API
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/agent@0.0.15
  - @zhin.js/logger@0.1.36
  - @zhin.js/schema@1.0.36
  - @zhin.js/ai@1.0.13
  - @zhin.js/kernel@0.0.13

## 1.0.51

### Patch Changes

- Updated dependencies [607acc4]
  - @zhin.js/agent@0.0.14
  - @zhin.js/logger@0.1.35
  - @zhin.js/schema@1.0.35
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12
  - @zhin.js/kernel@0.0.12

## 1.0.50

### Patch Changes

- Updated dependencies [2510365]
  - @zhin.js/agent@0.0.13
  - @zhin.js/logger@0.1.34
  - @zhin.js/schema@1.0.34
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11
  - @zhin.js/kernel@0.0.11

## 1.0.49

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/kernel@0.0.10
  - @zhin.js/core@1.0.49
  - @zhin.js/agent@0.0.12
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33
  - @zhin.js/ai@1.0.10

## 1.0.48

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/kernel@0.0.9
  - @zhin.js/core@1.0.48
  - @zhin.js/agent@0.0.11
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32
  - @zhin.js/ai@1.0.9

## 1.0.47

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/agent@0.0.10
  - @zhin.js/core@1.0.47
  - @zhin.js/logger@0.1.31
  - @zhin.js/schema@1.0.31
  - @zhin.js/ai@1.0.8
  - @zhin.js/kernel@0.0.8

## 1.0.46

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/agent@0.0.9
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46
  - @zhin.js/logger@0.1.30
  - @zhin.js/schema@1.0.30
  - @zhin.js/kernel@0.0.7

## 1.0.45

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6
  - @zhin.js/agent@0.0.8
  - @zhin.js/logger@0.1.29
  - @zhin.js/schema@1.0.29
  - @zhin.js/kernel@0.0.6

## 1.0.44

### Patch Changes

- Updated dependencies [4f2fb55]
  - @zhin.js/agent@0.0.7
  - @zhin.js/logger@0.1.28
  - @zhin.js/schema@1.0.28
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5
  - @zhin.js/kernel@0.0.5

## 1.0.43

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/agent@0.0.6
  - @zhin.js/logger@0.1.27
  - @zhin.js/schema@1.0.27
  - @zhin.js/ai@1.0.4
  - @zhin.js/kernel@0.0.4

## 1.0.42

### Patch Changes

- Updated dependencies [0999ca6]
  - @zhin.js/agent@0.0.5
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42
  - @zhin.js/logger@0.1.26
  - @zhin.js/schema@1.0.26
  - @zhin.js/kernel@0.0.3

## 1.0.41

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/agent@0.0.4
  - @zhin.js/logger@0.1.25
  - @zhin.js/schema@1.0.25
  - @zhin.js/ai@1.0.2
  - @zhin.js/kernel@0.0.2

## 1.0.40

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/agent@0.0.3
  - @zhin.js/core@1.0.40
  - @zhin.js/logger@0.1.24
  - @zhin.js/schema@1.0.24
  - @zhin.js/ai@1.0.1
  - @zhin.js/kernel@0.0.1

## 1.0.39

### Patch Changes

- Updated dependencies [04f76ac]
  - @zhin.js/agent@0.0.2
  - @zhin.js/core@1.0.39
  - @zhin.js/logger@0.1.23
  - @zhin.js/schema@1.0.23

## 1.0.38

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
  - @zhin.js/agent@0.0.1
  - @zhin.js/logger@0.1.22
  - @zhin.js/schema@1.0.22

## 1.0.37

### Patch Changes

- Updated dependencies [a8ce720]
  - @zhin.js/core@1.0.37
  - @zhin.js/logger@0.1.21
  - @zhin.js/schema@1.0.21

## 1.0.36

### Patch Changes

- Updated dependencies [6d94111]
  - @zhin.js/core@1.0.36
  - @zhin.js/logger@0.1.20
  - @zhin.js/schema@1.0.20

## 1.0.35

### Patch Changes

- Updated dependencies [8502351]
  - @zhin.js/core@1.0.35
  - @zhin.js/logger@0.1.19
  - @zhin.js/schema@1.0.19

## 1.0.34

### Patch Changes

- Updated dependencies [634e2d7]
  - @zhin.js/core@1.0.34
  - @zhin.js/logger@0.1.18
  - @zhin.js/schema@1.0.18

## 1.0.33

### Patch Changes

- Updated dependencies [4abae79]
  - @zhin.js/core@1.0.33
  - @zhin.js/logger@0.1.17
  - @zhin.js/schema@1.0.17

## 1.0.32

### Patch Changes

- Updated dependencies [10d8bdc]
  - @zhin.js/core@1.0.32
  - @zhin.js/logger@0.1.16
  - @zhin.js/schema@1.0.16

## 1.0.31

### Patch Changes

- Updated dependencies [771706d]
  - @zhin.js/core@1.0.31
  - @zhin.js/logger@0.1.15
  - @zhin.js/schema@1.0.15

## 1.0.30

### Patch Changes

- 460a6c6: fix: unhandleRejection
  - @zhin.js/logger@0.1.14
  - @zhin.js/schema@1.0.14
  - @zhin.js/core@1.0.30

## 1.0.29

### Patch Changes

- Updated dependencies [4ec9176]
  - @zhin.js/core@1.0.29
  - @zhin.js/logger@0.1.13
  - @zhin.js/schema@1.0.13

## 1.0.28

### Patch Changes

- Updated dependencies [05a514d]
  - @zhin.js/core@1.0.28
  - @zhin.js/logger@0.1.12
  - @zhin.js/schema@1.0.12

## 1.0.27

### Patch Changes

- b27e633: fix: cli 优化
- Updated dependencies [b27e633]
  - @zhin.js/core@1.0.27
  - @zhin.js/logger@0.1.11
  - @zhin.js/schema@1.0.11

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/core@1.0.26
  - @zhin.js/logger@0.1.10
  - @zhin.js/schema@1.0.10

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/ai@0.0.2
  - @zhin.js/logger@0.1.9
  - @zhin.js/schema@1.0.9
  - @zhin.js/core@1.0.25

## 1.0.24

### Patch Changes

- Updated dependencies [6108e5d]
  - @zhin.js/core@1.0.24
  - @zhin.js/logger@0.1.8
  - @zhin.js/schema@1.0.8

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - @zhin.js/core@1.0.23
  - @zhin.js/logger@0.1.7
  - @zhin.js/schema@1.0.7

## 1.0.22

### Patch Changes

- 26aba27: fix: error default config
  - @zhin.js/logger@0.1.6
  - @zhin.js/schema@1.0.6
  - @zhin.js/core@1.0.22

## 1.0.21

### Patch Changes

- Updated dependencies [3960e70]
  - @zhin.js/core@1.0.21
  - @zhin.js/logger@0.1.5
  - @zhin.js/schema@1.0.5

## 1.0.20

### Patch Changes

- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - @zhin.js/schema@1.0.4
  - @zhin.js/core@1.0.20

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - @zhin.js/schema@1.0.3
  - @zhin.js/core@1.0.19

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - @zhin.js/schema@1.0.2
  - @zhin.js/core@1.0.18

## 1.0.17

### Patch Changes

- Updated dependencies [3bc5d56]
  - @zhin.js/core@1.0.17

## 1.0.16

### Patch Changes

- Updated dependencies [e733fab]
  - @zhin.js/core@1.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [f9e75ce]
- Updated dependencies [e783f90]
- Updated dependencies [f9e75ce]
  - @zhin.js/core@1.0.15

## 1.0.14

### Patch Changes

- Updated dependencies [547028f]
  - @zhin.js/core@1.0.14

## 1.0.13

### Patch Changes

- Updated dependencies [a2e1ebc]
  - @zhin.js/core@1.0.13

## 1.0.12

### Patch Changes

- Updated dependencies [ff5a7ed]
  - @zhin.js/core@1.0.12

## 1.0.11

### Patch Changes

- @zhin.js/core@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1
  - @zhin.js/core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [c490260]
  - @zhin.js/core@1.0.9

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [47845fb]
  - @zhin.js/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [c2d9047]
- Updated dependencies [c2d9047]
  - @zhin.js/core@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [15be776]
  - @zhin.js/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [89bc676]
  - @zhin.js/core@1.0.3

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- Updated dependencies [15fc934]
- Updated dependencies [3ecd487]
  - @zhin.js/core@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/core@1.0.1
