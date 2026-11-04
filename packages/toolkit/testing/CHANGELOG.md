# @zhin.js/plugin-test-kit

## 1.0.7

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

## 1.0.6

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。

## 1.0.5

### Patch Changes

- 5be09ae: Stop installing a second Zhin stack next to the plugin's own `zhin.js` (#899). `@zhin.js/testing` no longer pins exact versions of `@zhin.js/core`, `@zhin.js/runtime`, `@zhin.js/plugin-runtime`, `@zhin.js/adapter` and the other `@zhin.js/*` packages. It resolves them through the plugin's `zhin.js` (`zhin.js`, `zhin.js/plugin-runtime`, `zhin.js/core/runtime`, `zhin.js/command`, …) and declares `zhin.js`, `@zhin.js/runtime` and `@zhin.js/tool` as peer dependencies. A standalone plugin with both `zhin.js` and `@zhin.js/testing` now installs every `@zhin.js/*` package once with pnpm and npm, so the Runtime no longer fails with `Multiple package locations … are not supported in one generation`, and tests run on the same stack as a real bot. `@zhin.js/command` is no longer a separate peer; it comes from `zhin.js`.

  Migration: pnpm and npm (7+) install the peers automatically, so nothing changes there. With a package manager that does not install peers (yarn 1, or pnpm with `auto-install-peers=false`), add them yourself: `yarn add -D zhin.js @zhin.js/runtime @zhin.js/tool @zhin.js/testing`. Upgrade `@zhin.js/testing` together with `zhin.js`: the kit requires a `zhin.js` at least as new as the one released with it, and with an older one npm stops with `ERESOLVE` while pnpm reports an unmet peer.

- c5741c0: `@zhin.js/command` 从 `dependencies` 改为 `peerDependencies`：测试工具使用插件自己（经 `zhin.js`）安装的那一份，独立插件不再装出第二份。pnpm / npm 会自动安装 peer，无需改动；yarn 1 等不自动安装 peer 的项目需要执行一次 `yarn add -D @zhin.js/command`。
- c5741c0: `runCommand(fake, definition, { source })`：传入命令的 `commands/.../index.ts`（路径或 `new URL(..., import.meta.url)`）时，先走运行时同一套约定路径校验（新导出的 `bindCommandSource`），`commands/term/[word]/[...definition]` 这类运行时会拒绝的布局在单测里也会报错；不传 `source` 行为不变。`zhin new` 生成的测试默认传 `source`。
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- b15c86b: `PluginTestKit` accepts a file-backed configuration (`createConfigDocument(path)`) as `config`, so tests share the same file authority as `zhin start` (saved vs applied config, `config:explain`, reload of the config file). Adds end-to-end smoke scenarios for literal-choice config forms, `config:explain` and structured replies.

  `@zhin.js/agent` evals gain a structured-reply seed case (mention + text segments) that the nightly real-model run replays under the existing request budget.

- 37dc280: `PluginTestKit` exposes `messageDiagnostics`, the same body-free reader the Console serves at `GET /api/messages/diagnostics`, so integration tests can assert route, dispatch status and delivery outcomes. Adds the first end-to-end smoke scenarios for the #829 loop (v1 → v2 migration, boot, diagnostics API, scenario-lab export).
- 8822cae: `PluginTestKit` exposes `snapshots`, the committed-snapshot authority Console routes read, so integration tests can mount real Console routes such as the task center. Adds end-to-end smoke scenarios for command admission, `welcomeConversations`, natural-time reminders with the task center, and RSS quiet hours on a fake clock.
- ec1dea1: `FakeClock.advance()` now moves the clock to each firing instant before running the jobs due at that instant, so a scheduled job that reads `clock.now()` sees the time it fired at instead of the time `advance()` started from.
- e9e10ce: `FakeClock.advance()` 在某个 cron 任务抛错时仍会把时钟停在目标时间（try/finally）；该窗口内剩余未执行的任务会被跳过而不是延后补跑，错误照常向上抛出。
- 6f05209: 新增 `runTool` / `createToolContext` / `toolOriginFromMessage`，可以在单元测试里运行 Agent 工具。执行方式与运行时的工具索引一致：可执行 `inputSchema` 先解析输入，绑定 `adapter` 的工具必须传匹配的 `client`。传 `message` 时，`origin` 和 `principal` 从假消息推导。

  **行为变化**：插件声明了 `config` schema 时，`runPluginSetup` 现在会像运行时一样校验 `config`、填充默认值，并且只保留 schema 顶层声明的字段。不合法时抛出 `PluginConfigValidationError`。新增 `resolvePluginConfig(definition, input)`。

  迁移：如果某个测试故意传了不合法或不完整的配置，先补齐配置；或者给这个测试加上 `runPluginSetup(plugin, { config, validateConfig: false })`，恢复原来"原样传入"的行为。没有声明 `config` 的插件，以及 `createFakePlugin` / `fake.setup()`，都不受影响。

  Added `runTool` / `createToolContext` / `toolOriginFromMessage` for unit-testing Agent tools. Behaviour change: when the plugin declares a `config` schema, `runPluginSetup` now validates and defaults `config` like the Runtime does (throws `PluginConfigValidationError`). To keep the old verbatim behaviour, pass `validateConfig: false`.

## 1.0.4

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [2b4d6dc]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [8550f17]
- Updated dependencies [7edd04c]
  - @zhin.js/command@1.1.8
  - @zhin.js/core@1.1.46
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/runtime@1.1.9
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/handler@1.1.6
  - @zhin.js/adapter@1.1.20
  - @zhin.js/middleware@1.1.7

## 1.0.3

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45
  - @zhin.js/runtime@1.1.8

## 1.0.2

### Patch Changes

- b947298: testing 新增类型化的假运行环境：`createFakePlugin` / `runPluginSetup` 提供真实 Scope 与内存版数据库、定时（可控时钟）、出站记录，`runCommand` / `runMiddleware` / `runHandler` 直接执行约定目录里的定义，`fakeOf` 取代 `as never`。activity-feedback 的测试已迁移。

  包名由 `@zhin.js/plugin-test-kit` 改为 `@zhin.js/testing`（目录 `packages/toolkit/testing`）。旧名 `@zhin.js/plugin-test-kit` 不再更新，请改用新包；API 与 `PluginTestKit` 类名不变。

- Updated dependencies [a64716a]
- Updated dependencies [0c35b96]
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/runtime@1.1.7
  - @zhin.js/adapter@1.1.19
  - @zhin.js/command@1.1.7
  - @zhin.js/core@1.1.44
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/handler@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/middleware@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.0.1

### Patch Changes

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [7d2263c]
- Updated dependencies [7d2263c]
- Updated dependencies [a62acca]
- Updated dependencies [386150d]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/core@1.1.43
  - @zhin.js/runtime@1.1.6
  - @zhin.js/plugin-runtime@1.1.13
