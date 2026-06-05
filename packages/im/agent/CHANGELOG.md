# @zhin.js/agent

## 0.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30

## Unreleased

### Minor Changes

- **Assistant Runtime（路线 A）**：M1–M5 统一 JobStore、Event Ingress、NotificationRouter、Home Domain、Assistant Profile
  - `assistant.enabled` opt-in；`assistant-jobs.json` SSOT
  - `POST /api/assistant/events`、`GET /api/assistant/jobs`
  - `home_*` 工具、`assistant.profile.yml` Bootstrap 合并
  - `notify.channel` 多通道；`cron_add notify_channel` 参数
  - Profile `morningBrief` / `bedtimeCheck` cron routines → JobStore
  - `assistant.queue` TaskQueue（重试 / 并发 / 死信）
  - `syncSchedulerJobsFromLegacy`；assistant.enabled 时关闭 legacy Scheduler
  - `assistant.home.mcpServer` 与 `ai.mcpServers` 校验；Profile 设备别名合并
  - `CronJobContext` / `context` 已移除（破坏性）；`cron-jobs.json` / `assistant-jobs.json` 必须含 `notify`
  - `zhin cron add --notify-channel`；Console RPC `cron:add` 使用 `notify` / `notifyChannel`（默认 silent）
  - `legacyDualWrite` 默认 false

## 0.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- c8f8207: fix: 增加重启恢复会话功能
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
  - @zhin.js/logger@0.1.70
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31

## 0.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/core@1.1.29
  - @zhin.js/ai@1.1.27

## 0.1.26

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/ai@1.1.26

## 0.1.25

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化
  - @zhin.js/logger@0.1.67
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25

## 0.1.24

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24

## 0.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/ai@1.1.23

## 0.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24

## 0.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21

## 0.1.20

### Patch Changes

- 3b3e49b: fix: ask 工具修复,icqq skill 优化
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20

## 0.1.19

### Patch Changes

- 92da96d: fix skill 激活优化
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19

## 0.1.18

### Patch Changes

- 88caeb2: fix: ask user 护栏
- Updated dependencies [88caeb2]
  - @zhin.js/core@1.1.20
  - @zhin.js/ai@1.1.18

## 0.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
- Updated dependencies [fcad030]
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19

## 0.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/ai@1.1.16
  - @zhin.js/core@1.1.18

## Unreleased

### Changed

- 子代理默认继续使用最小工具继承（不自动继承主会话 skill/tool）；可通过 `ai.agent.subagentTools` 显式追加子代理可用工具白名单。

## 0.1.15

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/core@1.1.17

## 0.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14

## 0.1.13

### Patch Changes

- 63d0b88: fix: 定时任务优化
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13

## 0.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14

## 0.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13

## 0.1.10

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/ai@1.1.10

## 0.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
- Updated dependencies [0eba6d6]
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9

## 0.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/core@1.1.7

## 0.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6

## 0.1.5

### Patch Changes

- ba30934: fix: web 优化
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5

## 0.1.4

### Patch Changes

- bf0dc75: fix: 幻觉优化
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4

## 0.1.3

### Patch Changes

- a257f3f: fix: 定时任务提示词优化
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3

## 0.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/core@1.1.2
  - @zhin.js/ai@1.1.2

## 0.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1

## 0.1.0

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
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0

## 0.0.20

### Patch Changes

- c606a57: fix: ask_user 优化
- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - @zhin.js/ai@1.0.18

## 0.0.19

### Patch Changes

- 20ab379: fix: ai 优化
- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56

## 0.0.18

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - @zhin.js/ai@1.0.16

## 0.0.17

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54

## 0.0.16

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/ai@1.0.14

## 0.0.15

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/ai@1.0.13

## 0.0.14

### Patch Changes

- 607acc4: fix: 视觉模型处理
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12

## 0.0.13

### Patch Changes

- 2510365: fix: 文件安全拦截
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11

## 0.0.12

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - @zhin.js/ai@1.0.10

## 0.0.11

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - @zhin.js/ai@1.0.9

## 0.0.10

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - @zhin.js/ai@1.0.8

## 0.0.9

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46

## 0.0.8

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6

## 0.0.7

### Patch Changes

- 4f2fb55: fix: agent bug
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/ai@1.0.4

## 0.0.5

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42

## 0.0.4

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/ai@1.0.2

## 0.0.3

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - @zhin.js/ai@1.0.1

## 0.0.2

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39

## 0.0.1

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
