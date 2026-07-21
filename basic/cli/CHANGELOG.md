# @zhin.js/cli

## 1.0.95

### Patch Changes

- 90f301d: fix: log format

## 1.0.94

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

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
  - @zhin.js/schedule@0.0.3
  - @zhin.js/pagemanager@2.0.4
  - @zhin.js/scaffold-wizard@0.1.9
  - @zhin.js/logger@1.0.75
  - @zhin.js/database@1.0.77
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/speech@1.0.4
  - @zhin.js/config-yaml@1.0.1
  - @zhin.js/runtime@1.0.1

## 1.0.93

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/scaffold-wizard@0.1.8

## 1.0.92

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
  - @zhin.js/logger@1.0.73
  - @zhin.js/scaffold-wizard@0.1.7

## 1.0.91

### Patch Changes

- b2c73bd: fix: 初始化项目后,安装依赖失败
- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [b2c73bd]
- Updated dependencies [c4575c9]
  - @zhin.js/scaffold-wizard@0.1.6
  - @zhin.js/logger@1.0.72

## 1.0.90

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身
- Updated dependencies [7dfafc2]
- Updated dependencies [ae5239c]
  - @zhin.js/scaffold-wizard@0.1.5

## 1.0.89

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71
  - @zhin.js/scaffold-wizard@0.1.4

## 1.0.88

### Patch Changes

- Updated dependencies [d8547d2]
  - @zhin.js/scaffold-wizard@0.1.3

## 1.0.87

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
  - @zhin.js/scaffold-wizard@0.1.2

## 1.0.86

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/scaffold-wizard@0.1.1

## 1.0.85

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.0.84

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身

## 1.0.83

### Patch Changes

- 90d9efd: fix: 处理包名
- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69

## 1.0.82

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68
  - zhin.js@1.0.86

## 1.0.81

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/logger@0.1.67

## 1.0.80

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/logger@0.1.66

## 1.0.79

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83
  - @zhin.js/logger@0.1.65

## 1.0.78

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - zhin.js@1.0.82

## 1.0.77

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/logger@0.1.63

## 1.0.76

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/logger@0.1.62

## 1.0.75

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/logger@0.1.61

## 1.0.74

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/logger@0.1.60

## 1.0.73

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/logger@0.1.59

## 1.0.72

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/logger@0.1.58

## 1.0.71

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/logger@0.1.57

## 1.0.70

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/logger@0.1.56

## 1.0.69

### Patch Changes

- zhin.js@1.0.73
- @zhin.js/logger@0.1.55

## 1.0.68

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 1.0.67

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - zhin.js@1.0.72

## 1.0.66

### Patch Changes

- 4304825: fix: 重新发版
- cea7a33: fix: cli 优化
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - zhin.js@1.0.71

## 1.0.65

### Patch Changes

- d0250e8: fix: 修复 onebot11 的反向 bug,优化 cli
  - zhin.js@1.0.68
  - @zhin.js/logger@0.1.52

## 1.0.64

### Patch Changes

- zhin.js@1.0.67
- @zhin.js/logger@0.1.51

## 1.0.63

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/logger@0.1.50

## 1.0.62

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/logger@0.1.49

## 1.0.61

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - zhin.js@1.0.64

## 1.0.60

### Patch Changes

- zhin.js@1.0.63
- @zhin.js/logger@0.1.47

## 1.0.59

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/logger@0.1.46

## 1.0.58

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/logger@0.1.45

## 1.0.57

### Patch Changes

- Updated dependencies [5073d4c]
  - zhin.js@1.0.60
  - @zhin.js/logger@0.1.44

## 1.0.56

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - zhin.js@1.0.59

## 1.0.55

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/logger@0.1.42

## 1.0.54

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/logger@0.1.41

## 1.0.53

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/logger@0.1.40

## 1.0.52

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/logger@0.1.39

## 1.0.51

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - zhin.js@1.0.54

## 1.0.50

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/logger@0.1.37

## 1.0.49

### Patch Changes

- bb6bfa8: feat: `zhin new` 为插件创建 `skills/<name>/` 与 `SKILL.md` 模板；生成 `package.json` 的 `files`/`exports`（含 `development`、`./package.json`）与仓库插件约定对齐
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/logger@0.1.36

## 1.0.48

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/logger@0.1.35

## 1.0.47

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/logger@0.1.34

## 1.0.46

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/logger@0.1.33

## 1.0.45

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/logger@0.1.32

## 1.0.44

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/logger@0.1.31

## 1.0.43

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/logger@0.1.30

## 1.0.42

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/logger@0.1.29

## 1.0.41

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/logger@0.1.28

## 1.0.40

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43
  - @zhin.js/logger@0.1.27

## 1.0.39

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/logger@0.1.26

## 1.0.38

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/logger@0.1.25

## 1.0.37

### Patch Changes

- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/logger@0.1.24

## 1.0.36

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/logger@0.1.23

## 1.0.35

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/logger@0.1.22

## 1.0.34

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/logger@0.1.21

## 1.0.33

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth
  - zhin.js@1.0.36
  - @zhin.js/logger@0.1.20

## 1.0.32

### Patch Changes

- 8502351: fix: token 优化
  - zhin.js@1.0.35
  - @zhin.js/logger@0.1.19

## 1.0.31

### Patch Changes

- 634e2d7: fix: ai 强化
  - zhin.js@1.0.34
  - @zhin.js/logger@0.1.18

## 1.0.30

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/logger@0.1.17

## 1.0.29

### Patch Changes

- 48481a8: fix: @zhin.js/adapter-icqq 内置点赞工具
  fix: create-zhin-app 默认增加 send 指令
  fix: @zhin.js/cli 重命名 onborading 为 onborad 并重写实现,新增 zhin send 命令，用于直接通过 send 命令发送消息
  fix: @zhin.js/host-router 新增消息发送 api

## 1.0.28

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/logger@0.1.16

## 1.0.27

### Patch Changes

- 771706d: fix: 技能优化
  - zhin.js@1.0.31
  - @zhin.js/logger@0.1.15

## 1.0.26

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/logger@0.1.14

## 1.0.25

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/logger@0.1.13

## 1.0.24

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
  - zhin.js@1.0.28
  - @zhin.js/logger@0.1.12

## 1.0.23

### Patch Changes

- 2b44e18: fix: change version

## 1.0.22

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27
  - @zhin.js/logger@0.1.11

## 1.0.21

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26
  - @zhin.js/logger@0.1.10

## 1.0.20

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/logger@0.1.9
  - zhin.js@1.0.25

## 1.0.19

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/logger@0.1.8

## 1.0.18

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/logger@0.1.7

## 1.0.17

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/logger@0.1.6

## 1.0.16

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/logger@0.1.5

## 1.0.15

### Patch Changes

- 7aa94b1: fix: 更新 create-bot

## 1.0.14

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - zhin.js@1.0.20

## 1.0.13

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - zhin.js@1.0.19

## 1.0.12

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - zhin.js@1.0.18

## 1.0.11

### Patch Changes

- 3bc5d56: fix: 内存优化

## 1.0.10

### Patch Changes

- cda76be: fix: add adapters

## 1.0.9

### Patch Changes

- 8b367ab: fix: cli err

## 1.0.8

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持

## 1.0.7

### Patch Changes

- c1a539e: fix: cli 优化,console 优化
- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1

## 1.0.6

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.5

### Patch Changes

- f347667: fix: runtime error

## 1.0.4

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.3

### Patch Changes

- ffa9cbc: fix: create-zhin-app 查询 cli 路径错误

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- ebf852c: fix: change docs,add @types/node
- cd8c8a8: fix: 更改默认配置的插件查找目录

## 1.0.1

### Patch Changes

- efdd58a: fix: init
