# Changelog

## 6.0.0

### Patch Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0

## 5.0.3

### Patch Changes

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/agent@1.0.4
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 5.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/client@2.0.5
  - @zhin.js/contract@1.0.3
  - @zhin.js/host-api@2.0.5
  - @zhin.js/host-router@2.0.3
  - @zhin.js/logger@1.0.74
  - zhin.js@4.1.2

## 5.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - @zhin.js/logger@1.0.73
  - @zhin.js/client@2.0.4
  - @zhin.js/contract@1.0.2
  - @zhin.js/host-api@2.0.4
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 5.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/host-api@2.0.3
  - zhin.js@4.1.0
  - @zhin.js/logger@1.0.72

## 4.0.2

### Patch Changes

- Updated dependencies [384ea11]
  - @zhin.js/host-api@2.0.2
  - zhin.js@4.0.1

## 4.0.1

### Patch Changes

- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/host-api@2.0.1
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 4.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/host-api@2.0.0
- @zhin.js/host-router@2.0.0

## 3.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/host-api@1.0.1
  - zhin.js@2.0.1
  - @zhin.js/logger@0.1.71
  - @zhin.js/client@2.0.3

## 3.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
  - @zhin.js/host-api@1.0.0
  - zhin.js@2.0.0
  - @zhin.js/host-router@1.0.0

## 2.0.11

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 2.0.10

### Patch Changes

- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/host-api@0.0.4
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 2.0.9

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/client@2.0.2
  - @zhin.js/contract@1.0.1
  - @zhin.js/host-api@0.0.3
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 2.0.8

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/client@2.0.1
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89
  - @zhin.js/host-api@0.0.2

## 2.0.7

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 2.0.6

### Patch Changes

- 90d9efd: fix: 处理包名
- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - zhin.js@1.0.87
  - @zhin.js/host-api@0.0.1
  - @zhin.js/host-router@0.0.1

## 2.0.5

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68
  - @zhin.js/client@1.1.4
  - zhin.js@1.0.86
  - @zhin.js/console@3.0.5
  - @zhin.js/host-router@1.0.79

## 2.0.4

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/logger@0.1.67
- @zhin.js/console@3.0.4
- @zhin.js/host-router@1.0.78

## 2.0.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - @zhin.js/console@3.0.3
  - zhin.js@1.0.84
  - @zhin.js/logger@0.1.66
  - @zhin.js/client@1.1.3
  - @zhin.js/host-router@1.0.77

## 2.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console@3.0.2
  - @zhin.js/host-router@1.0.76
  - @zhin.js/client@1.1.2
  - zhin.js@1.0.83
  - @zhin.js/logger@0.1.65

## 2.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console@3.0.1
  - @zhin.js/host-router@1.0.75
  - @zhin.js/logger@0.1.64
  - @zhin.js/client@1.1.1
  - zhin.js@1.0.82

## 2.0.0

### Patch Changes

- Updated dependencies
  - @zhin.js/client@1.1.0
  - @zhin.js/console@3.0.0

## 1.0.69

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/logger@0.1.63
  - @zhin.js/console@2.0.24
  - @zhin.js/host-router@1.0.74

## 1.0.68

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/logger@0.1.62
- @zhin.js/console@2.0.23
- @zhin.js/host-router@1.0.73

## 1.0.67

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/logger@0.1.61
- @zhin.js/console@2.0.22
- @zhin.js/host-router@1.0.72

## 1.0.66

### Patch Changes

- Updated dependencies [88caeb2]
  - @zhin.js/console@2.0.21
  - zhin.js@1.0.78
  - @zhin.js/logger@0.1.60
  - @zhin.js/host-router@1.0.71

## 1.0.65

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/logger@0.1.59
- @zhin.js/console@2.0.20
- @zhin.js/host-router@1.0.70

## 1.0.64

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/logger@0.1.58
  - @zhin.js/console@2.0.19
  - @zhin.js/host-router@1.0.69

## 1.0.63

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/logger@0.1.57
- @zhin.js/console@2.0.18
- @zhin.js/host-router@1.0.68

## 1.0.62

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/logger@0.1.56
  - @zhin.js/console@2.0.17
  - @zhin.js/host-router@1.0.67

## 1.0.61

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/logger@0.1.55
  - @zhin.js/console@2.0.16
  - @zhin.js/host-router@1.0.66

## 1.0.60

### Patch Changes

- Updated dependencies [21efca3]
  - @zhin.js/console@2.0.15

## 1.0.59

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化
- Updated dependencies [abc75a4]
  - @zhin.js/console@2.0.14

## 1.0.58

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - @zhin.js/client@1.0.18
  - zhin.js@1.0.72
  - @zhin.js/console@2.0.13
  - @zhin.js/host-router@1.0.65

## 1.0.57

### Patch Changes

- Updated dependencies [60b1a4d]
  - @zhin.js/console@2.0.12

## 1.0.56

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - @zhin.js/client@1.0.17
  - zhin.js@1.0.71
  - @zhin.js/console@2.0.11
  - @zhin.js/host-router@1.0.64

## 1.0.55

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/logger@0.1.52
- @zhin.js/console@2.0.10
- @zhin.js/host-router@1.0.63

## 1.0.54

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67
  - @zhin.js/logger@0.1.51
  - @zhin.js/console@2.0.9

## 1.0.53

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/logger@0.1.50
- @zhin.js/console@2.0.8
- @zhin.js/host-router@1.0.61

## 1.0.52

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/logger@0.1.49
- @zhin.js/console@2.0.7
- @zhin.js/host-router@1.0.60

## 1.0.51

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/client@1.0.16
  - zhin.js@1.0.64
  - @zhin.js/console@2.0.6
  - @zhin.js/host-router@1.0.59

## 1.0.50

### Patch Changes

- ba30934: fix: web 优化
- Updated dependencies [ba30934]
  - @zhin.js/console@2.0.5
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63
  - @zhin.js/logger@0.1.47

## 1.0.49

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/logger@0.1.46

## 1.0.48

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/logger@0.1.45

## 1.0.47

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
  - @zhin.js/logger@0.1.44

## 1.0.46

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - zhin.js@1.0.59

## 1.0.45

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/logger@0.1.42

## 1.0.44

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/logger@0.1.41

## 1.0.43

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/logger@0.1.40

## 1.0.42

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/logger@0.1.39

## 1.0.41

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - zhin.js@1.0.54

## 1.0.40

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/logger@0.1.37

## 1.0.39

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 1.0.38

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/logger@0.1.36

## 1.0.37

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/logger@0.1.35

## 1.0.36

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/logger@0.1.34

## 1.0.35

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/logger@0.1.33

## 1.0.34

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/logger@0.1.32

## 1.0.33

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/logger@0.1.31

## 1.0.32

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/logger@0.1.30

## 1.0.31

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/logger@0.1.29

## 1.0.30

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/logger@0.1.28

## 1.0.29

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43
  - @zhin.js/logger@0.1.27

## 1.0.28

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/logger@0.1.26

## 1.0.27

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/logger@0.1.25

## 1.0.26

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/logger@0.1.24

## 1.0.25

### Patch Changes

- zhin.js@1.0.39
- @zhin.js/logger@0.1.23

## 1.0.24

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/logger@0.1.22

## 1.0.23

### Patch Changes

- bb0be4c: fix: 平台能力增强

## 1.0.22

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/logger@0.1.21

## 1.0.21

### Patch Changes

- zhin.js@1.0.36
- @zhin.js/logger@0.1.20

## 1.0.20

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/logger@0.1.19

## 1.0.19

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/logger@0.1.18

## 1.0.18

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/logger@0.1.17

## 1.0.17

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/logger@0.1.16

## 1.0.16

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/logger@0.1.15

## 1.0.15

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/logger@0.1.14

## 1.0.14

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/logger@0.1.13

## 1.0.13

### Patch Changes

- zhin.js@1.0.28
- @zhin.js/logger@0.1.12

## 1.0.12

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27
  - @zhin.js/logger@0.1.11

## 1.0.11

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26
  - @zhin.js/logger@0.1.10

## 1.0.10

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/logger@0.1.9
  - zhin.js@1.0.25

## 1.0.9

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/logger@0.1.8

## 1.0.8

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/logger@0.1.7

## 1.0.7

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/logger@0.1.6

## 1.0.6

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/logger@0.1.5

## 1.0.5

### Patch Changes

- a3b7673: fix: 调整依赖项
- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - zhin.js@1.0.20

## 1.0.4

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - zhin.js@1.0.19

## 1.0.3

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - zhin.js@1.0.18

## 1.0.2

### Patch Changes

- zhin.js@1.0.17

## 1.0.1

### Patch Changes

- cda76be: fix: add adapters

## 1.0.0 (2025-01-19)

### Features

- Initial release of Telegram adapter
- Support for text messages with formatting
- Rich media support (images, videos, audio, documents, stickers)
- Long polling and webhook modes
- Reply and quote functionality
- Callback query handling
- Private and group chat support
