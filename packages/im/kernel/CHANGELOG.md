# @zhin.js/kernel

## 1.4.0

### Minor Changes

- 2534b1d: 适配器不再替模型或用户在本机请求内网地址（#1250 第 46 批 `outbound-media-ssrf`）。

  - 出站媒体在本机下载时统一走 `@zhin.js/core` 新增的 `fetchOutboundMedia()`：只下载公网 HTTPS；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝；连接只连已校验的地址（防 DNS 重绑定，也不经环境代理重新解析）；重定向逐跳重新校验；默认最大 25 MB、30 秒。原先 Agent 回复里的任意 `http(s)` 媒体地址都会被直接 `fetch`，内网响应（例如 `http://169.254.169.254/…`）会作为图片或文件发进聊天。
  - 涉及：飞书 / 企业微信 / 公众号的素材上传，iPad 微信图片（https 地址也不再交给 SDK 在本机下载），KOOK 卡片图片与 `uploadMedia`，Slack 文件，Discord 附件（不再让 discord.js 下载 URL），邮件附件（不再让 nodemailer 下载 URL），微信 iLink 媒体，ICQQ 媒体（不再让 SDK 下载 URL），QQ Markdown 图片尺寸探测。平台服务端自己下载 URL 的发送方式不变。
  - 地址被拒时这条消息照常发出，该媒体换成说明文字（如「[图片未发送：媒体地址不被允许]」）；日志记 `op: outbound_media_url_blocked`（超过大小为 `outbound_media_too_large`）和主机名，不记完整地址。iPad 微信、ICQQ 的 https 媒体现在先在本机经上述校验下载，再以字节交给 SDK。
  - 行为变化：不只是 Agent 回复，插件或指令主动发送的媒体，只要地址是内网、回环、链路本地、云元数据地址或 `http:`，且由适配器在本机下载，现在同样换成说明文字，不再下载发送；需要发送这类内容时请先读成字节（base64）再发。
  - 下载有总时限（默认 30 秒，含 DNS 解析与排队；故意慢回的 DNS 不会拖过时限），本机同时最多 8 个出站媒体下载，其余排队，排队中同样受取消与时限控制；调用方传入的请求头（如 `Authorization`）只发给首个地址的同源（协议 + 主机 + 端口），跨源重定向时丢弃；TLS SNI 去掉主机名末尾的点。
  - 飞书 / 企业微信 / 公众号 `resolveMediaBinary()` 的 `MediaResolveOptions.download` 保留但标为 `@deprecated` 且不再生效：URL 一律经 `fetchMedia`（默认 `fetchOutboundMedia`）下载，调用方不能借它绕过 SSRF 校验；请改用 `fetchMedia`。
  - QQ 图片尺寸探测遇到忽略 `Range`、返回整图的服务器时按探测失败处理（降级为不带尺寸），不算地址被拒，日志降为 debug；KOOK `uploadMedia` 识别大写的 `HTTP(S)://` 地址。
  - 入站识图、模型引用媒体的下载（`fetchUrlAsBase64`）改用同一套固定 IP 下载：此前预检 DNS 后由全局 `fetch` 连接，连接时会重新解析（DNS 重绑定，或在 `NODE_USE_ENV_PROXY=1` 时交给代理解析）。
  - SSRF 地址规则、固定 IP 传输和 `fetchPublicMediaBytes()` 移到 `@zhin.js/kernel`（`@zhin.js/agent` 原导出保持不变）；`fetchPublicMediaBytes()` 新增可选 `allowedDomains`、`headers`，`NodeNetworkTransport` 可注入 `lookup` / `connect`。

## 1.3.0

### Minor Changes

- f370ec5: 认领码（ADR 0060 §3.3，zhinjs/zhin#1250 第 23 批）：

  - 在私聊中直接发送「认领 <码>」/「claim <码>」即可认领，不再需要适配器的命令前缀（带前缀的 `#认领 <码>` 仍然有效）。此前配了 `commandPrefix` 的账号上，按提示发送的消息没有匹配到命令，被当作普通聊天交给了 AI。
  - 认领开启期间（尚无全局 owner），含有当前认领码的消息（不论写法）在入站最早处由认领处理器接手：不交给 AI，不写入会话历史、trace、日志与诊断（日志与消息事件里只显示 `认领 ***`）；群聊里的码立即作废；被丢弃的带码消息（其他机器人贴出、会话未就绪）也作废码；含码的原生 `platform.receive` 事件不派发给原生 Handler。只有整条文本恰好代表一个码时才授予（`认领 <码>`、`认领:码`、`認領 码`、全角、码被空格或 `-` 拆开、末尾标点都算）；含码但还带了别的文字（`认领 码 谢谢`、码藏在长单词里）只作废码并提示，不授予，这样一条消息只比较一个候选，错误次数限制仍然有效。私聊里「认领 <一个词>」但码不对时回复错误并计次。不含当前码的消息（如群聊「claim it」）照常进 AI；已有 owner 后完全不拦截。
  - 会话记录（`conversation_events`、Agent 会话消息）与 trace 的写入端加了兜底：只把当前开启的认领码写成 `***`，没有开启的认领时不做替换。
  - `zhin status`、启动日志、「需要你处理」与自助提示的用法改为「在私聊中直接发送」。
  - 新增公开导出：`@zhin.js/kernel` 的 `matchChatOwnerClaimText()` / `containsChatOwnerClaimCode()` / `registerChatOwnerClaimCode()` / `redactChatOwnerClaimText()`；`@zhin.js/core/runtime` 的 `InboundSecretGuard`（`match` / `inspectNative`）/ `InboundSecretMatch`（`handle` / `discard`）与 `ImRuntimeOptions.inboundSecret`。

### Patch Changes

- 48dc650: 认领码入站保护加固（ADR 0060 §3.3，zhinjs/zhin#1250 第 24 批，#1289 复审建议）：

  - 自己账号发出的带码消息（`origin === 'self'`，自回声）被丢弃时也作废认领码，与会话未就绪、其他机器人、成员账号、去重失败几条丢弃分支一致。
  - 写入端兜底登记表改为挂在 `globalThis` 的 `Symbol.for('zhin.kernel.chat-owner-claim-codes')` 上：项目里装了两份 `@zhin.js/kernel` 时，一份登记的码另一份也能脱敏。
  - `redactChatOwnerClaimText()` 只替换命中的那一段：只有 NFKC 形式命中时（全角码）不再把整条文本换成 NFKC 形式，其它字符保持原样。
  - 码比较时忽略的字符扩为空白、`-`、格式字符 `\p{Cf}`（U+2061–2064、U+200E/200F、U+180E 等）与组合符号 `\p{M}`（U+034F、U+FE0F 等）；认领的精确比较使用同一口径（新增 `foldChatOwnerClaimText()`），码中间夹着可见标点（`ABCD.2345`）时两边都不认作该码，能授予的文本一定会被识别为含码。
  - 原生事件检查扩大到 `message.receive` 以外的所有 Endpoint 事件（`platform.receive` 及其它原生侧边事件、通知、请求附言、系统事件），含码则不记录、不派发。检查不再截断：读遍字符串、数字、字节缓冲（按 UTF-8）、数组、对象、Map 与 Set，超出预算（深度 32、5 万个值、400 万字符）、读取抛错或字节缓冲（含 `SharedArrayBuffer` 及其视图）无法解码时按含码处理（fail-closed），并按事件名限频记 warn（同一事件名 10 分钟至多一条，不带载荷内容）。被扣下的通知、请求、系统事件确实含码时还会作废码（新增 `InboundSecretGuard.discardNative`）：平台上其他人（如看入群附言的管理员）已经看到；`platform.receive` 只扣下不作废。每个字符串只折叠一次，仅非 ASCII 时做 NFKC（新增 `createChatOwnerClaimCodeScanner()`）。

- 7288cd1: #1250 第 26 批：`redactSecretText` 补充脱敏 JSON 字段（`"token":"…"`、`"api_key": "…"`）、YAML / 文本字段（`api_key: …`、`password: '…'`，纯数字值如 `max_tokens: 100` 不受影响）、URL 查询参数 `?key=…` / `&key=…`，以及 Telegram Bot API 路径 `/bot<id>:<token>/`。

## 1.2.0

### Minor Changes

- 816c3f3: #1250 第 18 批：入站消息结局与群聊插话（ADR 0061 P1/P2/P5、ADR 0062 §23）。

  - 每条入站消息在处理结束时恰好得到一个结局（`InboundOutcomeLedger`，`finally` 提交）：命令、中间件、处理器、交互态、准入、去重、近似指令、发送失败与 Agent 入口都上报候选，按优先级取主结局，其余记为 facets；抛错记为 `internal_error` 并带错误号（`err_` + 12 位十六进制，`createErrorId` 移入 `@zhin.js/logger`），原样重新抛出。结局不存消息正文，管理员补充 ≤ 200 字并按决策审计同一套规则脱敏（`redactDecisionPayload` 下移到 `@zhin.js/kernel`，Agent 原名再导出）。
  - 结局保存在进程内（2000 条 / 24 小时，静默结局每会话每分钟超过 30 条时聚合），附在消息诊断记录上（`RuntimeMessageDiagnostic.outcome`），并写一行实例日志 `op=inbound_outcome`。
  - 没被 @、不是指令、本群又没开插话的群消息记 `not_addressed`（`unaddressed-message-no-record`）；旁听判定不插话记 `ambient_silent`；控制面 / 禁言记 `filtered_by_policy`。
  - 群插话纳入功能开关：`ai.trigger.ambient.conversations` 是全局默认值，适配器 / 账号 / 会话层开关存进 `feature_overrides`；群管理员可在群里发「功能 关闭 / 开启 / 重置 插话」（`ambient-allowlist-only`）。
  - 交互态：提问可声明 `answeredBy: 'target' | 'anyone'`（默认 `target`）；回答无效时提示最多重发一次。提醒插件的确认步骤只接受「确认」/「取消」，期间的闲聊不再让整段确认提示反复出现（`reminder-confirm-captures-chat`）。
  - group-suite：`mypoints` 增加中文别名「积分」「我的积分」，`rank` 增加「排行」「积分排行」（`group-suite-zh-alias-partial`）。

## 1.1.7

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

- Updated dependencies [e1fda87]
  - @zhin.js/schedule@1.1.5

## 1.1.6

### Patch Changes

- Updated dependencies [bc6ccb1]
  - @zhin.js/schedule@1.1.4

## 1.1.5

### Patch Changes

- 070bb6b: Skip the assistant-profile heartbeat while HEARTBEAT.md is missing or has no task, the way the kernel scheduler's own heartbeat already did. The default heartbeat prompt only reads that file, so each idle run was a wasted model turn (about 40k prompt tokens every 30 minutes). Heartbeats with a custom prompt still run.

## 1.1.4

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/schedule@1.1.3
  - @zhin.js/logger@1.1.2

## 1.1.3

### Patch Changes

- 2dfe5fa: 修复 ScheduleEngine every/at 任务回调异常未被捕获、超长延时被 Node 截断立即触发、at 回调内同 id 重注册被误删；修复微信公众号 access_token 并发刷新互相顶掉、expires_in 缺失时永不过期。
- 2dfe5fa: ScheduleEngine 的 pause/resume 现在同样作用于 every/at 任务（暂停期间不触发、恢复后按原周期继续、不补发）；飞书长连接重复 connect() 时清理旧的健康检查定时器。

## 1.1.2

### Patch Changes

- Updated dependencies [b9b3953]
  - @zhin.js/schedule@1.1.2

## 1.1.1

### Patch Changes

- b853dba: Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
- 203ad34: Remove process-global expression and proxy caches from Kernel evaluation. Every evaluation now compiles independently and owns its proxy identity map for the lifetime of one sandbox, so unrelated runtimes cannot share hidden evaluator state.
- e6c5113: Remove the unused Kernel PluginBase, mutable Feature registry, string-based dependency injection, and prototype extension registry. Plugin lifecycle now belongs solely to the generation-owned Plugin Runtime, while capability discovery and projection belong to Feature Kit.
- Updated dependencies [9110ab8]
- Updated dependencies [9a32872]
- Updated dependencies [0b95351]
  - @zhin.js/logger@1.1.1
  - @zhin.js/schedule@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/logger@1.1.0
  - @zhin.js/schedule@1.1.0
  - @zhin.js/schema@1.1.0

## 1.0.8

### Patch Changes

- Updated dependencies [09b14d6]
  - @zhin.js/logger@1.0.77

## 1.0.7

### Patch Changes

- 92b0dd7: refactor: complete plugin dual-track elimination (Slices 3–4)

  Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
  collaboration, media, memory, prompt, and orchestrator modules); dead branches
  collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
  all packages.

  Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
  (`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
  stack directly.

  Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
  service bus is superseded by Scope + Token (introduced in Slice 2).

  Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
  `AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
  no longer depends on dead `init/` modules.

  Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
  update agent README to remove `initAgentModule` usage examples.

## 1.0.6

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/schedule@0.0.5
  - @zhin.js/schema@1.0.73

## 1.0.5

### Patch Changes

- Updated dependencies [5691aba]
  - @zhin.js/schema@1.0.72
  - @zhin.js/schedule@0.0.4

## 1.0.4

### Patch Changes

- Updated dependencies [cc5c94d]
  - @zhin.js/schedule@0.0.3
  - @zhin.js/logger@1.0.75

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/logger@1.0.74
  - @zhin.js/schedule@0.0.2

## 1.0.2

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/logger@1.0.73
  - @zhin.js/schedule@0.0.1
  - @zhin.js/schema@1.0.71

## 1.0.1

### Patch Changes

- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72

## 1.0.0

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.1.1)

## 0.1.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71

## 0.1.0

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

## 0.0.50

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 0.0.49

### Patch Changes

- 3735e96: fix: 智能家居控制

## 0.0.48

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/schema@1.0.70

## 0.0.47

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 0.0.46

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/schema@1.0.69

## 0.0.45

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68
  - @zhin.js/schema@1.0.68

## 0.0.44

### Patch Changes

- @zhin.js/logger@0.1.67
- @zhin.js/schema@1.0.67

## 0.0.43

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/logger@0.1.66
  - @zhin.js/schema@1.0.66

## 0.0.42

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/logger@0.1.65
  - @zhin.js/schema@1.0.65

## 0.0.41

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/schema@1.0.64

## 0.0.40

### Patch Changes

- @zhin.js/logger@0.1.63
- @zhin.js/schema@1.0.63

## 0.0.39

### Patch Changes

- @zhin.js/logger@0.1.62
- @zhin.js/schema@1.0.62

## 0.0.38

### Patch Changes

- @zhin.js/logger@0.1.61
- @zhin.js/schema@1.0.61

## 0.0.37

### Patch Changes

- @zhin.js/logger@0.1.60
- @zhin.js/schema@1.0.60

## 0.0.36

### Patch Changes

- @zhin.js/logger@0.1.59
- @zhin.js/schema@1.0.59

## 0.0.35

### Patch Changes

- @zhin.js/logger@0.1.58
- @zhin.js/schema@1.0.58

## 0.0.34

### Patch Changes

- @zhin.js/logger@0.1.57
- @zhin.js/schema@1.0.57

## 0.0.33

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
  - @zhin.js/logger@0.1.56
  - @zhin.js/schema@1.0.56

## 0.0.32

### Patch Changes

- @zhin.js/logger@0.1.55
- @zhin.js/schema@1.0.55

## 0.0.31

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - @zhin.js/schema@1.0.54

## 0.0.30

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53

## 0.0.29

### Patch Changes

- @zhin.js/logger@0.1.52
- @zhin.js/schema@1.0.52

## 0.0.28

### Patch Changes

- @zhin.js/logger@0.1.51
- @zhin.js/schema@1.0.51

## 0.0.27

### Patch Changes

- @zhin.js/logger@0.1.50
- @zhin.js/schema@1.0.50

## 0.0.26

### Patch Changes

- @zhin.js/logger@0.1.49
- @zhin.js/schema@1.0.49

## 0.0.25

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48

## 0.0.24

### Patch Changes

- @zhin.js/logger@0.1.47
- @zhin.js/schema@1.0.47

## 0.0.23

### Patch Changes

- @zhin.js/logger@0.1.46
- @zhin.js/schema@1.0.46

## 0.0.22

### Patch Changes

- @zhin.js/logger@0.1.45
- @zhin.js/schema@1.0.45

## 0.0.21

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
  - @zhin.js/schema@1.0.44

## 0.0.20

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43

## 0.0.19

### Patch Changes

- @zhin.js/logger@0.1.42
- @zhin.js/schema@1.0.42

## 0.0.18

### Patch Changes

- @zhin.js/logger@0.1.41
- @zhin.js/schema@1.0.41

## 0.0.17

### Patch Changes

- @zhin.js/logger@0.1.40
- @zhin.js/schema@1.0.40

## 0.0.16

### Patch Changes

- @zhin.js/logger@0.1.39
- @zhin.js/schema@1.0.39

## 0.0.15

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38

## 0.0.14

### Patch Changes

- @zhin.js/logger@0.1.37
- @zhin.js/schema@1.0.37

## 0.0.13

### Patch Changes

- @zhin.js/logger@0.1.36
- @zhin.js/schema@1.0.36

## 0.0.12

### Patch Changes

- @zhin.js/logger@0.1.35
- @zhin.js/schema@1.0.35

## 0.0.11

### Patch Changes

- @zhin.js/logger@0.1.34
- @zhin.js/schema@1.0.34

## 0.0.10

### Patch Changes

- b00b6c9: fix: 代码逃逸拦截增强
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33

## 0.0.9

### Patch Changes

- 7d09e5e: fix: 代码安全漏洞修复
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32

## 0.0.8

### Patch Changes

- @zhin.js/logger@0.1.31
- @zhin.js/schema@1.0.31

## 0.0.7

### Patch Changes

- @zhin.js/logger@0.1.30
- @zhin.js/schema@1.0.30

## 0.0.6

### Patch Changes

- @zhin.js/logger@0.1.29
- @zhin.js/schema@1.0.29

## 0.0.5

### Patch Changes

- @zhin.js/logger@0.1.28
- @zhin.js/schema@1.0.28

## 0.0.4

### Patch Changes

- @zhin.js/logger@0.1.27
- @zhin.js/schema@1.0.27

## 0.0.3

### Patch Changes

- @zhin.js/logger@0.1.26
- @zhin.js/schema@1.0.26

## 0.0.2

### Patch Changes

- @zhin.js/logger@0.1.25
- @zhin.js/schema@1.0.25

## 0.0.1

### Patch Changes

- @zhin.js/logger@0.1.24
- @zhin.js/schema@1.0.24
