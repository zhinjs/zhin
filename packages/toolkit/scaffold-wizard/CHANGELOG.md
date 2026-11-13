# @zhin.js/scaffold-wizard

## 1.1.19

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

- 120e225: 聊天角色（ADR 0056，2026-11-12 修订）：zhin 角色 owner / admin / trusted 分四级、只来自授予；发言者的平台身份与机器人自身的平台身份是独立维度，命令、Agent 工具 / 技能、中间件与按钮按三条维度共用一个评估器过滤。升级说明见 docs/migrations/chat-roles.md。

  - zhin.js：实例首次启动把适配器 `master` / `trusted`、`endpoints[i].master|trusted` 与 `ai.trigger.masters|trusted` 迁入项目数据库 `chat_roles`（先记入 `.zhin/chat-roles-migration.json`，再从配置移除并记日志）；之后配置再出现这些字段时启动报错并指向升级指南。平台身份不再映射为 zhin 角色：删除 `roles.mappings`（适配器块与 `endpoints[i].roles` 出现即启动报错）、`chat_role_mappings` 表与 Console `chat-roles.mappings` / `chat-roles.set-mappings`；`features.selfService.platformAdmins|roles|allowUsers` 删除；群内「功能」「角色」命令只认 zhin 角色，平台群主不再自动具备；聊天改配置、聊天重启、Agent 主人审批按 zhin `owner` 判断。
  - @zhin.js/core（minor，破坏性）：角色模型与解析移入 core（`ChatRoleService`、`createChatRoleSenderEnricher`），入站消息带 `sender.chatRole` 与归一的 `sender.platform`；删除 `SenderRole`、`senderRolesFromMessage`、`roleSatisfies` 等，`master` 改名 `owner`；删除映射规则 API（`createMappingChatRoleSource`、`DEFAULT_CHAT_ROLE_MAPPINGS` 等）与 `ChatRoleSource`；`createSenderEnricher` / `createConfigurationChatAuthorizer` 改为基于聊天角色。IM Runtime 为 PermissionHost 提供机器人自身身份（经 Adapter 索引缓存），机器人的角色变化事件使缓存失效；命令拒绝回复说明缺少的平台 / 机器人条件；`<Button permit>` 按点击者鉴权；场景治理工具工厂同时要求 `platform:*` 与 `bot:*`；`ai.trigger.masters|trusted` 删除。
  - @zhin.js/permission（minor，破坏性）：permit 语法 `owner` / `admin` / `trusted` / `role(...)`（zhin 角色）、`platform:owner|admin`、`platform-role:<id>`、`platform-permission:<name>`（发言者平台身份），新增 `bot:owner|admin`、`bot-role:<id>`、`bot-permission:<name>`（机器人自身平台身份，`PermissionSubject.bot`）；`PermissionHost` 新增 `setBotStandingResolver`、`withBotStanding`、`firstDenied`，`checkAll` 可带 `source` 解析机器人身份；新增 `describeDeniedPermit`、`permitsNeedBotStanding`。删除 `role(master)`、`scene_admin`、`scene_owner`、`platform(adapter,perm)` 及 `registerPlatform`、`createSceneRolePlatformChecker`、`platformPermission`、`definePlatformPermission`，定义时报错并给出替代写法。
  - @zhin.js/command（minor，破坏性）：命令会话的发送者改为 `chatRole` / `platform`，不再从 metadata 读角色；`CONVERSATION_MANAGER_PERMIT` 改为 `admin`（平台群主不再自动满足）；分发结果 `denied` 带 `denial`（第一条不满足的规则与原因）；指令菜单只列出当前发送者在本会话可用的命令。
  - @zhin.js/agent（minor，破坏性）：危险工具、文件 / exec 策略、主人审批、Agent 回合主体只读 zhin 角色（`principal.roles` 只含展开的聊天角色，平台地位在 `principal.platform`）；`SenderRole` → `PrincipalRole`，`SELF_CHANGE_MASTER_ROLE` → `SELF_CHANGE_OWNER_ROLE`；回合开始时读取机器人自身身份（`contextState.bot.platform`），按三条维度过滤 tool / skill / Agent 包后才披露，执行工具时再校验一次；群规「群主和管理员豁免」改为平台群主 / 管理员与 zhin `owner`。
  - @zhin.js/feature-kit：`OperationSession.sender` 改为 `chatRole` / `platform`。
  - @zhin.js/im-contract：新增 `PlatformStanding`、`SelfStandingRequest`、`standingFromMemberRole`。
  - @zhin.js/adapter：入站 sender 可带 `platform`；账号管理命令需要聊天角色 `owner`；`EndpointManagement` 新增可选 `inspectSelfStanding`，能力画像新增 `scene.selfStanding`（声明即须实现），`AdapterIndex.selfStanding` / `invalidateSelfStanding` 按会话缓存机器人自身身份。
  - @zhin.js/middleware：入站中间件可声明 `permit`，不满足时跳过该中间件（机器人身份只读缓存）。
  - @zhin.js/tool：定义工具时拒绝已移除的 permit 写法。
  - @zhin.js/ai：注释更新。
  - @zhin.js/console-protocol：`chat-roles.list|grant|revoke`（`iam.manage`）；`ConsoleChatRoleSource` 只有 `grant`。
  - @zhin.js/runtime：Host 配置 Schema 删除 `features.selfService.platformAdmins|roles|allowUsers`。
  - @zhin.js/testing：伪造消息与 `PluginTestKit` 用 `sender.chatRole` 声明测试身份。
  - @zhin.js/scaffold-wizard：ICQQ 向导不再写 `master`，完成后提示在 Console 账号「角色」页签或聊天 `角色 授予` 设置 owner。
  - 适配器：配置 Schema 删除 `master` / `trusted`（以及预览版的 `roles`）；群管理类工具同时声明发言者条件与机器人条件（如 `platform:admin` + `bot:admin`、`bot-permission:manage_roles`），NapCat / OneBot11 工具不再使用已移除的 `platform(adapter,…)` 写法。
  - 插件：内容审核以 `inbound.bypass`（permit 列表，默认 `owner` 或 `platform:admin`）取代 `masters` / `inbound.bypassMasters`；群管、音乐、日历、地震、B 站、轮盘赌的权限改用 zhin 角色，订阅类命令只认 zhin `admin` / `owner`。

- cc7a5f9: 常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

  - gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
  - console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
  - cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
  - zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
  - runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。

- 5cd9d3d: 引导服务核心（ADR 0053，B2）

  - gateway：新增 `@zhin.js/gateway/onboarding`——引导状态（`.zhin/onboarding.json`，原子写入，自动识别已配置的数据库、适配器、AI 与所有者）、`OnboardingService`（`status` / `markStep` / `complete`）、按 scaffold-wizard 目录生成的安装白名单、`authorizeInstall`（无所有者时只允许装数据库驱动，之后需要 `plugin.manage`；包名 / 版本 / dist-tag 严格校验），以及经依赖事务安装、流式输出事件、失败回滚。
  - cli：`zhin setup` 新增非交互参数 `--adapter`（可重复）、`--enable-ai`、`--skip-ai`、`--skip-adapters`、`--install`、`-y`，记录引导步骤并与 Console 走同一安装服务；`zhin console init` 记录第 1–2 步。
  - scaffold-wizard / create-zhin-app：共用 `buildDefaultAdapterSetup`；可以只启用 AI 而暂不配置模型 Provider。

- 0e35afd: 发版收尾：功能与文档对齐网关、访问控制的新语义。

  - `zhin migrate` 与 `zhin runtime migrate` 的 cutover 把项目的 `zhin.js`、`@zhin.js/cli`、`@zhin.js/gateway` 同批放进 `dependencies`：只写在 `devDependencies` 的连同版本挪过去，重复项删除；缺少网关时补上（CLI 用 `latest` 等标签时沿用同一标签，否则用与当前 CLI 同批发布的版本范围）。插件包（无项目配置 / 公开发布包）的 CLI 仍是开发依赖。
  - `zhin console init` 新增 `--database-password-stdin`（标准输入第一行；与 `--password-stdin` 同用时第二行是所有者密码），三种数据库密码来源只能选一个；`--database-password <值>` 保留但帮助与文档标为不推荐，使用时打印警告。
  - 脚手架生成的 `.env` / `.env.example` 把 `HTTP_TOKEN` 注释改为「初始化令牌：仅在创建首个所有者之前有效」，自动化改用账号签发的 API 令牌。
  - 文档：插件安装、更新、卸载统一写为网关 `gateway.packages.*`（实例内的 `plugin:install | update | uninstall` 已删除）；MCP / A2A 鉴权改为 `mcp.token` / `a2a.token`，或全局持有 `mcp.access` / `a2a.access` 的账号签发的 API 令牌，`http.token` 不再作为协议凭据（中英）；示例 `full-bot` 改用 `MCP_TOKEN` / `A2A_TOKEN`，各示例把 CLI 与网关放进 `dependencies`。

- f8bf684: 新项目把 `zhin.js`、`@zhin.js/cli` 与 `@zhin.js/gateway` 同批写进 `dependencies`（CLI 不再放在 `devDependencies`）：`zhin start` 在生产环境同样需要 CLI 与网关，`pnpm install --prod` 后也能启动，锁文件把三者固定在同一批版本（ADR 0054 §0）。
- Updated dependencies [e1fda87]
- Updated dependencies [4e8ba38]
- Updated dependencies [120e225]
- Updated dependencies [f8bf684]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [cc7a5f9]
- Updated dependencies [e0bc008]
- Updated dependencies [3fcfc0e]
- Updated dependencies [5cd9d3d]
- Updated dependencies [5cd9d3d]
- Updated dependencies [e0f857e]
- Updated dependencies [c2bbdcf]
- Updated dependencies [5cd9d3d]
- Updated dependencies [1e54b1e]
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/runtime@1.2.0

## 1.1.18

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
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/runtime@1.1.21

## 1.1.17

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/runtime@1.1.20
  - @zhin.js/plugin-runtime@1.1.22

## 1.1.16

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

- Updated dependencies [6347b19]
- Updated dependencies [5ec4728]
- Updated dependencies [bf00459]
- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [72b5a12]
- Updated dependencies [aa41889]
  - @zhin.js/runtime@1.1.19
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/config-file@1.1.13

## 1.1.15

### Patch Changes

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [299863a]
- Updated dependencies [9e6d70d]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/runtime@1.1.18
  - @zhin.js/config-file@1.1.12

## 1.1.14

### Patch Changes

- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/runtime@1.1.17
  - @zhin.js/config-file@1.1.11

## 1.1.13

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

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [6749002]
- Updated dependencies [fc33495]
- Updated dependencies [2c3610a]
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/runtime@1.1.16
  - @zhin.js/config-file@1.1.10

## 1.1.12

### Patch Changes

- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [ab2263a]
- Updated dependencies [b223a51]
  - @zhin.js/runtime@1.1.15
  - @zhin.js/config-file@1.1.9

## 1.1.11

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- Updated dependencies [5be6f3a]
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [658a5fb]
- Updated dependencies [144a17b]
- Updated dependencies [ff87195]
- Updated dependencies [a3b636d]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/runtime@1.1.14
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/config-file@1.1.9

## 1.1.10

### Patch Changes

- 0dd657d: Let the structured-decision provider decide group ambient engagement. New `ai.decisions.ambient` policy (`off` / `shadow` / `active`, plus `timeoutMs` and `minConfidence`): in `active` mode the DecisionProvider (for example TypeSafe Jev) answers one binary `engage` / `stay_quiet` choice over the same recent messages the chat-model judge sees, and the `ai.trigger.ambient.judge` list takes over when it fails, times out or answers invalidly; in `shadow` mode the judge list still decides and the decision is logged as `ambient_decision_shadow`. Quiet time, cooldown, hourly caps, conversation window, judge interval, `ambient.minConfidence` and ambient shadow mode are unchanged, and addressed turns still skip the ambient judge. Without `ai.decisions.ambient` nothing changes.
- Updated dependencies [0dd657d]
  - @zhin.js/runtime@1.1.13
  - @zhin.js/config-file@1.1.8

## 1.1.9

### Patch Changes

- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [bf0fa9f]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/runtime@1.1.12
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/config-file@1.1.8

## 1.1.8

### Patch Changes

- Updated dependencies [974fa85]
  - @zhin.js/runtime@1.1.11
  - @zhin.js/config-file@1.1.7

## 1.1.7

### Patch Changes

- f974c91: 新建项目写入真实依赖版本范围（如 `zhin.js: ^1.1.11`），不再写 `latest`：范围在 scaffold-wizard 打包时由 `prepack` 从工作区版本生成，AI 栈第三方包沿用 Zhin 自身 peer 范围；拿不到版本的依赖仍保留 `latest`。doctor / config check 诊断基线不变。
- 90057de: 删除已不再使用的旧版本快照 `src/stack-versions.generated.json`（及仓库脚本 `scripts/sync-scaffold-deps.mjs`）；脚手架版本范围统一由 `stack-version-ranges` 在打包时生成。
- 33fa6d3: 数据库选项中 MongoDB 的实机验收版本改为 MongoDB 7，与 CI 实测版本一致（MongoDB 8.x 在 Linux 6.19+ 内核上无法启动，CI 暂时改用 7.x）。
- Updated dependencies [1a11207]
- Updated dependencies [8302701]
- Updated dependencies [de5b2a1]
- Updated dependencies [29d0be9]
  - @zhin.js/runtime@1.1.10
  - @zhin.js/config-file@1.1.7

## 1.1.6

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [2b4d6dc]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [8550f17]
- Updated dependencies [7edd04c]
  - @zhin.js/runtime@1.1.9
  - @zhin.js/config-file@1.1.7
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.5

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.4

### Patch Changes

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13

## 1.1.3

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- b36452a: Add an optional TypeSafe AI Jev structured-decision provider with typed Choice, Score and Noul results, bounded cancellation-aware requests, response validation, and generation-owned cleanup. Add explicit TypeSafe setup and local doctor checks; preserve chat configuration, store credentials as environment references, and begin recommendation in shadow mode.
- Updated dependencies [badcc1f]
  - @zhin.js/plugin-runtime@1.1.12

## 1.1.2

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- a417170: Fix MySQL, PostgreSQL, MongoDB, and Redis behavior found by live database integration tests, including deterministic table initialization on single database connections. Generate endpoint IDs consistently, emit pnpm 11 workspace build permissions from new projects, and report the selected AI session database accurately during initialization.
- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11

## 1.1.1

### Patch Changes

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- 6b70e46: Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
- 65d0391: Make the instance-keyed `zhin.config.*#plugins` map a shared Plugin Runtime contract. Runtime startup helpers, Console configuration, onboarding, setup, install/uninstall, dependency diagnosis, and scaffolding now reject legacy package-name arrays instead of ignoring or promoting them; only the explicit migration pipeline reads that old shape. Remove the legacy `normalizePluginsMap` authoring API and dead create-project configuration reader, then add a repository gate that prevents compatibility branches from returning to normal configuration paths.
- 0724ddd: Define one Root configuration file contract across Runtime, CLI, Console, and scaffolding. Root projects now accept the documented YAML and JSON filenames, reject multiple configuration authorities, preserve JSON when edited through Console, and no longer expose TOML or TypeScript formats that Runtime cannot load.
- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Upgrade qq-official-bot to 1.3, expose its complete API client, and deliver QQ group lifecycle, member change, and join-request events through the canonical side-event path.

## 0.2.6

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

## 0.2.5

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau

## 0.2.4

### Patch Changes

- f8c7a54: fix: im

## 0.2.3

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

## 0.2.2

### Patch Changes

- 2a86259: fix: cli 增加 ai 适配器可选项

## 0.2.1

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

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

## 0.2.0

### Minor Changes

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- 15bbdb3: weixin-ilink 向导支持扫码绑定：默认展示终端二维码（`qrcode` 渲染 + 链接兜底），微信 ClawBot 扫码确认后自动获取 `bot_token` 写入 `.env`（`WEIXIN_ILINK_TOKEN`），`zhin.config.yml` 只生成 `${WEIXIN_ILINK_TOKEN}` 引用；支持过期/超时重试与手动输入 token 降级。扫码 HTTP 流程内联实现（协议对齐 `adapter-weixin-ilink` 的 `login.ts`），向导在适配器包安装前即可运行。
- 0356aa1: 适配器向导入口补全至 20 个：新增 line / wecom / weixin-ilink（字段式）与 napcat / onebot12 / milky / satori（自定义 configure，按 connection 分流 endpoint 字段）；字段 scope 分层对齐定稿 schema（凭据进 `endpoints[0]`，共享字段留顶层），产出经 Ajv strict 对照全部 20 个 schema 校验。

## 0.1.9

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

## 0.1.8

### Patch Changes

- 872c583: fix: 代码格式优化

## 0.1.7

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏

## 0.1.6

### Patch Changes

- b2c73bd: fix: 初始化项目后,安装依赖失败
- c4575c9: fix: 输入输出优化,文档优化

## 0.1.5

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身

## 0.1.4

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 0.1.3

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 0.1.2

### Patch Changes

- 3735e96: fix: 智能家居控制

## 0.1.1

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
