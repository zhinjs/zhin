# create-zhin-app

## 1.2.0

### Minor Changes

- c2bbdcf: 创建项目只问语言、项目名与初始化令牌（ADR 0053），数据库、适配器与 AI 等改到 Console 初始化向导里完成；原有命令行参数仍然生效，结束时打印带 Host 地址的 Console 链接。

  **迁移**：依赖交互式提问选择数据库、适配器或 AI 的脚本改用对应命令行参数（`--yes` 时按默认值），或在 Console 里完成。

### Patch Changes

- 57c6cdc: fix: 全仓审计修复

  - kernel: 模板求值沙箱不再泄漏宿主对象——宿主函数的返回值与抛出的错误会重新包裹代理（`segments.map(x=>x).constructor.constructor(...)` 之前可拿到宿主 `Function`），并禁止通过代理写入/删除宿主属性。
  - agent: exec 白名单正则按整体锚定（`git|npm` 不再匹配 `gitevil`）；SSRF 主机名黑名单识别尾点形式（`localhost.`）；Docker 沙箱 `always` 模式的 fail-closed 分支可被触达；声明缺失的 `chalk` 依赖。
  - ai: 摘要按最新优先加载（超过 500 条时不再使用过期锚点）；修复 `test` 脚本指向不存在的配置。
  - cli: `ZHIN_LOG_LEVEL` 生效（修复运算符优先级）；移除旧守护进程遗留的无引用进程辅助函数。
  - logger: `formatCompact` 不再把 `config: 'yaml'`、`direction: 'in'` 这类非路径值改写成 `./yaml`。
  - host-http: 未配置数据库时 `db:tables` 与有数据库时一致返回 `{ tables }`。
  - a2a: 405 响应把 `Allow` 放进响应头。
  - pagemanager: 内联进 `<script>` 的页面元数据转义 `<`。
  - client: 事件历史请求失败时携带 HTTP 状态，token 失效可触发重新登录。
  - scaffold-wizard / create-zhin-app: 修正适配器文档 URL 与模板里的 `@zhin.js/tool` 导入。
  - adapter-wechat-mp: 签名比较改为常量时间。
  - adapter-kook: 声明运行时依赖 `ws`。
  - plugin-lottery: 遗漏值按最近一次出现计算；推送目标 schema 字段与实现一致（`endpointKey`）。
  - plugin-code-runner: 语言校验改用自有属性判断。
  - plugin-link-poster: 抓取前校验主机名白名单（修复 SSRF），超时覆盖响应体读取。
  - 其余包：从 `files` 中移除不存在的目录。
  - feature-kit / middleware: 修正 README 中层级错误的文档链接。

- e1fda87: fix: 按审计待审清单处理（安全、功能、清理）

  **行为变更（升级前请阅读）**

  - kernel / core / zhin.js：出站文本中的 `${…}` 不再用 `vm` 求值，只替换 `TemplateContext` 上能解析到值的属性路径（如 `${sender.name}`）；表达式、函数调用、未知名字原样保留。整套 vm 沙箱（`evaluate` / `execute` / `compiler` / `getValueWithRuntime`）已移除。
  - kernel / core / zhin.js：移除零引用的遗留导出——`Scheduler`、错误管理器与 `ZhinError` 子类、`compose`、`segment.from/toString`、AI 触发/准入函数、`@zhin.js/core/queue-im-field-contract`、`zhin.js/contexts`。
  - agent：readonly 执行预设不再放行重定向、后台 `&`、进程替换、`find -delete/-exec`、`sed -i`、`sort -o`、`tee`、`xargs`、awk；curl/wget 校验每个 URL 与裸主机并识别更多上传参数；自定义 `execAllowlist` 中的只读命令带写入风险时改走审批。沙箱超时/取消会杀掉进程组或具名容器，默认镜像改为 `node:22-bookworm-slim` + `bash`。移除无生产调用的 `AuditLogger`、`AnomalyDetector`、旧 vision 回合等导出。
  - ai：移除 `storage`、`FileStateCache`、`CostTracker`、`model-name-utils`、`./agent-step-checkpoint` 子路径、`ContextManager` 及旧压缩管线；延迟工具快照改为有界 LRU。
  - cli：`zhin send` / `watch` / `schedule` 改为与运行中的 Host 通信（新增 `POST /message/send` 与 `/assistant/jobs` 写接口），`schedule` 不再支持离线改文件；移除 `zhin uninstall service`（用 `zhin service uninstall`）、`build --analyze`、`install -S`；`zhin stop` 杀不掉进程时保留 pid 文件并以非零退出；`runtime migrate` 新增 `verify`；未设置 `TZ` 时调度默认时区改为系统时区；不带 `ZHIN_SUPERVISOR_PID` 的进程被 init 接管后不再自行退出。
  - schedule：后台 reconcile 出错不再产生未处理 rejection（新增 `onStoreError`）；启动途中 `stop()` 不再遗留定时器。
  - schema：元组校验与 `safeParse`、JSON Schema 一致（空数组不通过，缺省的可选元组为 `undefined`）。
  - client / contract：删除无后端路由的 agent-stream API、未使用的 `definePage` 与旧 PageManager 类型；`@zhin.js/contract` 不再依赖 `@zhin.js/ai`；客户端收到 401 会清除已保存的凭据；安装/更新/卸载 RPC 默认超时 120 秒。
  - a2a：流式响应中途出错写入 SSE error 并结束；未配置 token 的非生产环境只接受本机请求；任务存储有上限与过期；Mailbox 凭据回退与生产环境缺密钥检查修复。
  - speech：`provider: openai` 不再套用 Ollama 的默认 host/model；识别语言改为可配置，不再写死 `zh`。
  - adapter-lark：支持 `encryptKey` 加密事件解密。adapter-github：Device Flow 可取消、带超时并回复失败原因。adapter-wecom / dingtalk：请求加超时并校验 HTTP 状态。adapter-weixin-ilink：输入关闭期间暂停轮询。adapter-milky：SSE 支持 CRLF、缓冲上限与空闲重连。adapter-onebot-events：好友删除通知改为 `notice.friend.decrease`。
  - plugin-group-suite：`teachAllowRegex` 默认关闭，正则安全检查更严格。plugin-qrcode：改为本地生成，回复 data URL 图片。plugin-rss / short-url / link-poster：拒绝解析到内网的地址；rss 修复条目每周重复推送；short-url 的 Console 创建改为真实调用 is.gd。plugin-lottery：按 `historyLimit` 同步。

  **其余**

  - host-http：插件市场详情加缓存与包名校验，SSE 回放容忍背压。host-http-contract：新增 `readTextBody()`，九个适配器改用它。
  - pagemanager：页面外壳 importmap 升级到 React 19.2.8 / react-router 7.12.0。console-contract：`definePage` 接受 `description` / `group` / `parent` / `fullWidth`。
  - command：进度提示本地化，匹配不再重复拷贝消息段。runtime：源码监听降级后退避重试原生监听。
  - html-renderer：删除未接线的 `aiTextAsImage`。create-zhin-app / scaffold-wizard：移除不起作用的"全局安装 CLI"与运行时选择提示。
  - 依赖声明清理、发布清单不再携带解析不到的 `src` 目录、移除未使用的 Skill 挂载、README 与示例配置按当前实现更正。

- cc7a5f9: 常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

  - gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
  - console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
  - cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
  - zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
  - runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。

- 518cd79: README 更新为 `zhin start` 网关启动模型与 Console 初始化流程（修正 zhin.js README 中的端口为 8068），新增网关升级指南链接。
- 5cd9d3d: 引导服务核心（ADR 0053，B2）

  - gateway：新增 `@zhin.js/gateway/onboarding`——引导状态（`.zhin/onboarding.json`，原子写入，自动识别已配置的数据库、适配器、AI 与所有者）、`OnboardingService`（`status` / `markStep` / `complete`）、按 scaffold-wizard 目录生成的安装白名单、`authorizeInstall`（无所有者时只允许装数据库驱动，之后需要 `plugin.manage`；包名 / 版本 / dist-tag 严格校验），以及经依赖事务安装、流式输出事件、失败回滚。
  - cli：`zhin setup` 新增非交互参数 `--adapter`（可重复）、`--enable-ai`、`--skip-ai`、`--skip-adapters`、`--install`、`-y`，记录引导步骤并与 Console 走同一安装服务；`zhin console init` 记录第 1–2 步。
  - scaffold-wizard / create-zhin-app：共用 `buildDefaultAdapterSetup`；可以只启用 AI 而暂不配置模型 Provider。

- f8bf684: 新项目把 `zhin.js`、`@zhin.js/cli` 与 `@zhin.js/gateway` 同批写进 `dependencies`（CLI 不再放在 `devDependencies`）：`zhin start` 在生产环境同样需要 CLI 与网关，`pnpm install --prod` 后也能启动，锁文件把三者固定在同一批版本（ADR 0054 §0）。
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [120e225]
- Updated dependencies [cc7a5f9]
- Updated dependencies [5cd9d3d]
- Updated dependencies [0e35afd]
- Updated dependencies [f8bf684]
  - @zhin.js/scaffold-wizard@1.1.19

## 1.1.19

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
  - @zhin.js/scaffold-wizard@1.1.18

## 1.1.18

### Patch Changes

- Updated dependencies [008ccad]
  - @zhin.js/scaffold-wizard@1.1.17

## 1.1.17

### Patch Changes

- 72b5a12: Improve plugin authoring DX, operator/CLI onboarding, IM/AI chat UX, CI reliability, and documentation narrative across the workspace:

  - **Plugin Authoring DX**:
    - Compare `mtimeMs` between `src/*.ts` and compiled `lib/*.js` in native TypeScript development runtime so stale `lib/` build outputs never shadow newer source edits.
    - Support `@zhin.js/schema` `Schema.object()` directly in `defineAgentTool` (`inputSchema`) with full TypeScript type inference and default value population.
    - Allow equivalent `definePlugin({ config })` and `schema.json` to coexist without throwing `PluginConfigSourceConflictError`.
    - Add `.withConfig<TConfig>()` helpers to `defineMiddleware`, `defineHandler`, `defineComponent`, `defineSchedule`, and `defineMcp`, and expose `has(token)` on `CapabilityContext`.
    - Enhance `@zhin.js/testing` with `createFakeInteraction`, automatic positional/option default parsing in `runCommand`, and `$sendTo` / `$replyTo*` helpers on `FakeMessage`.
  - **CLI, Wizard & Local Sandbox UX**:
    - Automatically seed `ai.plan.yml` into the Host database on first startup when the inference graph is empty.
    - Add domestic and aggregator AI provider presets (`qwen` / DashScope, `siliconflow`, `volcengine`, `minimax`, `openrouter`) and automatic capability pre-filling in `@zhin.js/scaffold-wizard`.
    - Add `/sandbox?token=...` query bootstrap and header token input UI for zero-DevTools local sandbox debugging, plus `zhin start` alias and unset `${ENV_VAR}` config warnings.
  - **IM Command, Interactive Fallback & AI Chat UX**:
    - Reset per-conversation fallback button numbering once previous interactive prompts finish and ignore TTL-expired bare numeric messages in group chats.
    - Deduplicate numbered option lists in text-fallback `user-interaction` prompts.
    - Support out-of-the-box `菜单` / `帮助` / `help` / `menu` aliases, flattened root command menus (when ≤ 8 commands), `-h` help flag, distinct missing-parameter diagnostics, and `@Bot /cmd` mention stripping in group chats.
    - Preserve `<header>` / `<footer>` in HTML text fallback, format Markdown tables cleanly in plain-text fallback, bind tool approval prompts to master senders, and lower turn progress feedback interval to 15s.

- aa41889: Upgrade official business plugins with declarative Console pages & AI skills/tools, decompose core monolith modules, and polish scaffolding DX:

  - **Official Plugin Ecosystem Upgrade**: Add declarative Console pages (`pages/index/index.ts`), `definePluginConsoleRpc` handlers (`src/console.ts`), and progressive-disclosure AI skills/tools (`skills/<name>/tools/`) across `@zhin.js/plugin-ledger`, `@zhin.js/plugin-reminder`, `@zhin.js/plugin-rss`, `@zhin.js/plugin-calendar`, `@zhin.js/plugin-group-suite`, `@zhin.js/plugin-content-moderation`, `@zhin.js/process-monitor`, and `@zhin.js/plugin-game-hub`.
  - **Core Monolith Decomposition**: Decompose 9 core monolith modules (`agent-core-run.ts`, `full-agent-turn-engine.ts`, `ingress-route.ts`, `request.ts`, `root-runtime.ts`, `account-runtime.ts`, `page-renderer.ts`, `console-rpc.ts`, and `console-rest-pages.ts`) into cohesive, acyclic submodules (`< 620` lines each) while preserving 100% of public exports.
  - **Scaffolding & First-Screen DX**: Upgrade `create-zhin-app` and `@zhin.js/scaffold-wizard` to generate declarative `ConsolePageBlueprint` homepages and `definePluginConsoleRpc` status/ping endpoints in both `zh-CN` and `en`; upgrade `zhin new` (`@zhin.js/cli`) to include `pages/` and compile progressive-disclosure tools under `skills/**/tools/` and `agents/**/tools/`.

- Updated dependencies [72b5a12]
- Updated dependencies [aa41889]
  - @zhin.js/scaffold-wizard@1.1.16

## 1.1.16

### Patch Changes

- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [0315ba0]
  - @zhin.js/scaffold-wizard@1.1.15

## 1.1.15

### Patch Changes

- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- Updated dependencies [af8f803]
  - @zhin.js/scaffold-wizard@1.1.14

## 1.1.14

### Patch Changes

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
  - @zhin.js/scaffold-wizard@1.1.13

## 1.1.13

### Patch Changes

- 88c82d0: ADR 0042 W4: bootstrap section scopes. A section of `AGENTS.md` / `SOUL.md` / `TOOLS.md` can carry `<!-- scope: group -->` (also `private`, `channel`, `master`, `master-private`, comma lists) on the line under its heading; the host injects only the sections matching the turn's scene (conversation type + master or not), byte-stable per scene kind. Unannotated sections apply everywhere. `zhin trace` lists skipped section titles (`bootstrap_skipped`).
  - @zhin.js/scaffold-wizard@1.1.12

## 1.1.12

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- Updated dependencies [53bc6a0]
  - @zhin.js/scaffold-wizard@1.1.11

## 1.1.11

### Patch Changes

- Updated dependencies [0dd657d]
  - @zhin.js/scaffold-wizard@1.1.10

## 1.1.10

### Patch Changes

- @zhin.js/scaffold-wizard@1.1.9

## 1.1.9

### Patch Changes

- @zhin.js/scaffold-wizard@1.1.8

## 1.1.8

### Patch Changes

- 8302701: Stop printing the full HTTP token when a project is created. The summary now shows a masked value with its length and points to `HTTP_TOKEN` in the project `.env`, so the token no longer ends up in CI logs.
- f974c91: 新建项目写入真实依赖版本范围（如 `zhin.js: ^1.1.11`），不再写 `latest`：范围在 scaffold-wizard 打包时由 `prepack` 从工作区版本生成，AI 栈第三方包沿用 Zhin 自身 peer 范围；拿不到版本的依赖仍保留 `latest`。doctor / config check 诊断基线不变。
- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

- Updated dependencies [f974c91]
- Updated dependencies [90057de]
- Updated dependencies [33fa6d3]
  - @zhin.js/scaffold-wizard@1.1.7

## 1.1.7

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [9816c18]
  - @zhin.js/scaffold-wizard@1.1.6

## 1.1.6

### Patch Changes

- 0c35b96: `zhin doctor` 的端口占用提示不再建议 `kill -9`，改为正常停止或 SIGTERM；缺少 `@zhin.js/tool` 时报错直接给出 `pnpm add @zhin.js/tool`；脚手架生成的 `.gitignore` 加入 `.zhin/`。
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- ec526ae: 独立插件的官方创建入口统一为 `zhin new <name> --standalone`（外部插件作者用 `npx @zhin.js/cli new my-plugin --standalone`，在当前目录生成 `./<name>/`，不依赖也不修改 Bot 项目；Bot 项目内的本地插件继续用 `zhin new <name>`）。已删除 `zhin runtime init` 和 `zhin runtime create`（及导出的 `ProjectScaffolder`）：新建插件请改用 `zhin new`，新建项目用 `npm create zhin-app`。`create-zhin-app` 完成提示里 404 的“写插件”链接改为有效页面，插件开发提示改为 `zhin new`。
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/scaffold-wizard@1.1.5

## 1.1.5

### Patch Changes

- @zhin.js/scaffold-wizard@1.1.4

## 1.1.4

### Patch Changes

- 5ab6307: 修正 JSX 的默认语义为消息排版：内置小写标签无需导入并提供属性类型，标签与属性映射为 Segment；只有显式 html / Html 子树序列化为 HTML。支持注册组件标签、原生 share 与平台 card，以及 Button onClick 回跳与返回值自动回复；同步脚手架、示例和文档。

  运行实例统一分配递增、不重复的按钮降级编号，会话交错发送时允许跳号，回调有效期为一小时，发送确认前的点击可正常执行；等待文字输入不会吞掉 JSX 按钮事件。修复 Card 原生 key 载荷、带 MIME 参数的图片 data URI、注册组件递归深度和媒体/HTML 类型约束。原有裸 HTML 布局需要显式包裹 `<html>` / `<Html>`。

## 1.1.3

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
- Updated dependencies [b36452a]
  - @zhin.js/scaffold-wizard@1.1.3

## 1.1.2

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- a417170: Fix MySQL, PostgreSQL, MongoDB, and Redis behavior found by live database integration tests, including deterministic table initialization on single database connections. Generate endpoint IDs consistently, emit pnpm 11 workspace build permissions from new projects, and report the selected AI session database accurately during initialization.
- 7a65d32: Load server TSX features through the active process loader or the CLI's scoped fallback loader, preserve explicit loaders across supervised restarts, and scaffold the JSX compiler settings advertised by the feature conventions.
- Updated dependencies [36c2eb9]
- Updated dependencies [a417170]
  - @zhin.js/scaffold-wizard@1.1.2

## 1.1.1

### Patch Changes

- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- 6b70e46: Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
- 65d0391: Make the instance-keyed `zhin.config.*#plugins` map a shared Plugin Runtime contract. Runtime startup helpers, Console configuration, onboarding, setup, install/uninstall, dependency diagnosis, and scaffolding now reject legacy package-name arrays instead of ignoring or promoting them; only the explicit migration pipeline reads that old shape. Remove the legacy `normalizePluginsMap` authoring API and dead create-project configuration reader, then add a repository gate that prevents compatibility branches from returning to normal configuration paths.
- 2fd8017: Make root `AGENTS.md` the main Agent contract and `agents/<name>/agent.json` plus `system.md`, `boundaries.md`, and `conventions.md` the only named sub-agent authoring shape. Standardize Agent and Skill private Tools, Skills, and Hooks as nested named directories, enforce access predicates and governed Tool activation, and keep supporting-file changes on Agent Slot hot reloads.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- 0724ddd: Define one Root configuration file contract across Runtime, CLI, Console, and scaffolding. Root projects now accept the documented YAML and JSON filenames, reject multiple configuration authorities, preserve JSON when edited through Console, and no longer expose TOML or TypeScript formats that Runtime cannot load.
- Updated dependencies [25a845a]
- Updated dependencies [6b70e46]
- Updated dependencies [65d0391]
- Updated dependencies [0724ddd]
  - @zhin.js/scaffold-wizard@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [a34bf91]
- Updated dependencies [1fc6270]
  - @zhin.js/scaffold-wizard@1.1.0

## 1.0.65

### Patch Changes

- f7ee28d: Fix generated Sandbox endpoint IDs and fallback configuration. Pin generated projects to pnpm 9, validate the Node 22.12+ runtime requirement before creating files, and support `--skip-install`. Validate packed candidate packages through clean installation, Sandbox messages, command hot reload and production restart.

## 1.0.64

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- Updated dependencies [54bfd6b]
  - @zhin.js/scaffold-wizard@0.2.6

## 1.0.63

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系

## 1.0.62

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/scaffold-wizard@0.2.5

## 1.0.61

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/scaffold-wizard@0.2.4

## 1.0.60

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/scaffold-wizard@0.2.3

## 1.0.59

### Patch Changes

- Updated dependencies [2a86259]
  - @zhin.js/scaffold-wizard@0.2.2

## 1.0.58

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- f0ec5ab: 五分钟首跑闭环（P1-2.1）。

  - `create-zhin-app`：依赖安装完成后自动运行项目内 `zhin doctor` 做安装后自检（Node 版本 / pnpm / 配置文件 / Console 登录条件 / 端口占用），自检失败不阻断创建流程。
  - `@zhin.js/cli`：`zhin runtime start` 启动成功后输出醒目的首跑指引（Remote Console 地址、Host `http://127.0.0.1:<port>`、token 在 `.env` 的 `HTTP_TOKEN`、Sandbox 页发送 hello），新增 `--open` / `ZHIN_OPEN=1` 自动打开浏览器（CI 与无显示环境自动跳过）；`zhin doctor` 的 pnpm 修复提示补充 corepack 方式、端口占用提示补充 `http.port` 换端口方案，AI 引导文件（SOUL/TOOLS/AGENTS）检查改为仅在启用 AI 时执行，避免 IM-only 首跑项目收到误导性警告。
  - `@zhin.js/core`：`MessageGateway` 接口新增 `setUnmatchedHandler`（此前仅 `ImRuntime` 实现类上有，Host AI 回退同款钩子），支撑单文件 bot 在无 `commands/` 约定目录时响应消息。
  - 新增 `examples/single-file-bot`：一个 `bot.ts` 即完整机器人（definePlugin + defineCommand + sandbox adapter），附 README 说明单文件与约定目录布局的取舍。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [3e925d0]
  - @zhin.js/scaffold-wizard@0.2.1

## 1.0.57

### Patch Changes

- Updated dependencies [713445c]
- Updated dependencies [15bbdb3]
- Updated dependencies [0356aa1]
  - @zhin.js/scaffold-wizard@0.2.0

## 1.0.56

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

- Updated dependencies [cc5c94d]
  - @zhin.js/scaffold-wizard@0.1.9

## 1.0.55

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
  - @zhin.js/scaffold-wizard@0.1.8

## 1.0.54

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
  - @zhin.js/scaffold-wizard@0.1.7

## 1.0.53

### Patch Changes

- b2c73bd: fix: 初始化项目后,安装依赖失败
- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [b2c73bd]
- Updated dependencies [c4575c9]
  - @zhin.js/scaffold-wizard@0.1.6

## 1.0.52

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身
- Updated dependencies [7dfafc2]
- Updated dependencies [ae5239c]
  - @zhin.js/scaffold-wizard@0.1.5

## 1.0.51

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [2ef4896]
  - @zhin.js/scaffold-wizard@0.1.4

## 1.0.50

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/scaffold-wizard@0.1.3

## 1.0.49

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
  - @zhin.js/scaffold-wizard@0.1.2

## 1.0.48

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/scaffold-wizard@0.1.1

## 1.0.47

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.0.46

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身
- fdd6653: fix: change inquire list => select

## 1.0.45

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题

## 1.0.44

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化

## 1.0.43

### Patch Changes

- f19d2e0: fix: remove multiple runtime support

## 1.0.42

### Patch Changes

- 775427e: fix: edge 支持

## 1.0.41

### Patch Changes

- 32049f5: fix: init publish

## 1.0.40

### Patch Changes

- 88caeb2: fix: ask user 护栏

## 1.0.39

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 1.0.38

### Patch Changes

- e28fd7c: fix: 重新发版

## 1.0.37

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.36

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.35

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation

## 1.0.34

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.33

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.32

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统

## 1.0.31

### Patch Changes

- 5f5127c: fix: web url 调整

## 1.0.30

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth

## 1.0.29

### Patch Changes

- 8502351: fix: token 优化

## 1.0.28

### Patch Changes

- 634e2d7: fix: ai 强化

## 1.0.27

### Patch Changes

- 48481a8: fix: @zhin.js/adapter-icqq 内置点赞工具
  fix: create-zhin-app 默认增加 send 指令
  fix: @zhin.js/cli 重命名 onborading 为 onborad 并重写实现,新增 zhin send 命令，用于直接通过 send 命令发送消息
  fix: @zhin.js/host-router 新增消息发送 api

## 1.0.26

### Patch Changes

- 1107f69: fix: sys service

## 1.0.25

### Patch Changes

- cca7815: fix: esm 兼容

## 1.0.24

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.23

### Patch Changes

- 2b44e18: fix: change version

## 1.0.22

### Patch Changes

- b27e633: fix: cli 优化

## 1.0.21

### Patch Changes

- 106d357: fix: ai

## 1.0.20

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.19

### Patch Changes

- 52ae08a: fix: 更新消息处理流程

## 1.0.18

### Patch Changes

- 26aba27: fix: error default config

## 1.0.17

### Patch Changes

- 7aa94b1: fix: 更新 create-bot

## 1.0.16

### Patch Changes

- f9faa1d: fix: test release

## 1.0.15

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.14

### Patch Changes

- cda76be: fix: add adapters

## 1.0.13

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持

## 1.0.12

### Patch Changes

- a86424e: fix: 增加 sqlite3 构建提示

## 1.0.11

### Patch Changes

- c1a539e: fix: cli 优化,console 优化

## 1.0.10

### Patch Changes

- 27eb109: fix: 模板项目增加 web 示例

## 1.0.9

### Patch Changes

- 59c84ba: fix: 优化 http 插件配置

## 1.0.8

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.7

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.0.6

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/cli@1.0.5

## 1.0.5

### Patch Changes

- Updated dependencies [d291005]
  - @zhin.js/cli@1.0.4

## 1.0.4

### Patch Changes

- 15be776: fix: 修改 cli 错误,增加 permit

## 1.0.3

### Patch Changes

- Updated dependencies [ffa9cbc]
  - @zhin.js/cli@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [15fc934]
- Updated dependencies [ebf852c]
- Updated dependencies [cd8c8a8]
  - @zhin.js/cli@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/cli@1.0.1
