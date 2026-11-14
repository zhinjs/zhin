# @zhin.js/ai

## 1.6.0

### Minor Changes

- 4922472: AI 订阅账号接入（#1250）：Antigravity「完成准备」按官方开源客户端的方式向 `loadCodeAssist` 发送客户端 `metadata`，账号还没有 Code Assist 项目时用默认档位调用 `onboardUser` 开通并轮询长任务（有次数上限），失败时 `ProviderPreparationError` 带上游 HTTP 状态、原因码与步骤（不含响应正文与令牌）。账号没有默认档位时与官方客户端一致改用 `legacy-tier`；上游要求账号验证（`VALIDATION_REQUIRED`）时以原因 `validation-required` 结束、不尝试开通（不返回验证链接）；长任务名只接受单段 `operations/<id>`。整个准备过程有 90 秒总时限、每个上游请求有 15 秒时限，超时以原因 `preparation-timeout` / `request-timeout` 报告。准备失败不再被吞掉：日志写出代码与上游状态；`/login/complete` 仍返回 200，但账号状态视图新增 `preparationFailure`（`code` / `reason` / `upstreamStatus` / `step`，仅当前凭据修订、进程内保存），Console 无需再次调用准备即可显示原因。**客户端可见的变化**：准备失败原先一律是 503 `unavailable`，现在 `/login/prepare` 返回 424，`code` 固定为 `preparation-failed`，驱动给出的代码放在 `preparationCode`，另带 `reason` / `upstreamStatus` / `step`；机密 OAuth 客户端缺少 client secret 时 `/login/begin` 由 503 改为 428 `client-secret-required`；模型目录请求被限流（上游 429）时 `/discover` 由 503 改为 429 `discovery-rate-limited`，带 `upstreamStatus` 与解析后的 `retryAfterMs`（401/403 仍按拒绝处理）。驱动元数据新增 `requiresClientSecret` 与 `modelSuggestions`（仅为建议）；Codex 订阅支持「从服务读取模型」（Codex CLI 使用的 `/models` 目录），Claude 订阅给出带「suggestion」标记的模型 ID 建议。

  审查跟进：Antigravity 账号 `loadCodeAssist` 返回了 `currentTier` 却没有项目时，先按当前档位再调用一次 `onboardUser`（同样的长任务轮询与时限）读取项目；仍没有项目时使用模型服务配置的新可选项 `projectId`（Google Cloud 项目 ID，字符串形式，与 gemini-cli 的 `GOOGLE_CLOUD_PROJECT` 一样以 `cloudaicompanionProject` 和 `metadata.duetProject` 发给 `loadCodeAssist` / 非免费档位的 `onboardUser`），都没有才以原因 `project-required` 结束，424 文案说明如何填写项目 ID。Codex 订阅的模型目录请求不再上报 `@zhin.js/ai` 自己的版本号：`client_version` 改用模型服务配置的新可选项 `codexClientVersion`，默认 `0.167.0`（已知可用的 Codex CLI 版本，导出为 `CODEX_DEFAULT_CLIENT_VERSION`）；目录为空时 `/discover` 的结果带 `emptyHint`（`code: 'discovery-empty'` 与提示文案），Console 可提示用户手动填写模型 ID。`@zhin.js/ai/providers` 新增导出 `CODEX_DEFAULT_CLIENT_VERSION`、`CodexServiceOptions`、`AntigravityServiceOptions`。

### Patch Changes

- 0e998fd: Agent 性能与 trace 改进（#1250）：

  - 按需加载的工具在会话内只增不减：常驻工具按名称排在最前，已加载工具按首次加载顺序追加；本回合策略较窄、看不到的已加载工具仍保留在会话快照里，下一回合原样回到列表，相邻请求的 `tools` 前缀不变。超出 `maxLoadedPerSession` 时按最早加载淘汰并写日志（`touchToolInSnapshot` / `touchToolsInSnapshot` 新增可选 `onEvict`）。
  - 子 Agent（`ask` / `follow_up`）回合里工具产出的图片、音频、视频、文件作为结构化附件随回复交回提问方，并入提问方的回复经正常出站链发送，不再依赖子 Agent 正文复述 URL。只收工具产出的媒体（子 Agent 正文里的链接不算），并先用子 Agent 自己收窄后的权限判定每个附件（本地路径须通过它的文件权限）。
  - `zhin trace` 记录子 Agent 的模型调用与用量（之前显示 0 次），父回合汇总写成「合计（自身 N，子 agent M）」，新增 `subagent_usage` 字段；`ai.usage` 与用量记录同样计入且不重复计。
  - 同一次模型请求在时间线、`requests`、`model_calls` 与 `ai.usage` 里记录同一个 provider（实际解析出的服务 ID），`zhin trace` 显示服务名。
  - 每次模型调用记录请求前缀哈希（system + 工具定义，`prefix_hash`）；某服务长期没有缓存命中而相邻请求前缀相同时，Console 用量统计（`promptCacheHints`）、`zhin usage report` 与 `zhin doctor` 提示「该服务可能不支持或未透传 prompt 缓存」并给出前缀相同的比例。

- 5232fd8: IM 审批安全修订（#1250 安全审查）：管理员本人审批改为开关 `ai.agent.approval.adminSelfApprove`，**默认关闭**——关闭时这类回合与之前一样只能由主人批准（或说明无人能批），`execApprovalMode: ask` 默认仍只有主人能批；开启后管理员本人确认只限策略明确标为管理员可批的操作——声明 `tags: ['admin_approvable']`（`ADMIN_APPROVABLE_TOOL_TAG`）的工具（Host 的 `schedule_add` 已声明）与写 `session` 记忆；敏感文件 / 受保护路径（如 `.git/config`）、Shell 命令、写 `global` / `platform` 记忆、未声明的插件工具审批与自动审核 Agent 的升级审批都需要主人，管理员的确认渠道直接返回「需要主人」而不弹提示（`ApprovalRequestInput.requiresOwner` / `adminMayApprove`）。管理员审批人要求端点层或以上的 `admin`（`holdsEndpointAdmin`；会话层 admin、被降级的会话层 owner 不算），且只在管理员自己的私聊里；群聊 / 频道未配置主人时不再退回管理员自批。读过外部内容、合流或旁听回合里写发起人自己的 `user` 记忆也先请发起人确认意图（防记忆投毒）。审批提示的「风险」行与危险工具硬闸提示同样打码，新增识别 `FOO_TOKEN=…` / `export API_KEY=…`、`Authorization: token …`、`X-Api-Key: …`、`--password=…` / `--token …`、URL 中的密码、JWT、AWS / Google 密钥；执行、指纹与授权范围仍用原参数。审批端口按用途报告可用性（`ApprovalPort.intentAvailable`、`isApprovalPortAvailable(port, purpose)`），只能确认意图的端口对硬闸与普通审批直接报不可用。「审批策略已变更」说明只认框架写入的拒绝记录（`ToolResultMessage.deniedUnderPolicy`），工具输出里伪造的策略戳不再触发。
- b5884b3: 服务地址可以改了（#1250 `service-baseurl-immutable`）：没有账号引用的服务可以任意修改地址；已被账号引用的服务只允许改 URL 路径（协议、主机、端口不变，例如把 `https://byesu.com` 改成 `https://byesu.com/v1`），换主机仍然拒绝——账号的密钥只能发往原来的主机。只有 `baseUrl` 跨源修改才返回新的 `ProviderError` 代码 `service-origin-change`（HTTP 409），其他身份字段（issuer、tenant、product、headers、鉴权方式等）的修改仍是 `plan-conflict`；同源比较前按 URL 规范化（默认端口、IDN、IPv6 写法、大小写、主机名末尾的点），Console 拿到的错误文案说明原因并建议「复制为新服务」。另外，模型请求拿到 2xx 却不是 JSON / 事件流（例如少了 `/v1` 时返回站点首页 HTML）时，改为明确的 `non_json_response` 失败类型（「服务返回的不是 JSON（可能少了 /v1）」），不再是看不懂的 SDK 解析错误，也不会重试；连接测试与聊天失败提示都会用到它。
- 9026329: `zhin trace` 记录并显示触发消息（脱敏、截断到 120 字的文本、发送者、会话、消息 id）以及「收到 → 回合开始」的等待时间、合流消息数和排队时长；时间线首行显示回合开始前收到消息的时刻（#1250）。trace 因此包含用户发言摘录与发送者 / 会话标识，Console 读取（`/api/agent/traces`、`/api/agent/trace-archive/*`）需要 `agent.view`，见 CLI 文档「触发消息」。修复同一回合内在工具变更后的再补全里调用 `load_tool` 时，下一次模型请求仍未声明该工具、模型只能再调 `discover` 的问题：Agent 循环在下一次请求前刷新工具列表；`load_tool` 成功但本回合策略不允许该工具时返回明确错误。
- Updated dependencies [e6d7cc1]
- Updated dependencies [7cc703a]
- Updated dependencies [70ddaf4]
- Updated dependencies [b56cca9]
  - @zhin.js/plugin-runtime@1.3.0

## 1.1.56

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1

## 1.1.55

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

- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [c2bbdcf]
- Updated dependencies [5cd9d3d]
  - @zhin.js/logger@1.1.3
  - @zhin.js/plugin-runtime@1.2.0

## 1.1.54

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

## 1.1.53

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/plugin-runtime@1.1.22

## 1.1.52

### Patch Changes

- 3a8504b: ADR 0048 Agent Harness (H1–H2): new `@zhin.js/harness` package (attenuated authority, conserved budgets, guard kernel, engagement journal, mailbox). Live turns now collaborate with other agents through the `agents` / `ask` / `delegate` / `tell` / `cancel_delegation` / `escalate` tools instead of `spawn_task`; `agent.json` gains `collaboration: { contacts, accepts_from }`. The sub-agent runtime, deferred workers, detached tasks and their config fields are removed.
- bc6ccb1: Deep audit bug fixes and 7 architectural improvements:
  - Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
  - Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
  - Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
  - Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
  - Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
  - Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
  - Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
  - Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
- 8de6080: Restore MiniMax and Gemini empty-reply retry presets through the supported Anthropic and OpenCode Drivers, and default DeepSeek to one same-model extra attempt. Service defaults and exact-model overrides can still disable these presets with `emptyReplyRetries: 0`. The existing precedence over global resilience settings, Driver identity checks, exploration budgets and tool execution remain unchanged.

  Preserve the model's declared thinking capability in SDK execution metadata, separately from its internal replay protocol. DeepSeek-compatible tool-call histories retain their required placeholder when a gateway omits reasoning; Google, Ollama, Anthropic and OpenAI native protocols do not acquire fabricated thinking. Real reasoning and signed/encrypted state are preserved; model capabilities are not inferred from names and no new user configuration is added.

- 8de6080: Resolve summary and perception models only when they are used. Plain chat no longer validates unused auxiliary Drivers, and a successful perception primary does not validate its backups. Compaction resolves its summary model only after finding a prefix to summarize, while retaining the current operation's graph, deployment summary source, failure handling and cancellation.

  `ModelExecutionScope.summary`, `perception` and `perceptionFallbacks` now expose declared candidates: call `resolve()` to obtain an executable model bundle. Consumers of this API must update both `@zhin.js/ai` and `@zhin.js/agent` to versions containing this changeset; older paired releases do not provide the deferred compaction execution contract.

- 8de6080: Refresh OAuth credentials on demand near expiry using a lifetime-bounded window. Persist account-wide rate-limit cooldowns, preserve normalized token response facts, and retain encrypted recovery material for interrupted exchanges without automatically replaying refresh tokens or authorization codes.
- 8de6080: Preserve complete environment-default API key expressions as private encrypted sources during migration and explicit credential repair. Resolve them through the Host environment store only at authorization, keep fallback values out of public metadata, and preserve account identity checks when resolved credentials change.

## 1.1.51

### Patch Changes

- 299863a: ADR 0044 C3: runtime consumers read capabilities instead of platform names. Scene facts (group info, member profile) are queried where the profile declares `scene.groupInfo` / `scene.memberProfile`; activity feedback (reaction, typing, status message, refresh interval, quote-only delivery) follows `feedback`, `actions.reaction` and `delivery.proactive` and the per-platform table is gone; large inline media is spooled only where `delivery.spool` is declared; the sandbox ingress and its console shell follow a new additive `runtime.sandbox` capability. `defineAgentTool` and Skill frontmatter accept `requiresCapabilities` (for example `actions.mute`), evaluated against the per-turn `TurnCapabilities`, so moderation tools disappear when the Bot is not an administrator and return when it is; the icqq/qq keyword boost in tool selection is removed and the icqq group-admin tools are tagged. The `icqq` command-line special case in the exec policy is now a generic `registerSensitiveExecCommand` rule registered by the icqq plugin. `EndpointCapabilities` gains a serializable per-kind `kinds` view. Adapters without a profile keep their previous behaviour (their derived profile also reads the management ports they implement).
- 9e6d70d: Ambient engagement no longer drops a burst that lands inside `judgeIntervalMs`: it waits for the window to end on the same ticket (a newer message still supersedes it), re-checks cooldown, hourly cap and conversation state, then judges the latest messages. Previously such a burst was skipped with `judge_interval` and never re-judged unless someone spoke again.
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- d086ff3: Add optional display-only Provider support metadata. Mark Claude subscription and Antigravity as experimental, and disclose that Codex has no explicit OpenAI authorization for third-party clients. Project only declared public support fields into exact held Driver and deployment views; registration, authentication, permissions and inference behavior remain unchanged.
- 8be6c23: Preserve actual model error/aborted terminals, observed partial results and accumulated usage across standalone Agent tasks. Subagents and deferred workers now report those terminals as errors, and Workroom planning rejects failed responses before parsing JSON. Cancellation retains the caller's original rejection reason and exposes a copied interruption snapshot without retrying tools or changing continuation policies.

  Update synchronous subagent callers to read `spawnSync()`'s structured status/result/toolCalls/terminal outcome instead of a string. The built-in waiting tool reports the actual outcome without exposing routing metadata. A failed deferred re-completion now reaches existing main-agent failure gates, which can stop segment continuation that previously proceeded after the hidden error.

## 1.1.50

### Patch Changes

- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- 26fda97: Deliver validated final answers progressively through configured QQ C2C, Telegram drafts, Slack streams, Lark cards and Sandbox updates. Keep complete-message delivery for unsupported scenes, disabled adapters and outbound middleware that does not explicitly support revisions. Discord retains complete-message delivery.

  Preserve source-account leases, media order and confirmed delivery facts across cancellation, capacity rollover and follow-up answer phases. Preview drafts and uncertain outcomes do not become sent history. Bound each reply's semantic snapshot to 1 MiB, retain confirmed prefixes on failure and avoid replaying published answers.

  Project the latest confirmed message revision into paginated conversation history and synchronize Sandbox message updates across connections. Existing adapter implementations and complete-send callers remain compatible.

- 976886c: Preserve confirmed progressive reply content, routing and delivery evidence across cancellation, rollover and closing failures without replaying published text. Keep error dispositions and actual message references, and abort the owning provider request when its functional text consumer fails.

  Enable native Sandbox Markdown through the real Core projection so Console updates retain formatting in one message. Preserve instance-level streaming opt-outs, recall tombstones and multi-page synchronization. The first safe content is immediate; later updates retain the configured pacing, including large valid intervals.

  Keep Slack and Lark Markdown streaming within the current physical message. When continuation formatting cannot be verified, stop and retain confirmed content instead of replaying or silently changing it to plain text. Plain-text continuations retain their original reply route.

  Use rebuildable revision metadata and indexes in the existing conversation event table for bounded SQL history reads. Original event JSON and retention remain unchanged; older writers and models keep their compatible read path. Supported adapter streaming remains enabled by default, with complete-message fallback for disabled settings or outbound middleware without incremental: true.

- 3c1912f: Restore legacy Sandbox streaming history updates while preserving revision precedence, creation order, recall boundaries and browser-cache provenance. Report empty QQ send plans as not sent before any platform call.

  Seek past completed conversation-history backfill batches instead of re-scanning the migrated prefix. Preserve original event data, retention and compatible older writers.

  Report terminal provider quota and billing failures after publication without regeneration, and isolate synchronous diagnostic failures from provider outcomes and retry/fallback decisions.

## 1.1.49

### Patch Changes

- 6749002: Keep interactive runtime turns and their synchronous children running without fixed iteration or total wall-clock caps. Share configured token quotas across the live turn, retain cancellation and authorization, compact child context independently, and report periodic progress without additional model calls or blocking final delivery. Scheduled, unattended, independent background and legacy API budgets remain unchanged.

  Stabilize prompt prefixes by keeping conversation identity in the session-stable system tail and fresh scene state after the current message. Shorten and escape the host-context boundary, preserve permission-filtered tool disclosure, and omit fixed iteration ceilings from continuous-run traces.

  Project repeated inspections of the same private image only once per model request, preserving resource access checks, transient lifetime, and the existing inspection limit.

- c7944a5: DeepSeek 默认 `midConversationSystem` 改为 `none`：实测 DeepSeek 的 context 中不能放多段 system，对话中途的 system 消息（事件等）统一降级为带 `user_id:system` 头的 user 消息。显式配置 `compat.midConversationSystem` 仍优先。
- fc33495: master 私聊审批改为先问人：`masterShell: isolated` 不再把审批强制成 `auto`，新增 `ai.agent.masterShellApprovalMode`（默认 `ask`，可选 `auto` / `inherit` 沿用 `execApprovalMode`）；master 私聊中自动审核拒绝会转问 master；群管冷却不再作用于私聊；拒绝提示与安全提示词要求在 master 私聊里请求批准而不是放弃。
- 2c3610a: Add owner-scoped personal AI Sessions and a closed model policy hierarchy. Compile legacy providers and bindings into immutable, revision-leased connection/model/preset invocations while keeping Agent tool authority separate.

  Provide authenticated personal model management, encrypted Host-private credentials, public HTTPS transport with DNS pinning and same-origin redirects, and persistent per-Session model selection. Deployment tasks and summaries retain deployment model authority. Preserve legacy history and configured perception fallback chains. Keep every chat turn on its selected model, including legacy configuration, while retaining same-model retries.

  Extend trusted Host generation leases to resolve Root-private resources without publishing them in snapshots or child Plugin Scopes.

- 4949b90: Preserve participant text and media boundaries when appending runtime context, anchor Anthropic caching before transient media, escape quoted host markers, and keep specialist selection out of the stable capability prefix.
- 4c05a4e: 提高跨轮提示词缓存命中率：当前消息的运行时上下文（会话规则、记忆、技能、场景行、延迟工具索引、Turn context 等）移到正文之后，正文与日后的历史逐字节一致；系统稳定前缀不再随发送者角色变化；场景行 admins 排序稳定（ADR 0045）。

## 1.1.48

### Patch Changes

- c58c589: Group deferred tools by their canonical plugin or MCP server instead of installation paths. Omit already represented delivered text and ledger facts only from the current model projection, preserving full history and restoring facts when their covering reply leaves the active context. Allow tools to declare a synchronous, read-only availability predicate before turn disclosure, with execution-time checks remaining authoritative.

  Preserve every confirmed platform message identity across Agent replies and ICQQ split sends. Give each bubble its own stable single-message alias while retaining the reply's ordered association; preserve confirmed prefixes on partial delivery without retrying or inventing unknown message IDs.

## 1.1.47

### Patch Changes

- b5071e7: ADR 0041 slice A: participant headers. The trusted host stores the full `[id:…;user_id:…;name:…;role:…;group_nickname:…;group_title:…;mute_time:…;time:…;]` header in `UserMessage.name` / `AssistantMessage.name` (built from the conversation actor and the turn's bot facts, never from model output). At the LLM boundary `projectPromptContext` now sends the full header on a `user_id`'s first appearance in the visible window, the short `[id;user_id;time]` form afterwards, and synthesizes a `member_changed` event before a message whose sender facts changed without a recorded event; the header is the first line of the text and stored history is never mutated. Replaces the `[User]{…}` JSON and `[sender:…]` labels (`buildActorPrefix` is removed); `normalizeUserMessageForStorage` strips the new header line. Legacy messages without `name` derive the header from `actor`.
- e23cabc: ADR 0041 slice B: the turn context now carries real scene facts. `EndpointManagement` gains `inspectGroupScene` (name, owner, admins, member count, global mute) and `inspectGroupMemberProfile` (role, card, title, mute expiry; one lookup), implemented by the ICQQ adapter from uncached group/member reads. The CLI resolves them per turn (bot role always fresh; group and sender facts reuse a 60 s, 256-entry in-memory cache scoped to the generation; failures omit fields) and the inbound actor now carries `groupNickname` / `groupTitle` / `mutedUntil` plus the platform role. The Session / Bot state blocks are replaced by one projected scene line `[scene_id:…;scene_type:…;scene_name:…;owner_id:…;admins:…;member_count:…;global_mute:…;assistant_role:…;]` (values escaped and clipped to 64 chars). No new on-disk state.
- 3c4178d: ADR 0041 slice C: member state changes enter the session history. Join / leave and card / title / role / mute changes from the scene side events are written to `agent_messages` as `event` messages (`<operator> changed <user_id> <field> to "<value>"`, `<user_id> join <scene_id> on <HH:mm:ss.SSS> by <self|operator_id>`), in arrival order, with the existing compaction and retention; member-controlled values are always quoted, escaped and clipped to 64 characters. At the LLM boundary they render as one `[state change]` message per run of events: a system / developer message where the provider accepts it mid-conversation, otherwise a user message headed `user_id:system` (merged into an adjacent user message as a separate block). Events never sit between an assistant `tool_calls` message and its tool results and are never moved earlier. New provider capability `compat.midConversationSystem` (`system` / `developer` / `none`; OpenAI and remote OpenAI-compatible default `system`, o-series / gpt-5 `developer`, local servers, Anthropic and Gemini `none`). Join / leave and profile changes no longer appear in the ephemeral `[Scene events]` block (a bare join still wakes a turn). The system prompt states that quoted values in `[state change]` lines are data.
- 825e4dc: ADR 0042 §1: the IM system prompt is now built as a byte-stable prefix (system / environment / role_rules / platform, plus the platform reply instruction and exploration guidance) and a per-turn scene tail (scene line, network note, pre-fetched data). The AI request context carries `systemPromptCacheBreakpoint`; Anthropic receives two system blocks with `cache_control` on the stable block only, Gemini receives two system parts, and other providers still get one string with the stable part first. Gemini explicit context caching now caches only the stable system part plus tools (the scene tail moves into `contents`), treats a 404/unsupported `createCachedContent` as permanent for that model, and logs the reason once per model with the API error message instead of on every prefix change.
- f1eb75c: ADR 0042 W2: resident tools are tiered by scene (group and ordinary private chats keep chat essentials only; master private chat adds development and delegation tools; non-IM turns keep the old default set). Calling an authorized deferred tool by exact name auto-loads it, and `discover` attaches and loads the schemas of its best 1-3 matches. The provider tool list is now stable for prompt caching: resident tools sorted by name, loaded tools in first-load order (new `loadedOrder` in the deferred tool snapshot), new tools only append.
- 5621f75: ADR 0042 W3: fold the resident catalogs. The deferred tool index is one line per domain (MCP server, else owning plugin / builtin area) with up to 6 sorted tool names and the total count, e.g. `calendar: calendar_add, calendar_list (2)`; details come from `discover`. The skill catalog keeps the skill name plus one trigger sentence of at most 40 characters (full description at `load_skill` / `discover`) and is sorted by name so the block is byte-stable. Providers that use prompt-mode structured output (DeepSeek, `compat.structuredOutput: 'prompt'`) now get a compact shape (one example plus one data-shape line per offered segment type, derived from the schema) instead of the full JSON Schema text; native providers still receive the schema as an API parameter and `decodeStructuredReply` still validates with it. `@zhin.js/ai` exports `registerStructuredOutputPromptText`.
- 2b8b408: ADR 0043 §1 (H1): history stores conversation only. Per-turn context blocks (`[Turn context]` with time, told ledger, recalled memory, tone hint, merged-turn and danmaku lines; `deferred-tools`, `workspace-rules`, `skill:*`, `file-memory:*`, `session-rules:*`, `session-guidance`, `session-identity`, `active-skills`, `deferred-catalog-summary`, `quote-guidance`) are now marked `perTurn` when built and dropped by `normalizeUserMessageForStorage`; the current message sent to the model is unchanged. `projectPromptContext` also strips them (identified by flag, contextRef key or legacy text prefix) from every earlier user message, so rows stored before this change stop replaying them; stored data is never rewritten.
- 4d728c0: ADR 0043 §4 + §5 (H4) and the ADR 0041 actor-only amendment. Participant headers are no longer stored: user messages keep only `actor`, assistant messages keep `assistantActor` (plus the delivered `messageId`), and the header is rendered at the LLM boundary; legacy rows that still carry `name` are read as before. Headers now use session message aliases `id:m<n>` (an ordinal over the stored active path, so already-sent prefixes never change), `time:HH:mm` shown only when a minute has passed since the last shown time (the first message and the first message of a day also carry `date`), and `reply_to:m<n>` when the message replies to one inside the visible window. A reply to a message outside the window gets one `[quote id:…;user_id:…;time:…;] <first 120 chars>` line (media as placeholders, a forward expanded one level) so the model no longer needs `inspect_conversation_reference` for ordinary quotes; the quote is resolved by the ingress through the reference port (3 s timeout) and stored as structured `UserMessage.quote`. Tool arguments named `message_id` / `message_ids` / `*_message_id` / `reference` and `reply` segments accept the alias as well as the platform id; `inspect_conversation_reference` also accepts the quoted message id.
- f0e1df7: Group merge window (ADR 0038 slice A): with `ai.agent.inboundQueue.merge.enabled`, plain-text mentions from several group members within a short window (`quietMs` 1500 / `maxWaitMs` 6000, up to `maxSenders` 5) are answered by one turn instead of one reply each. Off by default until merged turns narrow permissions per sender. The master, private chats, commands, stop words and messages with media, quotes or forwards keep their own turns. New audit codes `merge_window_joined` / `merge_window_flushed` (plus the other ADR 0038 codes reserved for later slices).
- d9672ec: ADR 0038 切片 B2：合并回合里有副作用的工具调用按 `onBehalfOf` 指向的发送者复核（缺省按权限最低者），不通过写 `merge_on_behalf_denied`；合并回合最多 1 张新审批卡；新增 `ai.agent.toolHardGate.maxPendingPerScene`（默认 3），每群待审卡超限 fail closed（`hard_gate_scene_pending_cap`）；群聊合流 `inboundQueue.merge.enabled` 默认改为开启。
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- 119e9e6: ADR 0043 §2/§3: the history sent to the model is bounded by a token budget (`ai.context.historyTokens`: group 8000, ordinary private 12000, master private 24000, a number for all scenes or per-scene overrides, `0` = off; `ai.context.maxRecentMessages` stays as a message-count upper bound). The budget is measured after projection, the window starts on a turn boundary, and it only moves — in one block leaving 25% headroom — when the budget is exceeded, so the prompt-cache prefix stays stable. Tool results of finished turns (and very long call arguments) reach the model as their first 200 characters plus `…(已省略 N 字)`; the current turn and stored history are unchanged.
- f2bbab5: Stop the bot from reacting with an emoji on every turn. The structured-reply instruction now says reactions are occasional (`""` is the default), and the host paces reactions per session: at most one per `ai.agent.reactions.cooldownMs` (default 10 min) and only with `probability` (default 0.35; 0 disables). Paced-out reactions are not sent, count as handled, and are audited as `{ reaction: true, applied: false, paced: true }`. Memory only, bounded to 1024 sessions.
- 1bdbc08: Retry context overflow only when recovery reduces the projected request's estimated message tokens. Preserve the original overflow when recovery fails, and honor cancellation before retrying.
- df6442c: 为缺失结果的工具调用补占位结果时，沿用该工具调用消息的时间戳而不是当前时间，使同一段历史重复修复得到相同结果（前缀缓存与投影可复现）。
- b223a51: Record redacted model inputs per request for local conversation traces, with reported usage kept separate from context estimates. Preserve trusted conversation and source-message identity, expose details through full-scope read-only Console APIs, and enforce bounded trace retention. Request-body recording is enabled by default and can be disabled with `ai.agent.recordRequestBodies: false`.
- d0e1fac: Keep stable prompt instructions ahead of turn-specific capabilities, project unchanged context without placeholder text, and retain scoped state snapshots with readable updates and compaction recovery. Preserve native conversation/tool chronology and separate participant identity from runtime guidance.

  Resolve the ICQQ bot account and current-group role before capability discovery, and support explicitly declared current-conversation bot-role requirements without changing existing requester permissions or approvals. Keep role lookup failures unknown and preserve execution-time platform checks.

- 945303c: Preserve tool-call arguments, call associations, invalid-input details, and result status in compaction summary input, while excluding private reasoning and provider signatures.

## 1.1.46

### Patch Changes

- ff87195: 决策审计 Console 回放（ADR 0036 切片 C）：

  - Host 新增只读查询 `plugin.root.decisions`（倒序列表，按平台 / 会话 / kind / outcome / 时间过滤，`nextBefore` 翻页）、`plugin.root.decision-turn`（按 `turn_id` 展开时间线）、`plugin.root.decisions-export`（时间窗导出 JSON，字段与表结构一致，`nextSince` 分页），都需要 `decisions:read`；入口在「机器人状态」页。
  - `DecisionEventLog` 增加 `query` / `turn` / `prune` 读取与保留期清理；新增配置 `ai.audit.retentionDays`（默认 14 天），启动时与之后每小时清理过期行，并为 `ts`、`turn_id` 建索引（SQLite / MySQL / PostgreSQL）。
  - 不含控制面开关（切片 D）与危险工具硬闸（切片 E）。

- a3b636d: 危险工具硬闸 IM 审批通道（G6，#1013）：`ai.agent.toolHardGate.imApproval`，默认关闭。

  - 配置：`enabled`、`approverIds`（扁平列表或 `platform → userIds`）、`delivery: dm | approver_group`、`approverGroupId`（审批群模式必填，且不能是业务会话）。
  - 新审批卡片经触发调用的 Endpoint 私聊投递给 allowlist 审批人（或发到专用审批群），内容含工具、类别、会话、脱敏参数摘要、卡片 id、过期时间；投递失败不重试，卡片照常留给 Console、超时拒绝。
  - 审批人私聊 `/approve <id>` / `/deny <id>` 结算同一个 `ToolApprovalQueue`，与 Console 先到先得；群 / 频道消息与触发会话一律不能结算；仍是 humanOnly、一次一批，不提供本会话 / 永久授权，`bypass` 与审核 Agent 不能放行。
  - 审计：`tool_approval` 结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group` / `turn_prompt`），IM 操作者记 `actor_id = im:<platform>:<userId>`；Console 审批卡片 RPC 返回 `channel`。

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- dcd4982: Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
- 69f9ef6: Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
- 17d1301: 新增危险工具硬闸（ADR 0036 切片 E，fail-closed）：

  - 工具可以声明 `risk: 'dangerous' | 'safe'` 和 `riskCategory: 'member' | 'publish' | 'funds' | 'identity'`。宿主内置一份危险工具清单，`ai.toolHardGate.dangerousTools` 只能把工具调高为危险，插件声明 `safe` 不能调低。
  - 危险工具执行前必须拿到一次全新的人工审批（`humanOnly`），`execApprovalMode: bypass`、自动审核、主人自动放行和已记住的授权都不能越过。拒绝、超时（默认 5 分钟）、无人可批都按拒绝处理，本轮不再重试同一工具或同一类别。
  - 资金类（`funds`）默认禁用；打开 `ai.toolHardGate.allowFunds` 后仍需审批。
  - 无人值守的轮次会排进审批队列，Console 通过 `plugin.root.tool-approvals` 查看、`plugin.root.resolve-tool-approval` 批准或拒绝（权限 `tool_approvals:read` / `tool_approvals:resolve`），批准后下一次同参数调用只放行一次。
  - 结果写进 `ai_decision_events`：`tool_hard_gate`（allow / deny）、`tool_approval`（defer / allow / deny），safe / 只读工具放行但仍写 `tool_call`（allow）；新增码 `tool_approval_requested`、`tool_approval_approved`、`tool_funds_disabled`、`tool_hard_gate_latched`、`tool_safe_allowed`（追加在码表末尾）。

- f821029: 新增会话画像。私聊是一个人的会话，群和频道是多人会话，两者共用一套模型：

  - **人物关系与好感度**（新表 `ai_user_relations`，按 `platform + user_id` 合并同一个人）：称呼、短笔记、语气标签、好感度 -100 ～ 100、关系 stranger/acquaintance/familiar/close。好感度按规则变化（聊天/夸奖加分，辱骂与连续只当工具用扣分，加分有冷却和每日上限，主人恒定满分），回合结束后异步写回，不阻塞回复。
  - **会话上下文与发言限制**（新表 `ai_session_profiles`，按 `platform + scene_key`）：话题、管理员、成员概况、Bot 自己的禁言/全员禁言/宿主限制。由会话事件和发送者角色按规则维护；话题由模型经 `session_profile` 工具更新。Bot 在会话里不能发言时，入站消息直接不进 AI 回合，也不跑旁听判定。
  - **注入很短且只对本轮有效**：`[Relationship]` 只放本条消息的发起人（旁听时再加 1 个最近活跃的人），`[Session]` 只有一行；两者作为 ephemeral 内容块发给模型，存入 `agent_messages` 前丢弃，不会在之后的回合重放。`@zhin.js/ai` 的 `TextContentBlock` 新增 `ephemeral` 标记。
  - `user_profile` 工具新增 `note` / `unnote` / `call_me` / `tone`，并拒绝保存疑似密钥或证件号的内容。
  - `ai_user_profiles` 偏好收紧为 8 个固定维度（name/language/timezone/style/interests/dislikes/occupation/location，常见别名归一化），同维度覆盖写入，其他键拒绝，值 ≤80 字；笔记、语气标签、话题都是去重 + 固定上限，不会无限增长。

## 1.1.45

### Patch Changes

- 0dd657d: Let the structured-decision provider decide group ambient engagement. New `ai.decisions.ambient` policy (`off` / `shadow` / `active`, plus `timeoutMs` and `minConfidence`): in `active` mode the DecisionProvider (for example TypeSafe Jev) answers one binary `engage` / `stay_quiet` choice over the same recent messages the chat-model judge sees, and the `ai.trigger.ambient.judge` list takes over when it fails, times out or answers invalidly; in `shadow` mode the judge list still decides and the decision is logged as `ambient_decision_shadow`. Quiet time, cooldown, hourly caps, conversation window, judge interval, `ambient.minConfidence` and ambient shadow mode are unchanged, and addressed turns still skip the ambient judge. Without `ai.decisions.ambient` nothing changes.
- 5d099f5: Reuse explicit Gemini caches and failure backoff across standalone text completions. Report cache creation failures without exposing prompts, credentials, or upstream error bodies. Repair imported Gemini tool-call histories while preserving signed parts and leaving other providers unchanged.
- f9ab410: Send Gemini only valid function names. Tool names that break Gemini's naming rule (for example `60s__skill__60s-life__weather`, which starts with a digit because the plugin key is `60s`) are rewritten for the request and mapped back when the model calls them, so execution and history keep the real names. Valid names and other providers are unchanged.

## 1.1.44

### Patch Changes

- f98025b: 自动输出统一的每轮 Agent 用量汇总，DEBUG 展示模型调用与首请求上下文预算。沿用 TurnTrace 汇总主回合及子回合，传递缓存写入、模型身份和用量可用性；未知或部分数据明确标记，日志不包含消息、提示词或工具内容。
- 9e21404: Ambient engagement no longer goes silent mid-conversation. After the bot speaks, the group is in a conversation with it for `conversationWindowMs` (default 3 minutes): members replying to it are answered whenever the judge agrees, without the interjection cooldown or hourly cap (a 30-per-hour safety ceiling remains). `cooldownMs` and `maxPerHour` now limit only unprompted interjections, and the judge is told when the bot is in a conversation and which lines are its own.
- de39053: Spare the ambient judge's quota: `judge` accepts a list of models tried in order when one fails or is rate limited (a failed one is passed over for a minute), an idle group is judged at most once per `judgeIntervalMs` (default 30 s), and chat lines sent to the judge are trimmed to 200 characters.
- 250b026: 补齐上下文压缩中的工具参数、思考和媒体估算，以及已披露工具输入与结构化输出 Schema 的固定预算。小窗口按可用预算收紧近期原文保留量，继续保留最少消息数与工具调用配对。拒绝截断、失败、取消、请求工具、空白或未节省 token 的摘要，避免错误摘要写入历史；无可压缩前缀时不再报告摘要成功。

  摘要检查点改为绑定实际被压缩的已持久化前缀，修复当前回合未落库时的锚点错位；对来源不明、并发变更或等待写锁期间取消的结果跳过保存，原始记录不删除。

- bff8e31: Ask DeepSeek for structured replies by instruction instead of JSON mode. Its thinking models in `response_format: json_object` mode often thought and then returned only whitespace (4 of 8 chat replies failed with "Model did not produce the requested structured output"); with the schema in the system prompt and lenient decoding of the answer, 12 of 12 succeeded. `compat.structuredOutput: native | prompt` overrides the default on any provider.
- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 3326db3: 减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

## 1.1.43

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.
- d9cc732: Accept structured replies that miss the strict format instead of failing the turn: a JSON object wrapped in a sentence or code fence, or with a bracket too many or too few, is repaired and still validated against the schema; a plain prose answer is sent as one text message. MiniMax often writes the structured answer as text, and these cases used to reach users as "Model did not produce the requested structured output".

## 1.1.42

### Patch Changes

- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

## 1.1.41

### Patch Changes

- d033076: 修复 MiniMax 结构化回复的 JSON 文本被 SDK 丢弃后误解析 thinking 的问题。保留完整 JSON 文本并继续严格校验；格式错误最多进行一次无历史、无业务工具的纠正，失败时返回固定提示，不重跑工具或放宽消息契约。

## 1.1.40

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。

## 1.1.39

### Patch Changes

- a64716a: IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
- 75e26a6: The Groq gateway preset now uses the same detector as the Groq request fixes: alias `groq` / `groqcloud`, or a `baseUrl` whose hostname is exactly `api.groq.com`. Before, the preset matched any `baseUrl` containing `api.groq.com`, so a lookalike host such as `api.groq.com.evil.example` got the preset's sdk coercion but not the request fixes.
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- cc9959e: 新增插件用的纯文本补全 `aiCompletionToken`（`zhin.js/agent` / `@zhin.js/agent/runtime`）：`completeText()` 只做一次补全、不带任何工具，复用 provider 的重试、超时和同 provider 模型降级；`untrusted` 内容按数据块渲染且不能提前闭合；传 `onBehalfOf` 时计入用量配额。`AIProvider` 新增可选的 `completeTextResult()`，返回实际作答的模型与用量。

  **行为变化**：`AIService.createAgent()` / `runAgent()` 默认不再带 `registerTool()` 注册的工具（`includeRegisteredTools` 默认改为 `false`）；需要时显式传 `includeRegisteredTools: true`。

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [fdc2148]
  - @zhin.js/logger@1.1.2

## 1.1.38

### Patch Changes

- c829031: feat(agent): 长对话压缩、已告知账本与缓存友好的提示词顺序（#730）。
  - 自动压缩改为在消息达到 `contextWindow × thresholdRatio`（新配置 `ai.agent.compaction.thresholdRatio`，默认 0.7）减去系统提示和工具定义占用时触发，插件运行时会话同样生效；以前要接近“窗口减 13k”才触发。
  - 压缩摘要会保留已告知用户的结论和承诺。
  - 新增按会话的“已告知”账本，最终回复和进度汇报共用：下一轮以 `[Already told the user]` 短块提供给模型，自动去重，最多 8 条。
  - git 状态移到系统提示最后一段，便于缓存稳定前缀。
  - 回合追踪记录 provider 返回的缓存命中 token。
- 0c17e0b: feat(agent): 上下文量化与按需披露（#729）。每轮第一次模型请求的上下文开销按段估算（系统提示、工具 schema、按需工具索引、技能目录、专家 agent 目录、已加载技能、记忆、bootstrap、历史、本轮输入），写入回合追踪的 `context_budget`，`zhin trace last` 可见。插件运行时的技能目录和专家 agent 目录改为只列名称加一行说明（最多 96 字符、40 条），技能正文在 `load_skill` 后才注入；未常驻的工具在系统提示 `## Deferred tools` 段列出名称和短说明（只含本回合有权使用的工具）。修复 `load_tool` / `load_skill` 之后模型直接给出文字回复时，agent loop 仍多发一次模型请求的问题。
- bf52b40: fix(agent): read_file / list_dir / glob / grep / edit_file / write_file 默认常驻加载（仍受本轮工具过滤与 exec 策略约束），常驻工具不再写入会话快照，不占 `maxLoadedPerSession` 名额也不会被挤出。模型直接调用本轮目录中的延迟工具时自动加载并执行，审批与权限检查照常生效；不在目录中的名字仍按未知工具拒绝，并提示使用 discover / load_tool。
- 55811d1: Provider resilience gate cases for model fallback and request timeouts (#724). The eval scripted model can register several candidate models and records the model id of each request; a `hang` fault step drives a virtual clock so timeout cases never wait in real time. The provider request timeout now accepts injected timers (`ProviderTimers`).
- bf52b40: 修复 IM 会话事件背景污染当前回复：机器人撤回自己发出的消息（如活动指示「正在处理中...」的 autoRemove）不再进入下一轮的会话事件上下文；超过 30 分钟的积压消息不再注入；事件块明确标注为背景、不要直接回答，并提示下一条用户消息才是需要回复的当前消息。
- bf52b40: 新增探索纪律 harness：model harness 支持 `explorationBudget`（连续只读探索调用达到次数后在工具结果中注入提示，默认 8，0 关闭）与 `explorationGuidance`（系统提示加入"先规划、限定目标文件"）；内置 MiniMax M 系列预设（explorationBudget 5，开启 guidance，不改 maxIterations），均可通过 `ai.agent.modelHarness` 覆盖。
- bf52b40: fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
- fc75499: feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
- 2a9d08b: Semantic memory gets a data model and write policy (#733). Entries now carry `kind` (user_fact / preference / task_state / episodic), the writing turn and its trust level, `last_used_at` and a bounded version history; existing `memory_entries` tables gain the new columns at startup without losing rows. `memory_upsert` attributes writes to the turn (the model can no longer set `source`), keeps group members out of global/platform memory and away from facts written at a higher trust level, defaults group-member writes to their own `user` scope, and gives `task_state` a bounded expiry that can be tied to a task.
- e4fbfb2: Semantic memory retrieval uses BM25 (#734). `memory_search` ranks with BM25 (word tokens plus CJK bigrams), and each turn now recalls the top-k entries relevant to the current message from the initiator's visible scopes into the turn context, bounded by `ai.memory.semantic.recall` (`topK` 5, `maxTokens` 400 by default), so memory cost per turn no longer grows with the number of entries. Users can view and forget memory about themselves with `/memory` and `/forget`; `SemanticMemoryRuntime` gains `list` / `delete` for management surfaces.
- 56bafda: feat(agent): 多模态感知预处理 `ai.multimodal.perception`。主模型收不了的图片 / 视频 / PDF，由配置的感知模型（如 Gemini Flash-Lite）经 provider 韧性层描述后，以 `[图片描述]` 等不可信外部内容注入，并写入会话历史；按字节 sha256 缓存，每回合有上限，失败回到原占位。描述会让回合进入“已接触外部内容”状态（高危动作需审批），`media_resolution` 事件带上来源模型。不配置时行为不变；配置错误时启动失败，`zhin config check` 同样报错。

  fix(agent): 模型 fallback 跳过不支持本回合媒体类型的候选（已接收的图片不会在 fallback 时悄悄变成占位）；带图片的回合仍以绑定的模型（`ai.agents.<name>.model`）为第一候选。

  deprecate（仍兼容，下一个 minor 移除）：

  - `ai.agents.<name>.priority` / `match`（含 `hasMedia` 等全部条件）从未生效：IM 消息总是交给 `ai.agents.zhin`。仍接受，启动时告警，不再因此校验报错；`zhin config check` 报 `ai.agent_routing_deprecated`，`--fix` 自动删除。`ai.routes` 的 `--fix` 改为直接删除。删除未导出的 `routing/route-matcher` / `match-rules`；`RouteMatchConfig` 与相关字段标记 `@deprecated`。
  - `ZhinAgentConfig.visionModel`（仅代码可设置的残留）：仍作为图片回合的后备候选，设置时告警。
  - `AgentCore.runVision` / `runVisionTurn`、`runAgentLoopVisionTurn` / `runAgentLoopVisionTurnRun` 及其类型：无生产调用方，标记 `@deprecated`。

- 7d2263c: Progress-aware tool-call budget (`ai.agent.toolBudget`): `maxIterations` becomes a soft budget extended while the turn makes progress (not when looping or failing), with hard step/wall-clock/token caps, opt-out automatic in-turn continuation (default: master private chat), throttled natural-language progress updates (default: private chats), and the exploration budget resetting on the same progress signal. Sub-agents use the same budget with a lower hard cap and no continuation.
- 27da0e8: Provider resilience for agent turns: classify provider errors (rate limit, timeout, 5xx, network, empty reply, malformed tool call), retry with exponential backoff honouring Retry-After, per-request timeout, fallback across `modelCandidates`, and per-model quirk presets (`emptyReplyRetries`, `requestTimeoutMs`; MiniMax M-series re-asks once on an empty reply). Configured via `ai.agent.providerResilience` with conservative defaults.
- 7d2263c: Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
- d91d21a: feat(agent): trust tiers and initiator binding (#726). Each turn now has an initiator trust level (owner / trusted_member / group_member), and its authority is that level's ceiling intersected with the configured policy. This replaces the #719 group-member special case; group-member turns keep the same restrictions, but denials now report the `trust-level` policy. Sub-agent reports, third-party plugin prompt sections, skill instructions and background group events are rendered as labelled `external_content`, and traces record the initiator trust level.
- a62acca: Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
- 9ab9ffb: fix(ai): `completeText`（压缩、上下文摘要、子 agent 摘要）与主对话路径对齐。
  - 经现有 provider 韧性层（`createResilientCompletionPort`）做错误分类、退避重试、单次超时（默认 180s）和同 provider 模型 fallback；SDK 自带重试置 0，避免重试叠加。
  - `TextCompleteOptions` 新增 `signal`、`timeoutMs`、`fallbackModels`、`resilience`；压缩与摘要调用方在有取消信号时透传，取消不再走降级摘要，也不计入自动压缩熔断。
  - 只返回正文，绝不把模型的 thinking 当摘要；内容安全 / 长度失败抛出 `CompletionFailureError`（消息即面向用户的说明）。
  - 未指定模型时优先使用 provider 配置的 `defaultModel`。
- 1280631: Gemini provider fixes (#769). Gemini chat models now default to multimodal input, and images go out as typed file parts. Gemini 3 function-call thought signatures round-trip. SAFETY, RECITATION and blocked-prompt refusals, empty MAX_TOKENS replies and MALFORMED_FUNCTION_CALL now show up as visible errors instead of empty replies. Gemini `RetryInfo.retryDelay`, `API_KEY_INVALID` and RPC statuses feed retry classification. A new provider-config `providerOptions` field carries `safetySettings` and `thinkingConfig`, and opt-in `contextCache: { mode: 'explicit' }` adds explicit Gemini `cachedContents` with TTL refresh and invalidation. The nightly real-model evals now run on Gemini (`GEMINI_API_KEY`), with new multimodal eval cases.
- bd78a94: Gemini coverage for the provider resilience layer (#724). Gemini safety blocks (SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY, RECITATION and blocked prompts) now get a polite refusal and are never retried or sent to a fallback model. A per-day Gemini quota (`QuotaFailure` `PerDay`) skips retries and falls back to the next candidate model. 504 `DEADLINE_EXCEEDED` is reported as a timeout. A new Gemini model-harness preset re-asks an empty reply or a `MALFORMED_FUNCTION_CALL` once on the same model. The nightly capability matrix gets a multimodal column, and `NIGHTLY_PROVIDER=minimax` keeps MiniMax available next to the Gemini default.
- acfaaef: Groq gateway preset for `sdk: openai-compatible` (alias `groq` / `groqcloud`, or a `baseUrl` on `api.groq.com`). Earlier reasoning is replayed as `reasoning` instead of `reasoning_content`, which Groq rejects with a 400 on the second step of every tool loop. `logprobs`, `top_logprobs`, `logit_bias` and `n` > 1 are never sent. `reasoning_effort` only goes to GPT-OSS / Qwen 3, and GPT-OSS defaults to `low` (override with `thinkingLevel`). GPT-OSS is text-only and Llama 4 Scout / Maverick take images. gpt-oss models get a 131072-token context window. A 429 on a per-day window (Groq RPD / TPD) is `quota_exhausted` and falls back without retrying, while per-minute 429s are retried after `retry-after`.
- 57ea5f7: Provider config fixes. Provider `timeout` and `maxRetries` now take effect: they override `ai.providerResilience` for that provider, below per-model harness settings. New opt-in `firstChunkTimeoutMs` / `chunkTimeoutMs` abort streams that connect but go silent, and the stall is retried and failed over like any timeout. `authScheme` now works for every scheme (`Token`, `Bearer`, `''`) on chat requests and model discovery alike. The `sdk: openai` `baseUrl` gets `/v1` on a bare proxy root, like the other OpenAI-protocol providers; `compat.appendV1: false` keeps the old as-written behaviour. `compat.supportsDeveloperRole: false` sends `system` instead of `developer` to reasoning models. OpenAI refusals now surface as a content-policy message instead of an empty reply. MiniMax `baseUrl` values ending in `/anthropic` or naming only a host are completed to `/anthropic/v1`, and `@ai-sdk/minimax` is declared as an optional peer dependency. `compat.supportsReasoningContent` and `compat.toolCallsInAssistant` are deprecated no-ops, and gateway presets no longer set them.
- 6e035e5: Provider fixes from the #736 audit (PR C):

  - Tool JSON Schemas go to every provider as written. `enum`, `const`, `anyOf`/`oneOf`, nullable types, `integer`, `format` and bounds are kept, and tool-call arguments are validated against the same constraints. Gemini gets a `string` type on untyped fields.
  - `thinkingLevel` (provider config, or per call) is sent as the AI SDK `reasoning` option. A thinking setting in `providerOptions` wins, and MiniMax keeps adaptive thinking. New `maxOutputTokens` provider option (default 8192).
  - Assistant turns are stored and replayed thinking-first, so a turn with Anthropic thinking + text + tool_use stays valid. Gemini `thoughtSignature` on thought and text parts round-trips.
  - OpenAI GPT-4o and later, the o1/o3/o4-mini models, and Claude 3+ models default to image input.

- 57ea5f7: openai-compatible / Ollama transport fixes. Streamed requests now ask for usage (`stream_options.include_usage`), so gateways and Ollama report token counts again (opt out with `compat.includeUsage: false`). `baseUrl` no longer gets `/v1` forced onto a path that already names an API version (`/api/v3`, `/api/paas/v4`, `/v1beta/openai`) or ends in `/openai`; bare hosts still get `/v1`, and `compat.appendV1` forces either behaviour. Image generation and model discovery use the same base URL as chat. Ollama now plans for `OLLAMA_CONTEXT_LENGTH` or 4096 tokens instead of 128k unless `contextWindow` is set, and startup warns when it is missing. The OpenAI prompt-cache key is no longer emitted under a key openai-compatible ignores; `compat.promptCacheKey: true` sends `prompt_cache_key` as a body field.
- 55db42d: Provider error handling fixes from the provider audit (#724). Error parts inside a 200 stream (Anthropic `overloaded_error`, OpenAI `server_error`, Responses `rate_limit_exceeded`) keep their message, type and code instead of becoming "[object Object]", so they are retried and re-routed like the HTTP error they stand for. One shared context-overflow detector now serves both the resilience layer and compaction, and recognises the Gemini, Vertex and Anthropic wordings. A DeepSeek `insufficient_system_resource` finish is retried rather than reported as a malformed tool call. OpenAI's `retry-after-ms` header is honoured. Out-of-credit errors (402, OpenAI `insufficient_quota`, "credit balance is too low", "Insufficient Balance") are no longer retried, skip fallback candidates on the same provider alias (same key, same account), and tell the user the balance ran out. Tool-call arguments that are not valid JSON keep their raw text, and validation quotes it back to the model instead of reporting missing fields against `{}`.
- f48ba72: `deferredTools.alwaysLoadedTools` now extends the default resident tools (`ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`) instead of replacing them, so an override no longer hides `discover`/`load_tool`. Set `deferredTools.alwaysLoadedMode: 'replace'` to restore the previous replace behaviour.
- 3237f63: test(ai): Gemini `baseUrl` for a pass-through proxy is covered end to end (generateContent, streamGenerateContent, cachedContents create/delete, model list; optional `headers` on every request); docs for zh/en; nightly evals read the `GEMINI_BASE_URL` repository variable.
- 8e26cf1: 配置面收敛（#735）：弃用运行时未读取的 `ai.agent.maxSkills`、`policyDenialStopAfter`、`deferredToolMaxResults`、`taskExecApprovalMode`（启动告警，`zhin config check --fix` 可移除），新增《默认行为规范》权威文档与开关清单门禁。
- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

## 1.1.37

### Patch Changes

- b36452a: Add an optional TypeSafe AI Jev structured-decision provider with typed Choice, Score and Noul results, bounded cancellation-aware requests, response validation, and generation-owned cleanup. Add explicit TypeSafe setup and local doctor checks; preserve chat configuration, store credentials as environment references, and begin recommendation in shadow mode.

## 1.1.36

### Patch Changes

- b9b3953: Serialize first active-session creation by session key within each repository instance, preventing concurrent opens from returning separate epochs. Keep different keys independent and release the key after storage failures so retries can recover.
- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。

## 1.1.35

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- 95b24d4: Skip unsupported directory handle flushes on Windows while retaining file flushes and POSIX directory durability, and prevent Agent message persistence from issuing a second insert when a SQL dialect does not return an inserted id.

## 1.1.34

### Patch Changes

- 1414ccb: Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- 1fa1c09: Replace the process-wide proxy URL and fetch cache with provider-owned `AiHttpTransport` instances. Model discovery, text generation, image generation, and generated-image downloads now use the owning provider's transport, and disposing `AIService` waits for proxy agents to close.
- 75920c4: Replace the process-global LLM provider, transport, live-model resolver, and language-model caches with owner-scoped `LlmApiRuntime` instances. Agent loops and compaction now require an explicit completion port; AIService, ZhinAgent, subagents, deferred workers, and the CLI composition root retain and inject their own runtime. Remove the global registration, lookup, resolver, cache-reset, and test-reset APIs.
- cd4f240: Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
- 4bc3d3c: Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
- 77d5a46: Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
- 698f16f: Replace ambiguous command approval modes with `ask`, `auto`, and `bypass`, add a fail-closed review Agent, and scope remembered human decisions to the current invocation, sender, or conversation.
- Updated dependencies [9110ab8]
  - @zhin.js/logger@1.1.1

## 1.1.33

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/logger@1.1.0

## 1.5.9

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.

## 1.5.8

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.

## 1.5.7

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- Updated dependencies [09b14d6]
  - @zhin.js/logger@1.0.77

## 1.5.6

### Patch Changes

- 5969c5b: Preserve shared-session participant attribution through conversation persistence and compaction, add explicit turn intent routing, expose the compatible supersede/FIFO overlap policy, and retain causal participants on tool journal events.
- 2f786bd: Replace text-only IM context and metadata-based quote handling with canonical
  conversation events, scoped reference resolution, explicit Endpoint content
  ports, and typed multimedia outcomes. Conversation notices are projected as
  untrusted context data rather than model-authority system instructions.
  The process-global passive-group buffer is removed: prior inbound conversation messages
  are now consumed from the same event store and cursor, with the current Turn
  message excluded from its own context projection.
  The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
  and topic-window configuration are removed; `ContextRepository` is the only
  Agent conversation-history authority.
- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

## 1.5.5

### Patch Changes

- 0b8b5bd: Fix Anthropic-protocol reasoning round-trip (MiniMax / Claude): do not re-send unsigned thinking parts that trigger AI SDK `unsupported reasoning metadata` warnings. Capture Anthropic thinking signatures when present; keep openai-compatible DeepSeek placeholder behavior unchanged.

## 1.5.4

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau

## 1.5.3

### Patch Changes

- 0e73866: Remove the classic Message-based Collaboration Cell execution seam. IM now
  serves only as canonical turn ingress and reply delivery; Agent-to-Agent work is
  executed by the Orchestration Kernel through `local` Agent bindings or
  `remote_mesh` A2A agents.

  Remove peer mention routing, synthetic Message bridging, Cell prompt injection,
  IM projection executors, `internal_room`, and the dead Collaboration outbound
  parser APIs. Orchestration executor and persisted source parsing now fail closed
  for removed legacy shapes instead of silently changing execution domains.

  `AITriggerConfig.peerMode` and the public `internal_room` / `im_projection`
  executor variants are removed. Local task `assignedTo` values now name an Agent
  binding; remote tasks name an A2A Agent.

## 1.5.2

### Patch Changes

- c50aca3: refactor(ai): simplify AIProvider interface to completeText

  Remove chat() and chatStream() from AIProvider interface along with
  ChatCompletionChunk and ChatCompletionChunkChoice types. Add completeText()
  for lightweight text completion (system + user -> assistant text) used by
  compaction, topic analysis, and summarization. SdkProviderAdapter now
  implements completeText via ai-sdk transport. conversation-memory and
  context-manager updated to use completeText.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 61bfc1c: Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

  Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.

- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- 05befc1: Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- a7df753: refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

  **AI 层**

  - `preprocessInboundMedia` / `buildSubagentInboundTask` 入参收窄为 canonical 单形态（ContentPart union 臂删除）。
  - 删除死面：`INBOUND_MEDIA_PARTS_EXTRA_KEY`、`userMessageToFilterText`、tool-policy `always/once/never` 别名、ContentPart `face` 变体、`describeVisionPartsAsText`；`processMultimodal` 等公网 shim 标 `@deprecated`（下个大版本删除）。
  - 测试桥归位：`createOpenAiCompletionsStreamFn` 及 wire 转换器移出公共 API（入 agent 测试目录）；`openai-bridge` 只剩 `assistantText`；`legacy-tool-bridge.ts` 正名 `tool-bridge.ts`。
  - 类型修复：`ModelApi = 'ai-sdk' | (string & {})`；`AgentTool.execute` 与实现对齐为三参（删 `as` 强转）。

  **core 层**

  - 死导出整批删除（均零引用）：`AITool`、撞名 `ToolDefinition`、`NoticeType/RequestType`、Interactive 别名全簇、`PermissionService`/`ConfigService` 别名、`getLiveEndpoint`、`qrcode-segment` 整文件；热路径不再自用 deprecated 别名（`resolveInteractiveSegments` 删除，改 `resolveKeyboardSegments`）。
  - im-contract 双 legacy 格式化函数二合一（`formatLegacyMessageRef` 为唯一公开 API）；ai-outbound 的 legacy `kind` 回退分支删除。

  **agent 层**

  - `ZhinAgentPrivate` 58 → 43 成员：死成员/零读取成员删除，deferred 族收敛为 `DeferredTurnState` 模块，三份手工镜像改为权威接口 Pick，`readonly` 名不副实纠偏，AutoContinueHost 单参化。
  - 4 个值导入循环解环（纯函数下沉 collab-utils / ask-user-format / memory-layers）；prompt 双轨收敛（3 个零调用导出 + 死分支删除）；死文件删除；`sandbox-enhanced` 挂 `@deprecated` 摘出公共导出；`tokenUsageToLegacy` 合一、`AGENT_ROLE_CONFIGS` 拆表。

  BREAKING CHANGE：上述删除项均为公共导出面的收窄，详见各条。

## 1.5.1

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76

## 1.5.0

### Minor Changes

- 1f23bf6: feat(ai): agentLoop harness 四项架构级优化

  - **事件不可变**：`agent_end` 发快照副本，删除 `finally` 清空本地数组（此前已发出事件的 `messages` 会在生成器恢复后被置空，属定时炸弹）。
  - **增量历史修复**：新增 `createIncrementalRepair`——修复不变量由 loop 持有，按最后一个 user 消息为边界，多轮迭代只重修活跃尾部（此前 `repairAgentMessagesForLlm` 每次 LLM 调用都 O(n) 全量扫描）；`Context.preRepaired` 让桥序列化跳过重复修复，外部调用方仍享安全默认。
  - **并行工具结果按调用序落列**：tiered/parallel 桶并发执行不变，toolResult 统一按声明顺序写入消息流（此前按完成先后），对齐 Anthropic 类对块顺序敏感的协议。
  - 清理：`toolExecution` 恒等三元死代码、`maxRecompletePerIteration` 每轮计数的语义注释。

- 5b94d9c: refactor!: 清除 AI 双栈残留（BREAKING，无兼容层）

  - **删除 legacy 直连 HTTP Provider 栈**：`@zhin.js/ai` 的 `providers/` 目录（OpenAI/Anthropic/Ollama/DeepSeek/Google/Cloudflare/Zhipu/Moonshot 及 openai-sse/base）整体移除。生产 provider 实例早已统一经 `createSdkProviderAdapter`（AI SDK 传输）创建，旧栈为零调用死代码；Provider 类与 `OpenAIConfig` 等配置类型导出同步删除。图像生成走 `SdkProviderAdapter.generateImage`（ai-sdk-image 桥）。
  - **删除已死的 collaboration 入站管线**：`createInboundTurnPipeline` 及其 enrich/route/execute/outbound-stage、`registerAiTrigger`、`extractMediaParts`（旧 `$content` 形状读取）、`processMultimodalTurn` 主实现。`ZhinAgent.processMultimodal` 保留为薄 shim（委托 canonical 路径）；`createInboundTurnPipeline` 保留薄门面（内部走 `agent.process`）。
  - **媒体面统一到 canonical MediaRef**：新增 `normalizeMediaRefsToPayloads`（url fetch / path 读盘 / base64 直取 / 大小预检），orchestrator（bootstrap-executors）、subagent-inbound、analyze-media-tool 全部改吃 canonical refs；`payloadToVisionPart` 产出 `MediaContentBlock`；`normalizeMatchRules` 拆分为独立模块 `routing/match-rules`（行为不变）。

  迁移：若仍从 `@zhin.js/ai` import 具体 Provider 类（如 `OpenAIProvider`），改为配置驱动（`ai.providers` + `createSdkProviderAdapter`）。

### Patch Changes

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

## 1.4.8

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

## 1.4.7

### Patch Changes

- f346346: fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层

## 1.4.6

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

## 1.4.5

### Patch Changes

- Updated dependencies [cc5c94d]
  - @zhin.js/logger@1.0.75

## 1.4.4

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/logger@1.0.74

## 1.4.3

### Patch Changes

- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5cc9c03]
  - @zhin.js/logger@1.0.73

## 1.4.2

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72

## 1.4.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身

## 1.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

## 1.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71

## 1.2.0

### Minor Changes

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

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.

## 1.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 1.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化

## 1.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70

## 1.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69

## 1.1.26

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68

## 1.1.25

### Patch Changes

- @zhin.js/logger@0.1.67

## 1.1.24

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [f19d2e0]
  - @zhin.js/logger@0.1.66

## 1.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/logger@0.1.65

## 1.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64

## 1.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
  - @zhin.js/logger@0.1.63

## 1.1.20

### Patch Changes

- @zhin.js/logger@0.1.62

## 1.1.19

### Patch Changes

- @zhin.js/logger@0.1.61

## 1.1.18

### Patch Changes

- @zhin.js/logger@0.1.60

## 1.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
  - @zhin.js/logger@0.1.59

## 1.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
  - @zhin.js/logger@0.1.58

## 1.1.15

### Patch Changes

- efad4ef: fix: 幻觉优化
  - @zhin.js/logger@0.1.57

## 1.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
  - @zhin.js/logger@0.1.56

## 1.1.13

### Patch Changes

- @zhin.js/logger@0.1.55

## 1.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54

## 1.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53

## 1.1.10

### Patch Changes

- @zhin.js/logger@0.1.52

## 1.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
  - @zhin.js/logger@0.1.51

## 1.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
  - @zhin.js/logger@0.1.50

## 1.1.7

### Patch Changes

- d73a3b7: fix: ai error
  - @zhin.js/logger@0.1.49

## 1.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48

## 1.1.5

### Patch Changes

- @zhin.js/logger@0.1.47

## 1.1.4

### Patch Changes

- @zhin.js/logger@0.1.46

## 1.1.3

### Patch Changes

- @zhin.js/logger@0.1.45

## 1.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/logger@0.1.44

## 1.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43

## 1.1.0

### Minor Changes

- 8280fe7: feat: ModelRegistry 模型自动发现与智能选择

  - 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
  - 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
  - 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
  - providers.models 配置现为可选 — 框架自动发现并按评分排序
  - 新增 chatModel / visionModel 配置项，留空自动选择最优模型
  - 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
  - Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎

### Patch Changes

- @zhin.js/logger@0.1.42

## 1.0.18

### Patch Changes

- @zhin.js/logger@0.1.41

## 1.0.17

### Patch Changes

- 20ab379: fix: ai 优化
  - @zhin.js/logger@0.1.40

## 1.0.16

### Patch Changes

- @zhin.js/logger@0.1.39

## 1.0.15

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38

## 1.0.14

### Patch Changes

- @zhin.js/logger@0.1.37

## 1.0.13

### Patch Changes

- @zhin.js/logger@0.1.36

## 1.0.12

### Patch Changes

- @zhin.js/logger@0.1.35

## 1.0.11

### Patch Changes

- @zhin.js/logger@0.1.34

## 1.0.10

### Patch Changes

- @zhin.js/logger@0.1.33

## 1.0.9

### Patch Changes

- @zhin.js/logger@0.1.32

## 1.0.8

### Patch Changes

- @zhin.js/logger@0.1.31

## 1.0.7

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
  - @zhin.js/logger@0.1.30

## 1.0.6

### Patch Changes

- 63b83ef: fix: 自定义 schema
  - @zhin.js/logger@0.1.29

## 1.0.5

### Patch Changes

- @zhin.js/logger@0.1.28

## 1.0.4

### Patch Changes

- @zhin.js/logger@0.1.27

## 1.0.3

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
  - @zhin.js/logger@0.1.26

## 1.0.2

### Patch Changes

- @zhin.js/logger@0.1.25

## 1.0.1

### Patch Changes

- @zhin.js/logger@0.1.24
