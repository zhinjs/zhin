# @zhin.js/plugin-calendar

## 0.1.15

### Patch Changes

- 8adce16: fix: post-refactor audit fixes across runtime, console blueprints, AI setup, and plugin stores

  - **Agent & Runtime**: adapt `DatabaseHost` models for `DatabaseEngagementJournal` after `DatabaseHost.start()` (`this[#db].select is not a function`), suppress deferred database warning in `seedInitialAiPlanIfEmpty`, lazy-load `@zhin.js/agent/runtime` in `agent-console.ts`, wrap `#receiveSideEvent` with `withEndpointEventPayload` and `captureInteraction`, select only `('id', 'timestamp')` in `SystemLogDatabaseTransport.prune()`, and surface clear install errors when optional AI/protocol packages are absent.
  - **Console Blueprints & RPC**: bundle `.ts` blueprint page entries via `esbuild` in `TypeScriptClientBuilder` so `spec`, `fields`, `dictionary`, `pollMs`, and `reviewSpec` are preserved in browser bundles; wire `CommentReviewSession` in `DeclarativePageView`; authorize `zhin.game` / `zhin.feature.game` in `plugin-console-rpc.ts`; forward `locale` in `entry-routes.ts`; pass `pluginId: entry.owner ?? entry.id` in `loadConsoleEntries.ts`.
  - **Plugin Store & Capabilities**: make `deriveStoreDisposer` idempotent in `@zhin.js/plugin-runtime`, guard nullish `carrier.resources`, handle `{ dispose }` return shapes in isolate `bootstrap.ts`, remove duplicate manual disposals in `answers`/`earthquake`, guard optional `projectLocaleToken` in `calendar`/`reminder`/`rss`/`lottery`, migrate `process-monitor` to `definePluginStore`, and align `capabilityGraph` declarations across plugins.
  - **Architectural Enhancements**:
    1. **Model Capability Baseline Catalog + Override Layer** (`@zhin.js/ai`, `@zhin.js/scaffold-wizard`, `@zhin.js/cli`): add `MODEL_CAPABILITY_CATALOG`, `inferModelCapabilities`, and `applyModelCapabilityDefaults` so built-in models carry accurate `input`/`streaming`/`toolCalling`/`thinking` baselines while preserving explicit `provider.capabilities` overrides.
    2. **Zero-Bundler Declarative Blueprint Protocol** (`@zhin.js/console-contract`, `@zhin.js/client`, `@zhin.js/pagemanager`): add JSON-serializable `DeclarativeValueExpr` operators (`$path`, `$count`, `$sum`, `$format`, `$map`, `$join`, `$coalesce`) evaluated identically across Web, IM Card, and CLI Panel projections, plus in-process `ts.transpileModule` synthesis (`synthesizePureBlueprintModule`) in `TypeScriptClientBuilder`.
    3. **Auto CapabilityGraph Convention Merge & Codegen** (`@zhin.js/plugin-runtime`, `@zhin.js/runtime`, `@zhin.js/cli`): add `mergePluginCapabilityGraph`, `scanConventionCapabilityFeatures` (auto-merged during `PluginScopeAssembler.setupTree`), and `zhin runtime codegen [dir] --write --json`.
    4. **Durable Turn Step Checkpointing** (`@zhin.js/agent`): add `TurnCheckpointStore` and `DatabaseTurnCheckpointStorage` (`agent_turn_checkpoints`) so multi-step tool turns interrupted mid-flight record completed `(assistant[toolCall] -> toolResult[])` rounds and resume from the last committed `toolResult` boundary on retry or `"继续"`/`"continue"`.
  - **UI Component System & Developer Preview Workbench** (`@zhin.js/client`, `@zhin.js/components`, `@zhin.js/cli`, `create-zhin-app`):
    - Expand `@zhin.js/client/ui` and `@zhin.js/components` with unified design tokens (`UI_DESIGN_TOKENS`), option icons (`RadioGroup`/`CheckboxGroup`), custom chart images/logos (`BarChart`/`Sparkline`/`DonutChart`/`GaugeBar`), batch table selection & sticky columns (`DataTable`), responsive viewport presets (`CardCanvas`), and shared layout/display primitives.
    - Add `zhin preview [dir]` command in `@zhin.js/cli` (and `"preview": "zhin preview"` in `create-zhin-app`) for zero-build live SSE component & page blueprint previewing, interactive `previewProps` JSON editing, canvas width/background presets, and box-model outline debugging.
  - **IM Chat Controlled Restart & Post-Restart Channel Receipt** (`@zhin.js/cli`):
    - Add `installRestartHost` (`restart` / `重启` / `reboot` command for Bot owners) and `deliverPendingRestartReceipt` so owners can trigger a supervised process restart from any IM conversation and automatically receive the restart completion summary in the originating channel once the endpoint reconnects.
    - Ignore `SIGHUP` in `NativeTypeScriptSupervisor` when running in `--daemon` mode.

- Updated dependencies [8adce16]
  - @zhin.js/console-contract@1.1.5
  - @zhin.js/host-http@1.1.17
  - @zhin.js/page@1.1.17
  - @zhin.js/skill@1.1.16
  - @zhin.js/tool@1.1.18

## 0.1.14

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
- 5419b88: Add generation-scoped `definePluginStore` (`PluginStore`), `Scope.get()`, declarative `PluginSetupCapabilities` return in `definePlugin()`, and `JsonSerializable<T>` typing on `PluginStateStore` to eliminate `as never` casts on TypeScript interfaces.
- Updated dependencies [cbf1fb1]
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/console-contract@1.1.4
  - @zhin.js/page@1.1.16
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/host-http@1.1.16
  - @zhin.js/tool@1.1.17
  - @zhin.js/skill@1.1.15

## 0.1.13

### Patch Changes

- aa41889: Upgrade official business plugins with declarative Console pages & AI skills/tools, decompose core monolith modules, and polish scaffolding DX:

  - **Official Plugin Ecosystem Upgrade**: Add declarative Console pages (`pages/index/index.ts`), `definePluginConsoleRpc` handlers (`src/console.ts`), and progressive-disclosure AI skills/tools (`skills/<name>/tools/`) across `@zhin.js/plugin-ledger`, `@zhin.js/plugin-reminder`, `@zhin.js/plugin-rss`, `@zhin.js/plugin-calendar`, `@zhin.js/plugin-group-suite`, `@zhin.js/plugin-content-moderation`, `@zhin.js/process-monitor`, and `@zhin.js/plugin-game-hub`.
  - **Core Monolith Decomposition**: Decompose 9 core monolith modules (`agent-core-run.ts`, `full-agent-turn-engine.ts`, `ingress-route.ts`, `request.ts`, `root-runtime.ts`, `account-runtime.ts`, `page-renderer.ts`, `console-rpc.ts`, and `console-rest-pages.ts`) into cohesive, acyclic submodules (`< 620` lines each) while preserving 100% of public exports.
  - **Scaffolding & First-Screen DX**: Upgrade `create-zhin-app` and `@zhin.js/scaffold-wizard` to generate declarative `ConsolePageBlueprint` homepages and `definePluginConsoleRpc` status/ping endpoints in both `zh-CN` and `en`; upgrade `zhin new` (`@zhin.js/cli`) to include `pages/` and compile progressive-disclosure tools under `skills/**/tools/` and `agents/**/tools/`.

- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
- Updated dependencies [aa41889]
- Updated dependencies [4427e72]
- Updated dependencies [22bd14a]
  - @zhin.js/client@1.1.25
  - @zhin.js/page@1.1.15
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/host-http@1.1.15
  - @zhin.js/tool@1.1.16
  - @zhin.js/skill@1.1.14

## 0.1.12

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [bd524d1]
- Updated dependencies [126ae99]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
- Updated dependencies [00be764]
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/tool@1.1.15
  - @zhin.js/skill@1.1.13
  - @zhin.js/host-http@1.1.14

## 0.1.11

### Patch Changes

- Updated dependencies [c15cef9]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/tool@1.1.14
  - @zhin.js/host-http@1.1.13
  - @zhin.js/skill@1.1.12

## 0.1.10

### Patch Changes

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/host-http@1.1.12
  - @zhin.js/skill@1.1.11
  - @zhin.js/tool@1.1.13

## 0.1.9

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/tool@1.1.12

## 0.1.8

### Patch Changes

- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [1ca669a]
- Updated dependencies [4f96ad5]
  - @zhin.js/tool@1.1.11
  - @zhin.js/host-http@1.1.11
  - @zhin.js/im-contract@1.1.8

## 0.1.7

### Patch Changes

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- Updated dependencies [f3b7c9f]
- Updated dependencies [658a5fb]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/host-http@1.1.10
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/tool@1.1.9
  - @zhin.js/host-http@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.5

### Patch Changes

- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [fbfefb7]
  - @zhin.js/tool@1.1.8
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/skill@1.1.8
  - @zhin.js/host-http@1.1.8

## 0.1.4

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- 8550f17: 补齐 Host 配置字段定义与未配置区块入口，完整投影对象、字典、联合、元组和本地引用，避免 Console 丢字段或整份退回源码。原始 Runtime Schema 继续负责校验。日历、提醒、复读和短链接发布静态配置定义，禁用时也可安全配置，无需执行插件代码。
- Updated dependencies [2b4d6dc]
  - @zhin.js/host-http@1.1.7
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 0.1.3

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/host-http@1.1.6
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6

## 0.1.2

### Patch Changes

- a3a7b53: Authorize Google / Outlook calendars from chat: master-only `calendar auth|status|logout` commands, OAuth callback route on the zhin HTTP host, refresh tokens stored in the plugin database (env `refresh_token` stays as fallback), clear re-auth prompts and a one-time notification on `invalid_grant`. The auth CLI ships as the optional `zhin-calendar-auth` bin.
- a3a7b53: Add `@zhin.js/plugin-calendar` with CalDAV / Google / Microsoft backends and Agent tools `list_events`, `find_free_time`, `create_event` plus skill `calendar-scheduling`.
- a3a7b53: Google/Microsoft calendar OAuth refresh_token flow, token manager, and auth CLI.
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/host-http@1.1.5
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5
