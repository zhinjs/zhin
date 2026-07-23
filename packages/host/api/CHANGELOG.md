# @zhin.js/host-api

## 3.0.0

### Patch Changes

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [5849336]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/pagemanager@2.0.5
  - @zhin.js/host-router@3.0.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/client@2.1.0
  - @zhin.js/console-protocol@1.1.0
  - @zhin.js/contract@1.0.5

## 2.0.6

### Patch Changes

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/agent@1.0.4
  - @zhin.js/pagemanager@2.0.4
  - @zhin.js/database@1.0.77
  - @zhin.js/host-router@2.0.4
  - @zhin.js/contract@1.0.4
  - @zhin.js/client@2.0.6

## 2.0.5

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/client@2.0.5
  - @zhin.js/contract@1.0.3
  - @zhin.js/core@1.3.4
  - @zhin.js/host-router@2.0.3
  - @zhin.js/pagemanager@2.0.3
  - @zhin.js/database@1.0.76

## 2.0.4

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/agent@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/database@1.0.75
  - @zhin.js/schema@1.0.71
  - @zhin.js/client@2.0.4
  - @zhin.js/contract@1.0.2
  - @zhin.js/pagemanager@2.0.2
  - @zhin.js/host-router@2.0.2

## 2.0.3

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/agent@1.0.1
  - @zhin.js/core@1.3.2

## 2.0.2

### Patch Changes

- 384ea11: fix: 写库前检查

## 2.0.1

### Patch Changes

- 93e58d9: refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

  - 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
  - `core/index.ts` 移除死导出、统一结构
  - 新增 `Disposable` 接口替代 `as any` dispose 调用
  - `bridge.ts` MCP inputSchema 类型安全
  - 脚手架依赖版本锁定（latest → ^major.minor.0）
  - 修复 icqq/sandbox 客户端缺失 Bot 图标导入

- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/agent@0.3.1
  - @zhin.js/core@1.3.1
  - @zhin.js/host-router@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/agent@0.3.0
  - @zhin.js/core@1.3.0
  - @zhin.js/host-router@2.0.0

## 1.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/agent@0.2.1
  - @zhin.js/core@1.2.1
  - @zhin.js/database@1.0.74
  - @zhin.js/client@2.0.3

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

- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - @zhin.js/agent@0.2.0
  - @zhin.js/host-router@1.0.0

## 0.0.4

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/agent@0.1.30
  - @zhin.js/core@1.1.32
  - @zhin.js/host-router@0.0.3

## 0.0.3

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
- Updated dependencies [c8f8207]
  - @zhin.js/schema@1.0.70
  - @zhin.js/client@2.0.2
  - @zhin.js/contract@1.0.1
  - @zhin.js/pagemanager@2.0.1
  - @zhin.js/host-router@0.0.3
  - @zhin.js/agent@0.1.29
  - @zhin.js/core@1.1.31

## 0.0.2

### Patch Changes

- Updated dependencies [c78d2cd]
  - @zhin.js/client@2.0.1
  - @zhin.js/host-router@0.0.2
  - @zhin.js/agent@0.1.28
  - @zhin.js/core@1.1.30

## 0.0.1

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/schema@1.0.69
  - @zhin.js/core@1.1.29
  - @zhin.js/agent@0.1.27
  - @zhin.js/host-router@0.0.1

## 0.0.0

### Major Changes

- 自 `@zhin.js/console` 重命名为 `@zhin.js/host-api`，源码迁至 `packages/host/api`（无垫片）。
- Host 侧 API-only：`serveClientHost: false`；聊天与管理 UI 见仓库 **zhin-console** / https://console.zhin.dev 。
- 配置键：`hostApi`（不再读取 `plugins.console` 别名）。

## 3.0.5

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/agent@0.1.26
  - @zhin.js/core@1.1.28
  - @zhin.js/client@1.1.4
  - @zhin.js/console-core@1.0.4
  - @zhin.js/console-types@0.1.5
  - @zhin.js/host-router-host@0.1.4
  - zhin.js@1.0.86
  - @zhin.js/host-router@1.0.79

## 3.0.4

### Patch Changes

- Updated dependencies [b0e0a71]
  - @zhin.js/agent@0.1.25
  - zhin.js@1.0.85
  - @zhin.js/host-router@1.0.78
  - @zhin.js/core@1.1.27

## 3.0.3

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/console-core@1.0.3
  - @zhin.js/host-router-host@0.1.3
  - @zhin.js/agent@0.1.24
  - @zhin.js/core@1.1.26
  - zhin.js@1.0.84
  - @zhin.js/client@1.1.3
  - @zhin.js/console-types@0.1.4
  - @zhin.js/host-router@1.0.77

## 3.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3
  - @zhin.js/console-core@1.0.2
  - @zhin.js/host-router@1.0.76
  - @zhin.js/host-router-host@0.1.2
  - @zhin.js/client@1.1.2
  - @zhin.js/agent@0.1.23
  - @zhin.js/core@1.1.25
  - zhin.js@1.0.83

## 3.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/host-router@1.0.75
  - @zhin.js/agent@0.1.22
  - @zhin.js/client@1.1.1
  - @zhin.js/console-core@1.0.1
  - @zhin.js/console-types@0.1.2
  - @zhin.js/core@1.1.24
  - zhin.js@1.0.82

## 3.0.0

### Major Changes

- Remote Console 与 Host 分离：zhin 主仓仅保留 Console **API**，静态 UI 迁至独立仓库 [zhinjs/console](https://github.com/zhinjs/console)。

  ### @zhin.js/console-core (major)

  - 移除 `./browser` 导出；包仅含 Node 侧 PageManager、`/entries`、`/@dev`、`/esm` 打包管线。
  - 不再依赖 `console-app` 内置壳；`registerBuiltinAppShellServer` 已删除。

  ### @zhin.js/client (minor)

  - 合并原 `@zhin.js/console-core/browser` 能力：`loadConsoleEntries`、`apiFetch`、`getApiBase`、`createRegistryStore` 等。
  - Remote Console UI 应依赖本包 + `zhin-console` 静态站，勿再 `import from '@zhin.js/console-core/browser'`。

  ### @zhin.js/console (major)

  - Host 默认 **api_only**（`serveClientHost: false`），不再捆绑 Farm 静态页。
  - 移除对 `@zhin.js/console-app` 的依赖；`PageManager` 的 esbuild 解析根目录改为机器人项目根（`ZHIN_PROJECT_ROOT` / `cwd`）。
  - 删除 `plugins/services/console/client` 内置 UI 源码（已迁至 zhin-console）。

### Patch Changes

- Updated dependencies
  - @zhin.js/console-core@1.0.0
  - @zhin.js/client@1.1.0

## 2.0.24

### Patch Changes

- Updated dependencies [8086ccb]
  - @zhin.js/agent@0.1.21
  - @zhin.js/core@1.1.23
  - zhin.js@1.0.81
  - @zhin.js/host-router@1.0.74

## 2.0.23

### Patch Changes

- Updated dependencies [3b3e49b]
  - @zhin.js/agent@0.1.20
  - zhin.js@1.0.80
  - @zhin.js/host-router@1.0.73
  - @zhin.js/core@1.1.22

## 2.0.22

### Patch Changes

- Updated dependencies [92da96d]
  - @zhin.js/agent@0.1.19
  - zhin.js@1.0.79
  - @zhin.js/host-router@1.0.72
  - @zhin.js/core@1.1.21

## 2.0.21

### Patch Changes

- 88caeb2: fix: ask user 护栏
- Updated dependencies [88caeb2]
  - @zhin.js/agent@0.1.18
  - @zhin.js/core@1.1.20
  - zhin.js@1.0.78
  - @zhin.js/host-router@1.0.71

## 2.0.20

### Patch Changes

- Updated dependencies [fcad030]
  - @zhin.js/agent@0.1.17
  - zhin.js@1.0.77
  - @zhin.js/core@1.1.19
  - @zhin.js/host-router@1.0.70

## 2.0.19

### Patch Changes

- Updated dependencies [cb9fbf1]
  - @zhin.js/agent@0.1.16
  - zhin.js@1.0.76
  - @zhin.js/host-router@1.0.69
  - @zhin.js/core@1.1.18

## 2.0.18

### Patch Changes

- @zhin.js/agent@0.1.15
- @zhin.js/core@1.1.17
- zhin.js@1.0.75
- @zhin.js/host-router@1.0.68

## 2.0.17

### Patch Changes

- Updated dependencies [c9dec38]
  - @zhin.js/agent@0.1.14
  - @zhin.js/core@1.1.16
  - zhin.js@1.0.74
  - @zhin.js/host-router@1.0.67

## 2.0.16

### Patch Changes

- Updated dependencies [63d0b88]
  - @zhin.js/agent@0.1.13
  - zhin.js@1.0.73
  - @zhin.js/host-router@1.0.66
  - @zhin.js/core@1.1.15

## 2.0.15

### Patch Changes

- 21efca3: fix: console error
- Updated dependencies [21efca3]
  - @zhin.js/console-app@0.1.3

## 2.0.14

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化
- Updated dependencies [abc75a4]
  - @zhin.js/console-app@0.1.2

## 2.0.13

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/agent@0.1.12
  - @zhin.js/client@1.0.18
  - @zhin.js/console-app@0.1.1
  - @zhin.js/console-core@0.1.1
  - @zhin.js/console-types@0.1.1
  - @zhin.js/core@1.1.14
  - zhin.js@1.0.72
  - @zhin.js/host-router@1.0.65

## 2.0.12

### Patch Changes

- 60b1a4d: fix: console 发版

## 2.0.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/agent@0.1.11
  - @zhin.js/client@1.0.17
  - @zhin.js/core@1.1.13
  - zhin.js@1.0.71
  - @zhin.js/host-router@1.0.64

## 2.0.10

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/agent@0.1.10
  - zhin.js@1.0.68
  - @zhin.js/host-router@1.0.63

## 2.0.9

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - @zhin.js/agent@0.1.9
  - @zhin.js/core@1.1.9
  - zhin.js@1.0.67

## 2.0.8

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/agent@0.1.8
  - zhin.js@1.0.66
  - @zhin.js/core@1.1.8
  - @zhin.js/host-router@1.0.61

## 2.0.7

### Patch Changes

- @zhin.js/agent@0.1.7
- @zhin.js/core@1.1.7
- zhin.js@1.0.65
- @zhin.js/host-router@1.0.60

## 2.0.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/agent@0.1.6
  - @zhin.js/client@1.0.16
  - @zhin.js/core@1.1.6
  - zhin.js@1.0.64
  - @zhin.js/host-router@1.0.59

## 2.0.5

### Patch Changes

- ba30934: fix: web 优化
- Updated dependencies [ba30934]
  - @zhin.js/host-router@1.0.58
  - @zhin.js/agent@0.1.5
  - zhin.js@1.0.63
  - @zhin.js/core@1.1.5

## 2.0.4

### Patch Changes

- Updated dependencies [bf0dc75]
  - @zhin.js/agent@0.1.4
  - zhin.js@1.0.62
  - @zhin.js/host-router@1.0.57
  - @zhin.js/core@1.1.4

## 2.0.3

### Patch Changes

- Updated dependencies [a257f3f]
  - @zhin.js/agent@0.1.3
  - zhin.js@1.0.61
  - @zhin.js/host-router@1.0.56
  - @zhin.js/core@1.1.3

## 2.0.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/agent@0.1.2
  - @zhin.js/core@1.1.2
  - zhin.js@1.0.60
  - @zhin.js/host-router@1.0.55

## 2.0.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/agent@0.1.1
  - @zhin.js/client@1.0.15
  - @zhin.js/core@1.1.1
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 2.0.0

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/core@1.1.0
  - zhin.js@1.0.58
  - @zhin.js/host-router@1.0.53

## 1.0.59

### Patch Changes

- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - zhin.js@1.0.57
  - @zhin.js/host-router@1.0.52

## 1.0.58

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/core@1.0.56
- @zhin.js/host-router@1.0.51

## 1.0.57

### Patch Changes

- a4e3559: fix: 客户端 err

## 1.0.56

### Patch Changes

- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - zhin.js@1.0.55
  - @zhin.js/host-router@1.0.50

## 1.0.55

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/client@1.0.14
  - @zhin.js/core@1.0.54
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 1.0.54

### Patch Changes

- @zhin.js/core@1.0.53
- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 1.0.53

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 1.0.52

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - zhin.js@1.0.52
  - @zhin.js/client@1.0.13
  - @zhin.js/host-router@1.0.46

## 1.0.51

### Patch Changes

- a451abf: fix: console 白屏

## 1.0.50

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45
- @zhin.js/core@1.0.51

## 1.0.49

### Patch Changes

- 353de3d: fix: 控制台优化
- Updated dependencies [353de3d]
  - @zhin.js/client@1.0.12

## 1.0.48

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/host-router@1.0.44
- @zhin.js/core@1.0.50

## 1.0.47

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - zhin.js@1.0.49
  - @zhin.js/host-router@1.0.43

## 1.0.46

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - zhin.js@1.0.48
  - @zhin.js/host-router@1.0.42

## 1.0.45

### Patch Changes

- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - zhin.js@1.0.47
  - @zhin.js/host-router@1.0.41

## 1.0.44

### Patch Changes

- Updated dependencies [7394603]
  - @zhin.js/core@1.0.46
  - zhin.js@1.0.46
  - @zhin.js/host-router@1.0.40

## 1.0.43

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - zhin.js@1.0.45
  - @zhin.js/host-router@1.0.39

## 1.0.42

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/host-router@1.0.38
- @zhin.js/core@1.0.44

## 1.0.41

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - @zhin.js/host-router@1.0.37
  - @zhin.js/client@1.0.11
  - @zhin.js/core@1.0.43
  - zhin.js@1.0.43

## 1.0.40

### Patch Changes

- 5f5127c: fix: web url 调整

## 1.0.39

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/core@1.0.42
- @zhin.js/host-router@1.0.36

## 1.0.38

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - zhin.js@1.0.41
  - @zhin.js/host-router@1.0.35

## 1.0.37

### Patch Changes

- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 1.0.36

### Patch Changes

- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39
  - zhin.js@1.0.39
  - @zhin.js/host-router@1.0.33

## 1.0.35

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 1.0.34

### Patch Changes

- 631da6e: fix: 约定公开路由前缀/pub
- Updated dependencies [631da6e]
  - @zhin.js/host-router@1.0.31

## 1.0.33

### Patch Changes

- Updated dependencies [a8ce720]
  - @zhin.js/core@1.0.37
  - zhin.js@1.0.37
  - @zhin.js/host-router@1.0.30

## 1.0.32

### Patch Changes

- 432d0a5: fix: 鉴权优化
- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - @zhin.js/core@1.0.36
  - zhin.js@1.0.36

## 1.0.31

### Patch Changes

- Updated dependencies [8502351]
  - @zhin.js/core@1.0.35
  - zhin.js@1.0.35
  - @zhin.js/host-router@1.0.28

## 1.0.30

### Patch Changes

- Updated dependencies [634e2d7]
  - @zhin.js/core@1.0.34
  - zhin.js@1.0.34
  - @zhin.js/host-router@1.0.27

## 1.0.29

### Patch Changes

- Updated dependencies [4abae79]
  - @zhin.js/core@1.0.33
  - zhin.js@1.0.33
  - @zhin.js/host-router@1.0.26

## 1.0.28

### Patch Changes

- Updated dependencies [10d8bdc]
  - @zhin.js/core@1.0.32
  - zhin.js@1.0.32
  - @zhin.js/host-router@1.0.24

## 1.0.27

### Patch Changes

- Updated dependencies [771706d]
  - @zhin.js/core@1.0.31
  - zhin.js@1.0.31
  - @zhin.js/host-router@1.0.23

## 1.0.26

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/host-router@1.0.22
  - @zhin.js/core@1.0.30

## 1.0.25

### Patch Changes

- Updated dependencies [4ec9176]
  - @zhin.js/core@1.0.29
  - zhin.js@1.0.29
  - @zhin.js/host-router@1.0.21

## 1.0.24

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
- Updated dependencies [05a514d]
  - @zhin.js/host-router@1.0.20
  - @zhin.js/client@1.0.10
  - @zhin.js/core@1.0.28
  - zhin.js@1.0.28

## 1.0.23

### Patch Changes

- Updated dependencies [b27e633]
  - @zhin.js/host-router@1.0.18
  - @zhin.js/core@1.0.27
  - zhin.js@1.0.27

## 1.0.22

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/host-router@1.0.17
  - @zhin.js/client@1.0.9
  - @zhin.js/core@1.0.26
  - zhin.js@1.0.26

## 1.0.21

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/client@1.0.8
  - @zhin.js/core@1.0.25
  - zhin.js@1.0.25
  - @zhin.js/host-router@1.0.16

## 1.0.20

### Patch Changes

- Updated dependencies [6108e5d]
  - @zhin.js/core@1.0.24
  - zhin.js@1.0.24
  - @zhin.js/host-router@1.0.15

## 1.0.19

### Patch Changes

- Updated dependencies [52ae08a]
  - @zhin.js/core@1.0.23
  - zhin.js@1.0.23
  - @zhin.js/host-router@1.0.14

## 1.0.18

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/host-router@1.0.13
  - @zhin.js/core@1.0.22

## 1.0.17

### Patch Changes

- Updated dependencies [3960e70]
  - @zhin.js/core@1.0.21
  - zhin.js@1.0.21
  - @zhin.js/host-router@1.0.12

## 1.0.16

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/host-router@1.0.11
  - @zhin.js/core@1.0.20
  - zhin.js@1.0.20

## 1.0.15

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/client@1.0.7
  - @zhin.js/core@1.0.19
  - @zhin.js/host-router@1.0.10

## 1.0.14

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/client@1.0.6
  - @zhin.js/core@1.0.18
  - @zhin.js/host-router@1.0.9

## 1.0.13

### Patch Changes

- 3bc5d56: fix: 内存优化
- Updated dependencies [3bc5d56]
  - @zhin.js/core@1.0.17

## 1.0.12

### Patch Changes

- 9bc8dc4: fix: remove log,find client

## 1.0.11

### Patch Changes

- 8f75b7f: fix: production

## 1.0.10

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/types@1.0.5
  - @zhin.js/core@1.0.14
  - @zhin.js/host-router@1.0.7

## 1.0.9

### Patch Changes

- 4034b94: fix: allow host
- Updated dependencies [a2e1ebc]
  - @zhin.js/core@1.0.13

## 1.0.8

### Patch Changes

- c1a539e: fix: cli 优化,console 优化
- Updated dependencies [c8c3996]
  - @zhin.js/types@1.0.4
  - @zhin.js/core@1.0.10

## 1.0.7

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖
- Updated dependencies [c490260]
  - @zhin.js/client@1.0.5
  - @zhin.js/core@1.0.9
  - @zhin.js/host-router@1.0.6

## 1.0.6

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/types@1.0.3
  - @zhin.js/client@1.0.4
  - @zhin.js/core@1.0.8
  - @zhin.js/host-router@1.0.5

## 1.0.5

### Patch Changes

- 47845fb: fix: err
- Updated dependencies [47845fb]
  - @zhin.js/core@1.0.7

## 1.0.4

### Patch Changes

- c2d9047: fix: 重复插件 bug
- Updated dependencies [c2d9047]
- Updated dependencies [c2d9047]
- Updated dependencies [b213bbc]
  - @zhin.js/client@1.0.3
  - @zhin.js/core@1.0.6
  - @zhin.js/host-router@1.0.4

## 1.0.3

### Patch Changes

- 5e2bddc: fix: allow fs

## 1.0.2

### Patch Changes

- d291005: fix: 更新 cli,更新 http
- Updated dependencies [d291005]
  - @zhin.js/client@1.0.2
  - @zhin.js/host-router@1.0.2

## 1.0.1

### Patch Changes

- 727963c: fix: 修复 sqlite 数据错误;优化 console 展示
- Updated dependencies [727963c]
- Updated dependencies [89bc676]
  - @zhin.js/client@1.0.1
  - @zhin.js/types@1.0.2
  - @zhin.js/core@1.0.3
