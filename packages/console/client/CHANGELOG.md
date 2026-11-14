# @zhin.js/client

## 1.1.34

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [f2fa3d7]
- Updated dependencies [ac72706]
- Updated dependencies [b2aae3c]
  - @zhin.js/console-protocol@1.2.2
  - @zhin.js/contract@1.1.25

## 1.1.33

### Patch Changes

- 7fb1ee7: Console 的插件全局开关改由管理网关作为启停事务执行（ADR 0054 §4）：网关在转发前拦截 `plugin:set-enabled` 与 `level: 'global'` 的 `feature.set-enabled`，按 `plugin.manage` 授权，执行与 `gateway.plugins.enable` / `disable` 相同的事务（停实例 → 写 `disable_plugins` → 启实例，失败回滚），并用两者原有的回复形状作答（另带 `transaction`；失败时为 `transaction_failed` / `rollback_failed` 错误信封）；成功变更后在事件流补发 `plugin:lifecycle-updated`。权限表中 `plugin:set-enabled` 改为 `plugin.manage`，`feature.set-enabled` 的全局层细化为 `plugin.manage`（其余层仍是 `feature.toggle`），新增 `isGlobalFeatureSwitch` / `FEATURE_GLOBAL_SWITCH_PERMISSION`。实例不再写全局开关：`plugin:set-enabled` 与 Console 路径上的全局 `feature.set-enabled`（409 `gateway-required`）一律拒绝，`--standalone` 下请用 `zhin enable` / `zhin disable`；`RuntimeConsoleRpcContext.setPluginEnabled` 已移除。`@zhin.js/client` 的 `setPluginEnabled` 改用依赖事务的可续期超时。聊天命令的全局开关暂不变。
- Updated dependencies [cfa3dbf]
- Updated dependencies [7fb1ee7]
  - @zhin.js/console-protocol@1.2.1
  - @zhin.js/contract@1.1.24

## 1.1.32

### Patch Changes

- 540a7f2: `AdapterConsolePage` 新增嵌入模式，供宿主页面（例如 Console 的适配器概览）把它放进自己的页面：`embedded` 不再渲染 SDK 页头（标题、标识、说明与「刷新」），也去掉页面内边距与宽度上限；`toolbar` 把页面动作（文档链接、添加账号的开关与禁用状态、刷新）交给宿主用自己的按钮渲染，不传时显示 SDK 自带的「文档」「添加」；`refreshKey` 变化时重读状态、连接与登录待办，供宿主的「刷新」按钮驱动。宿主可读 `AdapterConsolePage.capabilities` 或 `ADAPTER_CONSOLE_PAGE_CAPABILITIES` 判断支持情况；不传这些属性时页面与之前完全相同。
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

- c2bbdcf: 页面元数据新增可选 `section`（`overview` / `conversations` / `features` / `plugins` / `ops` / `access`，ADR 0052），声明页面在 Console 导航里属于哪个分区；`definePage` 校验取值，Host 的 `/entries` 与客户端 `resolveEntryRegister` 把它透传到路由 `meta.section`，未知值被丢弃。
- 5120367: `schema:get` 支持按包名读取已安装但未声明插件的 Schema（返回 `declared: false`；以最新配置复核，经本地路径或别名已声明同一包的视为已声明）；`gateway.plugins.declare` 校验失败时返回结构化 `errors`（`path` / `message`）与 `missingEnv`，事务内复核失败时同样写入事务结果，提示文字保持不变。`@zhin.js/client` 的 `ConsoleTransportError` 新增 `details`（`serverCode`、`errors`、`missingEnv`）。
- fd055d2: 修复依赖安全告警：传递依赖 zod 升到 4.6.7 以上、@hono/node-server 升到 2.1.7 以上、qs 升到 6.16.1 以上（经 MCP SDK 引入），rimraf 升到 6.1.4（随之使用已修复的 glob），开发工具链的 minimatch 升到 11.x；新建插件模板的 rimraf 范围同步更新。
- f8bf684: 插件的安装、更新、卸载只走网关依赖事务 `gateway.packages.install | update | uninstall`（先停实例、失败回滚、需要配置的插件只装不声明）。删除实例内直接运行包管理器的 `plugin:install` / `plugin:update` / `plugin:uninstall` RPC 及其权限登记（`PLUGIN_RPC.INSTALL|UPDATE|UNINSTALL` 不再导出），实例只保留只读的 `plugin:plan-*`。`@zhin.js/client` 的 `installPlugin(packages, request?, options?)` / `updatePlugin(name, version, request?, options?)` / `uninstallPlugin(packages, request?, options?)` 改为调用网关 RPC，返回 `GatewayPackageTransactionResult`（`ok`、`status`、`needsConfiguration`、`errors`、`missingEnv`、`logTail`），不再接受 `expectedRevision`；新增 `planPackages()`（`gateway.packages.plan`），包事务默认超时改为 300 秒。

  网关转发失败的响应统一为 `GatewayInstanceErrorReply`：`503 instance_unavailable`（带 `Retry-After`）、`504 instance_timeout`、`502 instance_error`，都带 `requestOutcome`（`not-dispatched` / `unknown`）与实例 `state`；`GET /pub/health`（`GatewayHealth`）不缓存，可供 Console 在实例离线时轮询。

- e0bc008: 管理网关审查修复：

  - `zhin migrate`：旧的 `"start": "zhin start"`（或 `--daemon`）会改写为前台的 `zhin start --foreground --mode production --no-watch`——`zhin start` 现在默认后台，容器 / PM2 / systemd 会立即退出；迁移校验要求 `start` 带 `--foreground` 或使用 `zhin runtime start`。新增的 `@zhin.js/gateway` 版本按项目 CLI 的发布线推导（CLI 锁在旧发布线时用 `~主.次.0`），`^0.0.0` 占位不再被说成「dependencies 已声明」。
  - 本地控制套接字：`gateway.http.request` 走与 HTTP 相同的路由表（网关自有路由可达，`http.base: /` 正常），只取路径与查询，拒绝含 `\` 的路径与带 body 的 GET，事件流返回「改用 HTTP」；设置了 `ZHIN_CONSOLE_TOKEN` 时由网关按该令牌认证并以其主体执行与审计，`http.token` 不再经套接字发送。大小上限按 JSON 编码后的 UTF-8 字节计（中文不再触发协议错误），超限提示改用 HTTP。Windows 命名管道每次启动带随机名，CLI 校验 `.zhin/gateway.json` 中密钥的握手 HMAC。网关把实际端点（含 `os.tmpdir()` 回退路径）通过 `ZHIN_GATEWAY_SOCKET` 告诉实例，Agent 文件工具与 `bash` 拒绝触及它。
  - 开放 Host：地址未知的请求不再算本机（进程内调用需显式 `inProcess`）；`http.host` 非回环且既无 `http.token` 也无所有者时，网关拒绝启动并提示设置 `HTTP_TOKEN` 或 `zhin console init`。
  - `zhin doctor`：`HTTP_TOKEN` 按行读取（空值不再吞掉下一行），`change-me`、`zhin-local-token` 等弱值告警并可 `--fix` 替换，写入后 `.env` 为 `0600`。
  - `zhin console init`：先校验所有者用户名与密码，再切换数据库、写 `.env`。
  - 前台网关只在自己是终端前台作业时把标准输入交给实例，实例退出 / 崩溃后恢复终端设置；登录辅助提示改为整行输出，不再卡在按行转发里。
  - `gateway.readyTimeout` 在每次启动、重启实例与每笔依赖事务前重新读取，修改后无需重启网关。
  - Console 客户端：依赖事务回滚（`ok: false`）时安装 / 卸载 / 更新 hook 设置 `error`；事务请求的超时随 `gateway.packages.progress` 事件续期，实例启动阶段放宽到最长就绪等待，仍超时则报「结果未知，请核对」。

- Updated dependencies [1a5c569]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [5120367]
- Updated dependencies [fd22375]
- Updated dependencies [cc7a5f9]
- Updated dependencies [cc7a5f9]
- Updated dependencies [f8bf684]
- Updated dependencies [4e8ba38]
- Updated dependencies [c2bbdcf]
- Updated dependencies [5cd9d3d]
  - @zhin.js/console-protocol@1.2.0
  - @zhin.js/contract@1.1.23

## 1.1.31

### Patch Changes

- 0c62176: Upgrade Console UI optical elevation tokens (`--zk-shadow-sm/md/lg/xl` bridged to `--console-shadow-*`), frosted backdrop scrims and entrance transitions for `Modal` / `Drawer`, and interactive `BarChart` / `DonutChart` legend progress cards.

## 1.1.30

### Patch Changes

- 8ff7d44: Upgrade Adapter Console UI with Diana-inspired Bot Profile Tiles (`.zk-bot-grid` / `.zk-bot-tile`), elevated card surface tokens, mode-driven conditional form field filtering, human-first field labels, and deduplicated protocol pills.
- f948af1: feat(client): redesign AdapterConsolePage with Diana-grade Master-Detail (list ↔ edit) workflow, sticky onboarding guide sidebar, and unified 18px/12px aesthetic radii

## 1.1.29

### Patch Changes

- Redesign `AdapterConsolePage` and `@zhin.js/client/ui` with Diana-grade Master-Detail (`list` ↔ `edit`) page organization, 2-column form + sticky right onboarding guide sidebar, uniform `.zk-bot-tile` cards with top-right switch toggles and dashed `+ 新增平台账号` tile, grouped 2-column field blocks, and refined `18px`/`12px` card/control radii and soft shadows.

## 1.1.28

### Patch Changes

- 0d76a7c: Overhaul Console interactive workbenches, platform-specific adapter account onboarding/login flows, DeclarativePageView visual/interactive capabilities, and official utility plugin Console pages.

## 1.1.27

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
  - @zhin.js/contract@1.1.22

## 1.1.26

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
  - @zhin.js/contract@1.1.21

## 1.1.25

### Patch Changes

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
- fed2c27: Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

  - Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
  - Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
  - Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
  - Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.

- bc6ccb1: Deep audit bug fixes and 7 architectural improvements:
  - Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
  - Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
  - Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
  - Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
  - Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
  - Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
  - Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
  - Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
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

- 4427e72: 新增 `@zhin.js/client/ui` 插件页 UI 套件（Button/Badge/Notice/状态组件/ConfirmButton/Field、`usePluginRpc`、`useLocale`、`resolvePluginId` 与基于 Console 主题变量的样式），并用它重写通用适配器页：加载/失败/过期状态分离，原生 `confirm` 改为行内确认，按操作独立的忙碌状态，修复数据未到达时误显示“配置里还没有账号”的问题。
- 22bd14a: Add `createCommentReviewPage(spec)` (plus `ReviewResourceList` and the `CommentReviewSpec` / `ReviewContext` types): one shared comment-review Console page built only on the `@zhin.js/client/ui` kit, for adapters that draft replies for human approval. It resolves the PluginId, keeps the last good status as stale on refresh failure, sends discard through an inline `ConfirmButton`, keeps error notices until dismissed, and shows overflow as text ("超出 N 字"). The legacy `ac-*` review styles are removed from `adapterConsoleStyles`.
- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
  - @zhin.js/console-protocol@1.1.14
  - @zhin.js/contract@1.1.20

## 1.1.24

### Patch Changes

- cce07db: Refresh adapter Console pages with lightweight black/white/gray surfaces, clearer account and login workflows, responsive layouts, accessible focus states, and self-contained light/dark styling. Apply the shared visual language to Sandbox conversations and Bilibili comment review while preserving runtime authority and platform send paths.
- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [bd524d1]
- Updated dependencies [126ae99]
- Updated dependencies [4fe49b5]
  - @zhin.js/console-protocol@1.1.13
  - @zhin.js/contract@1.1.19

## 1.1.23

### Patch Changes

- f78eb84: fix(client): resolve adapter Console pages from npm `adapter-{key}/pages/` sources as well as workspace `adapters/{key}/pages/`, so qq/icqq/github pages stop showing "找不到页面所属插件" after install from registry.
  - @zhin.js/contract@1.1.18

## 1.1.22

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

  - @zhin.js/contract@1.1.17

## 1.1.21

### Patch Changes

- 6345a38: feat(adapters): add per-adapter Console pages

  Every platform adapter now ships a `pages/index` Console page backed by a shared
  `createAdapterConsolePage` component and `createAdapterConsoleRpc` server helper:

  - See running endpoints, test connectivity, and manage
    `plugins.<adapter>.endpoints` (add/remove writes `.env` references) from the
    Console instead of chat commands.
  - Surface LoginAssist pending tasks (QR / slider / SMS / device) so ICQQ login no
    longer requires the terminal.
  - QQ moves its QR binding flow (`qq endpoint add`) into Console actions with
    public/private selection.
  - Pages are permission-gated by `<adapter>:read`; writes need `<adapter>:write`.
  - @zhin.js/contract@1.1.16

## 1.1.20

### Patch Changes

- @zhin.js/contract@1.1.15

## 1.1.19

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- 658a5fb: Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
- af29996: 为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
- b8e594e: Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.
- Updated dependencies [f3b7c9f]
- Updated dependencies [af29996]
- Updated dependencies [b8e594e]
  - @zhin.js/console-protocol@1.1.12
  - @zhin.js/contract@1.1.14

## 1.1.18

### Patch Changes

- @zhin.js/contract@1.1.13

## 1.1.17

### Patch Changes

- @zhin.js/contract@1.1.12

## 1.1.16

### Patch Changes

- @zhin.js/contract@1.1.11

## 1.1.15

### Patch Changes

- f30be42: Stop publishing unit test files (`src/**/*.test.ts`, `client/**/*.test.ts`) in the npm tarball.
- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
  - @zhin.js/console-protocol@1.1.11
  - @zhin.js/contract@1.1.10

## 1.1.14

### Patch Changes

- Updated dependencies [7edd04c]
- Updated dependencies [2b4d6dc]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
  - @zhin.js/console-protocol@1.1.10
  - @zhin.js/contract@1.1.9

## 1.1.13

### Patch Changes

- @zhin.js/contract@1.1.8

## 1.1.12

### Patch Changes

- @zhin.js/contract@1.1.7

## 1.1.11

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/console-protocol@1.1.9
  - @zhin.js/contract@1.1.6

## 1.1.10

### Patch Changes

- b3fea8c: Agent turn traces are now persisted in `data/agent-traces/<day>.jsonl`, kept for 7 days with a 64 MB size cap (`ZHIN_TRACE_RETENTION_DAYS`, `ZHIN_TRACE_MAX_MB`), and redacted again when written. `zhin trace` can filter by session and time (`--sessions`, `--session`, `--since`, `--until`). A new read-only host API (`/api/agent/trace-archive/*`, full scope) backs the Console Agent Trace page (`TraceArchivePage`), which goes from sessions to turns to a turn detail with a waterfall and the raw record. Failing agent evals print a `zhin trace` command that opens the failing case's trace (#728).
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/console-protocol@1.1.8
  - @zhin.js/contract@1.1.5

## 1.1.9

### Patch Changes

- @zhin.js/contract@1.1.4

## 1.1.8

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/console-protocol@1.1.7
  - @zhin.js/contract@1.1.3

## 1.1.7

### Patch Changes

- 5b5d270: Complete the canonical share segment contract and preserve native ICQQ share delivery through Core and AI outbound pipelines.
  - @zhin.js/contract@1.1.2

## 1.1.6

### Patch Changes

- 244e475: Add a shared CLI and Console plugin-management transaction for install, update,
  uninstall, configuration validation, lifecycle control, diagnostics, Marketplace
  discovery, and Endpoint connectivity checks. Console mutations use revision checks,
  exact-version plans, post-operation verification, and recoverable manifest and
  lockfile snapshots.
- f474b1d: Replace the process-wide Console application, runtime environment, and WebSocket singleton with an explicitly created `ConsoleClient` that owns its application registry and REST/SSE transport. React transport hooks now resolve that owner through `ConsoleClientProvider`, and the obsolete `addPage` compatibility alias is removed from the plugin registration contract.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- baef56b: Require canonical dot-named Console RPCs with top-level camelCase request and response payloads, and remove legacy aliases and normalization paths.
- 507d602: Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
- Updated dependencies [244e475]
- Updated dependencies [f474b1d]
- Updated dependencies [baef56b]
- Updated dependencies [507d602]
  - @zhin.js/console-protocol@1.1.6
  - @zhin.js/contract@1.1.1

## 1.1.5

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/console-protocol@1.1.5
  - @zhin.js/contract@1.1.0

## 2.1.14

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.
  - @zhin.js/contract@1.0.19

## 2.1.13

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.
  - @zhin.js/contract@1.0.18

## 2.1.12

### Patch Changes

- @zhin.js/contract@1.0.17

## 2.1.11

### Patch Changes

- b10d058: Preserve standard SSE event metadata, expose typed resumable Console event history, recover missed events before reconnecting the live stream, and allow durable unread notices to be rebuilt after a history gap.
- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
  - @zhin.js/console-protocol@1.1.4
  - @zhin.js/contract@1.0.16

## 2.1.10

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

- 985fa22: Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

  Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

  Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

  Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

  Persist each Workroom member's Assignment locality in the Catalog. Omitted routes retain the legacy local meaning; remote routes name one exact A2A endpoint and remain deterministic when several endpoint transports are enabled. Catalog/Profile/Grant authority is rechecked before either local or remote claim, so local and remote providers can coexist without first-wins or lexicographic routing.

  Replace the legacy file-backed Workroom Journal array format with content-addressed immutable v3 segments and database envelopes. The v3 schema uses an event-specific closed payload schema, stores only opaque control references beside governed payload receipts, and rejects unknown future fields before publication. Existing `.zhin/workroom-journal` data and database rows—including the blacklist-era v2 format—must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy records instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

  Replace arbitrary Effect Sponsor decision `reason` text with the closed v2 `reasonCode` contract. An exact pending-Intent resubmission first publishes a content-free, digest-bound quarantine/supersession receipt, durably replaces the legacy plaintext slot with that tombstone, and then publishes to a dedicated v2 slot. Partial migrations fail closed and resume idempotently after restart, while existing v2 records in the former slot remain replay-compatible. Human rationale must use a governed payload surface and is never persisted in the content-free decision repository.

  Require a full-scope token-bound principal plus current Catalog and P12 metadata authority for Portfolio Sponsor projections. Add the Root-authorized Data Steward/Privacy/Compliance Console plane for content-free lifecycle display, Hold review/release, subject erasure/export, retention purge, and reconciliation; identity and authority fields supplied by callers are rejected.

  Add an optional persistent `sponsorConversation` delivery view to Workroom Catalog entries. Multiple Projects may share one portfolio-level Sponsor Room address, while controls require an explicit Project id and every outbound item remains Project-scoped. The Host bootstraps the exact current Endpoint binding before the first outbound alert; queued projections revalidate current Catalog membership/binding plus the Sponsor-specific P12 channel and manifest immediately before delivery.

  Deliver content-free Portfolio lane, queue-head, grant/reclaim, budget, blocker, and fairness cards through that same governed Sponsor Room outbox. Strict Project-scoped Portfolio lane/status/budget-transfer controls use the authenticated Sponsor ingress path; a current card reply may supply the Project selector, switching Projects never rewrites a room-wide binding, and conflicting/stale explicit or reply targets are clarified without mutation.

  Keep Local Assignment recovery scans independent from long-running executors, and use one locale-independent canonical comparator throughout Workroom, Portfolio, and Data Governance authority ordering.

  Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.

- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [985fa22]
  - @zhin.js/console-protocol@1.1.3
  - @zhin.js/contract@1.0.15

## 2.1.9

### Patch Changes

- @zhin.js/contract@1.0.14

## 2.1.8

### Patch Changes

- Updated dependencies [e4757a8]
  - @zhin.js/console-protocol@1.1.2
  - @zhin.js/contract@1.0.13

## 2.1.7

### Patch Changes

- @zhin.js/contract@1.0.12

## 2.1.6

### Patch Changes

- @zhin.js/contract@1.0.11

## 2.1.5

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/contract@1.0.10
  - @zhin.js/console-protocol@1.1.1

## 2.1.4

### Patch Changes

- @zhin.js/contract@1.0.9

## 2.1.3

### Patch Changes

- @zhin.js/contract@1.0.8

## 2.1.2

### Patch Changes

- @zhin.js/contract@1.0.7

## 2.1.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。
  - @zhin.js/contract@1.0.6

## 2.1.0

### Minor Changes

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

### Patch Changes

- 5849336: 修复 console hooks 自动加载的零退避死循环：`useConfig` / `useConfigYaml` / `useFiles` / `useEnvFiles` / `useDatabase` 在 RPC 失败时会以全速反复请求 `/api/console/request`（状态为空 → effect 立即重试）。新增 `useAutoLoadOnce`：每次连接会话对同一 key 只自动加载一次，断连重置，手动重试仍可用。
- Updated dependencies [ac9da66]
  - @zhin.js/console-protocol@1.1.0
  - @zhin.js/contract@1.0.5

## 2.0.6

### Patch Changes

- @zhin.js/contract@1.0.4

## 2.0.5

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/contract@1.0.3

## 2.0.4

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/contract@1.0.2

## 2.0.3

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 2.0.2

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/contract@1.0.1

## 2.0.1

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.4

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/console-types@0.1.5

## 1.1.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/console-types@0.1.4

## 1.1.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3

## 1.1.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console-types@0.1.2

## 1.1.0

### Minor Changes

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

## 1.0.18

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/console-core@0.1.1
  - @zhin.js/console-types@0.1.1

## 1.0.17

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.16

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.15

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.14

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.13

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐

## 1.0.12

### Patch Changes

- 353de3d: fix: 控制台优化

## 1.0.11

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优

## 1.0.10

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.9

### Patch Changes

- 106d357: fix: ai

## 1.0.8

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.7

### Patch Changes

- f9faa1d: fix: test release

## 1.0.6

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.5

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.4

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.1.0 (2024-10-22)

### Major Features

- ✨ **插件配置系统** - 基于 Schema 的自动化配置表单

  - 完整支持 15 种 Schema 数据类型
  - 智能 UI 组件自动选择
  - 支持任意深度的嵌套结构
  - 实时配置读取和保存

- 🏗️ **组件模块化重构**
  - PluginConfigForm 拆分为 8 个模块（17 个独立渲染器）
  - 职责单一，易于测试和扩展
  - 向后兼容，使用方式不变

### Improvements

- 🎨 表单布局优化

  - 使用 ScrollArea 控制高度
  - 使用 Accordion 折叠复杂字段
  - 统一组件尺寸（size="1"）
  - 智能分组（简单字段 vs 复杂字段）

- 📝 文档完善
  - 新增 `DEVELOPMENT.md` 开发文档
  - 更新 `README.md` 添加配置系统说明
  - 详细的 API 参考和最佳实践

### Bug Fixes

- 🐛 修复 Schema 格式兼容性问题（dict vs properties）
- 🐛 修复嵌套字段状态管理问题
- 🐛 修复 definitions 字段名称问题

## 1.0.3

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑
- b213bbc: fix: 更新 kook 报错

## 1.0.2

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.1

### Patch Changes

- 727963c: fix: 修复 sqlite 数据错误;优化 console 展示
