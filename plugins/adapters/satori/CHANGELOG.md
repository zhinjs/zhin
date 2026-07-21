# @zhin.js/adapter-satori

## 3.0.3

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
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 3.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 3.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

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

- zhin.js@2.0.0
- @zhin.js/host-router@1.0.0

## 0.0.42

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 0.0.41

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 0.0.40

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 0.0.39

### Patch Changes

- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89

## 0.0.38

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.0.37

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/host-router@0.0.1

## 0.0.36

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86
  - @zhin.js/host-router@1.0.79

## 0.0.35

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/host-router@1.0.78

## 0.0.34

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/host-router@1.0.77

## 0.0.33

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/host-router@1.0.76
  - zhin.js@1.0.83

## 0.0.32

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/host-router@1.0.75
  - zhin.js@1.0.82

## 0.0.31

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/host-router@1.0.74

## 0.0.30

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/host-router@1.0.73

## 0.0.29

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/host-router@1.0.72

## 0.0.28

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/host-router@1.0.71

## 0.0.27

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/host-router@1.0.70

## 0.0.26

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/host-router@1.0.69

## 0.0.25

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/host-router@1.0.68

## 0.0.24

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/host-router@1.0.67

## 0.0.23

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/host-router@1.0.66

## 0.0.22

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 0.0.21

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/host-router@1.0.65

## 0.0.20

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/host-router@1.0.64

## 0.0.19

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/host-router@1.0.63

## 0.0.18

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67

## 0.0.17

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/host-router@1.0.61

## 0.0.16

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/host-router@1.0.60

## 0.0.15

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/host-router@1.0.59

## 0.0.14

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63

## 0.0.13

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/host-router@1.0.57

## 0.0.12

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/host-router@1.0.56

## 0.0.11

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

## 0.0.10

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 0.0.9

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/host-router@1.0.53

## 0.0.8

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/host-router@1.0.52

## 0.0.7

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/host-router@1.0.51

## 0.0.6

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/host-router@1.0.50

## 0.0.5

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 0.0.4

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 0.0.3

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 0.0.2

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/host-router@1.0.46

## 0.0.1

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45
