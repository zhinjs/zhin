# @zhin.js/mcp

## 6.0.12

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - zhin.js@6.0.12
  - @zhin.js/tool@1.0.12

## 6.0.11

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11

## 6.0.10

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/tool@1.0.11

## 6.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - zhin.js@6.0.9

## 6.0.8

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [8e973dc]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/core@1.5.8
  - @zhin.js/tool@1.0.9
  - zhin.js@6.0.8

## 6.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - zhin.js@6.0.7

## 6.0.6

### Patch Changes

- @zhin.js/core@1.5.6
- zhin.js@6.0.6

## 6.0.5

### Patch Changes

- @zhin.js/core@1.5.5
- zhin.js@6.0.5

## 6.0.4

### Patch Changes

- d99fd12: remove(host/mcp): delete legacy MCP scaffolding tools

  Remove handlers.ts, tools.ts, prompts.ts, and resources.ts (1,358 lines)
  which contained outdated scaffolding code for plugin/command/component
  generation. These were not part of the core MCP server functionality and
  had no active consumers. mesh-auth.ts updated to remove orphaned imports.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 2916852: Make canonical invocation origin and principal display identity part of every
  Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
  carry structured origin data through ToolIndex instead of requiring tools to
  read a legacy IM Message side channel.
- Updated dependencies [b0f37ae]
- Updated dependencies [ba08a2f]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4
  - @zhin.js/tool@1.0.8

## 6.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/host-http-contract@1.0.1
  - @zhin.js/core@1.5.3
  - @zhin.js/tool@1.0.7
  - zhin.js@6.0.3

## 6.0.2

### Patch Changes

- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - zhin.js@6.0.2
  - @zhin.js/tool@1.0.6

## 6.0.1

### Patch Changes

- @zhin.js/core@1.5.1
- @zhin.js/tool@1.0.5
- zhin.js@6.0.1

## 6.0.0

### Patch Changes

- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/core@1.5.0
  - zhin.js@6.0.0

## 5.0.4

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

- Updated dependencies [d8bf702]
  - @zhin.js/host-http@1.0.4
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 5.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 5.0.2

### Patch Changes

- zhin.js@5.0.2
- @zhin.js/tool@1.0.4
- @zhin.js/core@1.4.2

## 5.0.1

### Patch Changes

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/host-http@1.0.3
  - @zhin.js/tool@1.0.3
  - zhin.js@5.0.1
  - @zhin.js/core@1.4.1

## 5.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/host-router@3.0.0
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0
  - @zhin.js/tool@1.0.2

## 4.0.3

### Patch Changes

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/host-router@2.0.4
  - @zhin.js/tool@1.0.1

## 4.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 4.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/core@1.3.3
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 4.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2
  - zhin.js@4.1.0

## 3.0.1

### Patch Changes

- Updated dependencies [609da24]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/core@1.3.1
  - zhin.js@4.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/core@1.3.0
  - zhin.js@3.0.0

## 2.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/core@1.2.1
  - zhin.js@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - zhin.js@2.0.0

## 1.0.74

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92

## 1.0.73

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91

## 1.0.72

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90

## 1.0.71

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89

## 1.0.70

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 1.0.69

### Patch Changes

- zhin.js@1.0.87

## 1.0.68

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 1.0.67

### Patch Changes

- zhin.js@1.0.85

## 1.0.66

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 1.0.65

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 1.0.64

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 1.0.63

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 1.0.62

### Patch Changes

- zhin.js@1.0.80

## 1.0.61

### Patch Changes

- zhin.js@1.0.79

## 1.0.60

### Patch Changes

- zhin.js@1.0.78

## 1.0.59

### Patch Changes

- zhin.js@1.0.77

## 1.0.58

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 1.0.57

### Patch Changes

- zhin.js@1.0.75

## 1.0.56

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 1.0.55

### Patch Changes

- zhin.js@1.0.73

## 1.0.54

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 1.0.53

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 1.0.52

### Patch Changes

- zhin.js@1.0.68

## 1.0.51

### Patch Changes

- zhin.js@1.0.67

## 1.0.50

### Patch Changes

- zhin.js@1.0.66

## 1.0.49

### Patch Changes

- zhin.js@1.0.65

## 1.0.48

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 1.0.47

### Patch Changes

- zhin.js@1.0.63

## 1.0.46

### Patch Changes

- zhin.js@1.0.62

## 1.0.45

### Patch Changes

- zhin.js@1.0.61

## 1.0.44

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

## 1.0.43

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 1.0.42

### Patch Changes

- zhin.js@1.0.58

## 1.0.41

### Patch Changes

- zhin.js@1.0.57

## 1.0.40

### Patch Changes

- zhin.js@1.0.56

## 1.0.39

### Patch Changes

- zhin.js@1.0.55

## 1.0.38

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 1.0.37

### Patch Changes

- zhin.js@1.0.53

## 1.0.36

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 1.0.35

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 1.0.34

### Patch Changes

- zhin.js@1.0.51

## 1.0.33

### Patch Changes

- zhin.js@1.0.50

## 1.0.32

### Patch Changes

- zhin.js@1.0.49

## 1.0.31

### Patch Changes

- zhin.js@1.0.48

## 1.0.30

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 1.0.29

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 1.0.28

### Patch Changes

- zhin.js@1.0.45

## 1.0.27

### Patch Changes

- zhin.js@1.0.44

## 1.0.26

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 1.0.25

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/host-router@1.0.36

## 1.0.24

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/host-router@1.0.35

## 1.0.23

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 1.0.22

### Patch Changes

- zhin.js@1.0.39
- @zhin.js/host-router@1.0.33

## 1.0.21

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 1.0.20

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/host-router@1.0.30

## 1.0.19

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - zhin.js@1.0.36

## 1.0.18

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/host-router@1.0.28

## 1.0.17

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/host-router@1.0.27

## 1.0.16

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/host-router@1.0.26

## 1.0.15

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/host-router@1.0.24

## 1.0.14

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/host-router@1.0.23

## 1.0.13

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/host-router@1.0.22

## 1.0.12

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/host-router@1.0.21

## 1.0.11

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
- Updated dependencies [05a514d]
  - @zhin.js/host-router@1.0.20
  - zhin.js@1.0.28

## 1.0.10

### Patch Changes

- Updated dependencies [b27e633]
  - @zhin.js/host-router@1.0.18
  - zhin.js@1.0.27

## 1.0.9

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/host-router@1.0.17
  - zhin.js@1.0.26

## 1.0.8

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/ai@0.0.2
  - zhin.js@1.0.25
  - @zhin.js/host-router@1.0.16

## 1.0.7

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/host-router@1.0.15

## 1.0.6

### Patch Changes

- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/host-router@1.0.14

## 1.0.5

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/host-router@1.0.13

## 1.0.4

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/host-router@1.0.12

## 1.0.3

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/host-router@1.0.11
  - zhin.js@1.0.20

## 1.0.2

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - zhin.js@1.0.19
  - @zhin.js/host-router@1.0.10

## 1.0.1

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - zhin.js@1.0.18
  - @zhin.js/host-router@1.0.9

## 1.0.0

### Features

- 🎉 初始版本
- 🤖 提供 MCP Server 支持，让 AI 助手能够理解和生成 Zhin 插件
- 🌐 使用 StreamableHTTPServerTransport 提供 HTTP Stream 传输
- 📦 使用最新的 @modelcontextprotocol/sdk (v1.22.0)
- 🚀 **使用 McpServer 高级 API**，提供更简洁的开发体验
- 🛠️ 内置丰富的开发工具：插件生成、命令生成、组件生成等
- 📚 提供完整的 Zhin 框架文档和最佳实践
- 🔍 支持查询现有插件、命令、组件结构
- 💡 提供代码模板和示例
- ✅ 使用 Zod Schema 进行参数验证
- 📁 模块化代码结构，易于维护和扩展
