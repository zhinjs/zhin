# @zhin.js/adapter

## 1.3.0

### Minor Changes

- c6b5563: `zhin.config.yml` 的 `<适配器>.endpoints` 与已保存账号不一致时给出提示并可显式处理（#1250）。`endpoints` 只在还没有账号快照时作为首次种子，之后以数据库中的加密账号文档为准；此前在 yml 里增删账号既不生效也没有提示。

  - 启动与配置重载时比对 yml 与已保存账号（按账号 id；字段比较不解析 `${VAR}`，引用只与同一引用相等，只输出路径不输出值），有差异时记一条 `endpoint_config_drift` 警告，并进入 Console「需要你处理」（新条目类型 `endpoint.config-drift`，需该适配器实例的 `endpoint.view`）。
  - 新增适配器账号 RPC：`plugin.<实例>.endpoint-drift`（只读，`endpoint.view`）、`endpoint-import { id, expectedRevision, expectedGeneration?, start? }`（把 yml 账号写入已保存账号，`${VAR}` 保存为引用、启动时才解析）、`endpoint-writeback { ids }`（把已保存账号写回 yml，密钥只写成 `${VAR}` 引用或占位引用，绝不写明文）。两者都需要 `endpoint.manage` 并进入审计；`endpoint-writeback` 会改写 `zhin.config.yml`，因此**还需要全局的 `ops.config.write`**（与其他配置写入相同），只有适配器级 `endpoint.manage` 的账号运维者会被拒绝（403）。
  - 新增 `Adapter.configDrift()` / `importConfigured()` / `writeBackConfigured()`、`endpointConfigSourceToken` 与 `EndpointConfigSource` 等比对工具；实例提供配置文件端口与 `${VAR}` 账号引用解析器（`endpointSecretResolverToken`）。
  - 账号启动失败原因：`startFailure` 新增 `category`（auth / network / timeout / config / process_exit / unknown）与只由类别和错误码组成的 `message`；core Endpoint 列表与 Console `endpoint.list` / `endpoint.info` 新增 `lastError { category, message, at }`（与 MCP 失败形状一致）。`endpoint_start_failed` 警告日志带类别和脱敏后的原因（屏蔽该账号凭据、URL 凭据与查询串、类令牌片段），启动摘要里因失败离线的账号以 warn 写出原因。
  - 权限：`@zhin.js/console-protocol` 的 `ConsoleRpcPermissionRule`（`exact`）新增可选 `alsoRequires`（还需全局持有的权限）与 `grantsAllowAlsoRequired()`；`endpoint-writeback` 的规则带 `alsoRequires: ['ops.config.write']`，实例插件 RPC 分发与 `@zhin.js/host-http` 的 `pluginRpcWriteAllowed()` 都会检查。
  - Console「需要你处理」：启动失败（`failed`）或等待重试（`retrying`）的账号也列为 `endpoint.offline`，详情附上分类后的失败原因。

- f1a9745: #1250 账号导入 / 写回与插件 Console RPC 权限的评审修复：

  - 权限：插件 Console RPC 的方法名只有一种规范化（新增导出 `normalizePluginConsoleRpcType()`）：camelCase 与 `action.` 写法（如 `plugin.root/qq.action.endpointWriteback`）按 kebab 方法（`endpoint-writeback`）解析权限目标、`alsoRequires`（`ops.config.write`）与写操作分类（进入审计），实例分发与审计 action 也使用规范类型。此前这类写法会落到通用插件规则，绕过 `ops.config.write` 与审计。
  - 写回：yml 里已有的 `${VAR}` 引用（条目自己的或从实例块继承的）只有在进程内解析后等于已保存值时才保留；不同或无法解析时写成新的占位引用，`placeholders[].reason` 为 `reference_mismatch` / `reference_unresolved`。新增可选端口 `EndpointConfigSource.resolveReference`。凭据也按值识别：URL 用户信息、带凭据的查询参数写成占位引用，含凭据的列表拒绝写回。写回结果新增 `reconnectsAll: true`，提示该适配器实例的全部账号会随配置重载重新连接；写回会重新生成整个 `endpoints` 序列（列表内注释丢失）。漂移比对同样在进程内比较引用与已保存值。
  - 导入：yml 账号的身份字段与已保存账号不同时拒绝导入（请替换账号）；导入的配置经过 `prepareConfiguration` / `validateConfiguration`；`endpoint-import` 必须带 `expectedRevision`；导入尚未保存的账号需要适配器级 `endpoint.manage`。
  - 启动：创建 Endpoint 时抛出的 `TypeError` 若是网络失败（undici `fetch failed`、cause 带网络错误码）按网络错误重试；`Adapter.configurationCredentialFields`（默认等于身份探测字段）的值在失败原因中脱敏，Bilibili 直播声明 `sessdata` / `biliJct` / `buvid3`。
  - `zhin start --once`：等待首次启动尝试有结果（最多 30 秒），有账号 `failed` / `retrying` 时以非零码退出并列出失败账号。

- e0b4e51: 账号（Endpoint）启动不再阻塞实例就绪（#1250）。实例提交 generation 后即就绪；每个账号最多等约 3 秒宽限期，其余在后台继续启动，失败的账号按退避自动重试（5 秒起翻倍，封顶 5 分钟，±20% 抖动，不限次数）。`Endpoint.start()` 合同不变，适配器无需改动。

  行为变化：

  1. 实例 ready 与 `/pub/ready` 返回 200 不再意味着账号在线；需要账号在线才算就绪时用 `http.readiness.endpoints`。网关 `gateway.readyTimeout` 不再覆盖账号登录时间。
  2. 账号 start 失败不再导致实例启动失败或热重载回滚：改坏账号配置的热重载**会提交**（以前会回滚、旧账号继续在线），旧账号下线，新账号进入 `failed` / `retrying` 并按策略处理。账号停止时清理失败只把该账号标为失败（`endpoint_cleanup_failed`，等待人工处理），不再作为整个 Root 的完整性失败。
  3. 宽限期内没完成登录的慢账号，热重载从“先上新再下旧”变为“先下旧再上新”；宽限期内完成的不受影响。
  4. `zhin start --once` 是启动检查：宽限期后最多再等 30 秒，直到每个账号的首次启动尝试有结果；有启用账号处于 `failed` 或 `retrying`（首次尝试已失败）时以非零码退出，`stderr` 以首个失败账号的脱敏报错开头并列出全部失败账号；仍在 `starting` 或等待交互式登录（`awaiting_assist`）的账号不算失败。
  5. 账号上线前向它发送仍立即失败（`endpoint_inactive`，`not_sent`）。
  6. 自动重试会产生周期性的 `endpoint_start_failed` 日志（错误类名、错误码、类别与脱敏后的原始报错 `reason`）；配置错误与交互式登录（`login.mode: interactive`，如 ICQQ）不自动重试，等 Console「重新登录」/「启动」，重新登录也会立即唤醒等待中的重试。

  新增：`AdapterEndpointPhase` 的 `failed` / `retrying`，Endpoint 行与 `Adapter.list()` 的 `startAttempt` / `startFailure` / `nextRetryAt`，`Adapter.retryStart()`；core Endpoint 列表把等待登录验证的启动中账号报告为 `awaiting_assist`；需鉴权的 `{api}/system/readiness` 详情新增不参与就绪判断的 `endpoints[]`；Console 协议 `ConsoleEndpointPhase` 新增 `retrying` / `awaiting_assist`，账号页显示「启动中 / 启动失败 / 等待重试」；TTY 启动摘要分 online / starting / failed 列出账号。账号 start 作为 Console 变更执行时，首次尝试失败的执行码由 `endpoint_execution_failed` 改为 `endpoint_start_failed`。

  `AdapterIndex.activate()`（Root generation 交接）按上述规则后台启动；`AdapterIndex.start()` 保留给工具与测试，仍等待每个账号的首次尝试，并以 `Endpoint.start()` 原样抛出的首个错误拒绝（随后停止全部账号，不留后台重试）。

### Patch Changes

- Updated dependencies [e6d7cc1]
- Updated dependencies [7cc703a]
- Updated dependencies [cca4427]
- Updated dependencies [70ddaf4]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/feature-kit@1.1.18

## 1.1.34

### Patch Changes

- f2fa3d7: ICQQ 改用登录辅助 v2 的登录流程（ADR 0058 P2）：每次登录一条流程（连接 → 挑战 → 验证中 → 在线 / 失败），声明 `login: { mode: 'interactive', relogin: true, refreshQr: true }` 并实现「重新登录」「刷新二维码」钩子。扫码时自动跟踪扫码状态（已扫码提示、确认后自动继续、过期自动换码两次）；滑块带托管验证码辅助页（`media.captcha`）和手动提取 ticket 的分步说明，NT 登录提交 `ticket,randstr`、旧版只提交 ticket；设备锁提供「我已在手机完成验证」和「改用短信验证码」（6 位验证码、60 秒后可重新发送，发送失败报 `rate_limited` / `unknown` 并留在设备锁）；身份验证提供设备 JSON（敏感，只在活动挑战上）、验证链接二维码和只在 `accounts.qq.com/login/attack` 运行的静态辅助脚本。`system.login.error` 按一张表映射到错误码，验证码错误留在原挑战；需要人处理的失败不再自动重新登录，只有被踢下线、网络错误等不需要验证的失败保留退避重试并记入时间线。QQ 命令 `icqq login confirm / code / status / qr` 按挑战作答（设备锁 `code sms`、短信 `code resend`），`code` 支持带 QQ 号。core：流程挑战的兼容待办 `payload.message` 带上简短说明，`payload.url` 在没有 `media.link` 时取第一个链接块。

  adapter：`AdapterIndex.loginControl` 的登录钩子（重新登录、刷新挑战）在账号启动中（卡在登录挑战上）也能调用，新增 `acquireLogin` 租约；已停止的账号和被替换的旧 incarnation 仍然拒绝。

  验证链接带会话标识：icqq 日志只记录挑战类型和链接主机名；core 的 `withoutLoginMedia`（`endpoint.login.flow` 事件与历史）去掉滑块 / 设备锁 / 身份验证 / link_verify 挑战的 `media.link`、`media.captcha` 和链接块，并标 `linkOmitted: true`（console-protocol 增加该字段）。

  复审修正：NT 滑块答错后重新登录拿新滑块（NT / 旧版格式按挑战记录，不再重新判断）；「ticket 已过期」映射为 `challenge_expired`；`system.receive` 的登录挑战副事件只带 `{ kind, host }`；包装 icqq SDK 日志，去掉链接查询串和手机号（SDK 直接写控制台的终端二维码和 237 分支 `console.log` 无法拦截，已在 README 说明）；自动重新登录 8 次用尽后流程失败并通知；扫码时 SDK 的 `internal.error.qrcode` 转为结果；登录钩子随租约中止；token 不兼容提示删除 token 文件；`icqq login code` 在多账号时不回显参数；短信冷却跨重新登录保留。core：纯字符串等于某个无输入操作的 id 时选择该操作（旧 Console 输入 `sms` 仍可用）。

- ac72706: 登录辅助 v2 第一期（ADR 0058）：每个账号一条登录流程（`LoginAssist.beginFlow`、时间线、提交后自动「验证中」与「结果待确认」、错误码与 `next`），挑战描述符带分步引导、复制 / 链接 / 提示块（敏感块只在活动挑战上）、`parseLoginTicket()` 与托管验证码辅助页的共享函数；`defineAdapter({ login })` 能力声明与 Endpoint `login` 钩子；Console 新事件 `endpoint.login.flow` 与 RPC `login.flow.list` / `login.flow.get` / `login.relogin` / `login.refresh`，`login.submit` 支持 `{ action, values }` 与 `wait: true`；登录操作审计结果类别；终端按流程逐行显示进度、按编号选择操作；账号行填写 `pendingLogin` / `loginStep` / `login`；配置 `console.loginAssist.captchaHelperUrl`。旧 `waitForInput` / `login.list` / `login.submit` 行为不变。
- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/feature-kit@1.1.17

## 1.1.33

### Patch Changes

- 53932e5: 修复平台身份 permit 与操作目标不一致的问题（ADR 0056 §5）：`platform:*` / `platform-permission:*` / `bot:*` / `bot-permission:*` 按**当前会话**判定，但群管理工具此前接受模型传入的任意群 / 服务器 / 频道 ID，机器人同在 A、B 两群当管理员时，A 群管理员可让 Agent 在 B 群踢人。

  - 目标改为取自当前会话、去掉目标 ID 入参（模型传入的 ID 被忽略）：ICQQ（踢人、禁言、设管理员、头衔、公告、匿名；设精华校验消息属于本群）、Telegram（邀请链接、置顶 / 取消置顶、群描述、默认权限）、Discord（加 / 移除身份组、身份组列表、建子线程）、KOOK（黑名单、授予 / 撤销 / 创建 / 删除角色）、飞书（加成员、设 / 撤管理员、改群信息、解散群）、NapCat（群公告、删公告、头衔、群头像；精华消息校验属于本群）、OneBot11（头衔）、QQ 官方频道（身份组增删建与列表、子频道列表、成员详情；子频道详情只限本频道）。核心场景治理工具工厂（`createSceneManagementTools`）同样只作用于调用消息所在会话，没有会话时拒绝；Agent 侧同名工厂改用与核心一致的 `platform:<地位>` + `bot:<地位>`（此前误作 zhin 角色）。
  - 钉钉群管理接口使用旧版 `chatid`（无法由当前会话推出），`dingtalk_add_chat_members` / `dingtalk_update_chat` 改为要求 zhin `owner`（`update_chat` 此前没有任何门禁）；`dingtalk_create_chat` 改为要求 zhin `trusted`（`admin` / `owner` 亦满足），不再依赖钉钉从不上报的 `platform-permission:chat_owner`。
  - Slack 不上报发言者平台身份，频道工具改用 zhin 角色并只作用于当前频道：话题、用途、邀请、置顶 / 取消置顶要求 `admin`，归档 / 恢复归档要求 `owner`；`PERMITS.md` 同步修正。
  - Discord：加 / 移除身份组要求目标身份组低于发起者的最高身份组（服务器主豁免；托管身份组拒绝），低位 `manage_roles` 管理员不能借机器人给自己加更高身份组。平台权限统一为服务器级：机器人自身改读 `GuildMember.permissions`（不再用频道级 `permissionsFor`）；Interactions 模式的位域含频道覆盖，只上报不能被频道覆盖的权限（管理员上报全部），并用最近一次交互的 `app_permissions` 上报机器人自身身份（同一口径，10 分钟内有效）。
  - Telegram：`set_permissions` 改要求 `platform-permission:restrict_members`，`set_description` 改 `change_info`，`create_invite` 改 `invite_users`；发送者 `getChatMember` 并发合并为一次、失败负缓存 10 秒，收到 `chat_member` / `my_chat_member` 更新时以新状态覆盖缓存（默认 `allowedUpdates` 增加这两项）；restricted 成员的个人 `can_*` 不再作为平台权限上报（与普通成员一致，只有管理员上报权限）。
  - KOOK：服务器主与持有「管理员」位的成员（含机器人自身）展开为全部权限；并入「全体成员」（role_id 0）的基础权限。
  - 飞书：`chat.get` 失败或未返回 `owner_id` 时发送者 / 机器人地位为未知（不再报确定的 `member` 并缓存 60 秒），失败负缓存 10 秒。
  - QQ 官方：发送者平台身份只在频道子频道上报（群、单聊、频道私信不上报）。
  - `AdapterIndex.selfStanding`：共享查询使用独立的 10 秒期限，调用方的 `signal` 只中止自己的等待，不再取消他人共享的查询或把结果缓存为未知；查询期间被 `invalidateSelfStanding` 失效时不写回旧结果。
  - OneBot11 / NapCat / Milky：机器人自身身份不再永久记住首次 `get_login_info` 的账号（重连或换号后刷新；只为合并突发请求复用 5 秒，查询失败即丢弃）。
  - 删除遗留导出（生成永不匹配的 permit 或已不再注册）：`discordGroupPermitResolver` / `checkDiscordPlatformPermit` / `normalizeDiscordSenderForPermit`、`telegramGroupPermitResolver` / `checkTelegramPlatformPermit` / `normalizeTelegramChatMember`、`kookGroupPermitResolver` / `checkKookPlatformPermit` / `normalizeKookSenderForPermit` / `KookSenderInfo`、`larkGroupPermitResolver` / `checkLarkPlatformPermit` / `normalizeLarkSenderForPermit`、`slackGroupPermitResolver` / `checkSlackPlatformPermit` / `normalizeSlackSenderForPermit`、`dingtalkGroupPermitResolver` / `checkDingtalkPlatformPermit` / `normalizeDingtalkSenderForPermit`、`wecomGroupPermitResolver` / `checkWecomPlatformPermit` / `normalizeWecomSenderForPermit`、`qqGuildPermitResolver` / `checkQqPlatformPermit` / `normalizeQqGuildSenderForPermit`。permit 一律交给内置评估器（`@zhin.js/permission`），`platformPermit()` 仍保留；各适配器 `PERMITS.md` 按实际上报的字段重写。

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

- a9c7a13: 聊天角色安全审查修复（ADR 0056 修订）：

  - 角色的作用范围：Runtime 在 `sender.chatRole` 之外写入 `sender.chatRoleLevels`（每个角色最高来自哪一层）。宿主全局能力——Agent 危险工具 / exec / 文件策略、主人审批的接收人、重启实例、写全局 / 平台记忆、定时任务的高信任运行、聊天改项目配置、`icqq login` 跨适配器恢复——只认**全局层** `owner`；增删适配器账号需要适配器层或以上的 `owner`。会话 / 账号 / 适配器层的 owner 在 Agent 信任档位上按 `admin` 计（`principal.roles`），链上角色保留在 `principal.chatRole` / `chatRoleLevels`。`@zhin.js/im-contract` / `@zhin.js/core` 新增 `chatRoleHeldAt`、`hostChatRole`、`ChatRoleLevels`。
  - permit 新增层级限定写法 `<角色>@<层级>`（`owner@global`、`owner@adapter`、`admin@endpoint`……，也可写在 `role(…)` 中）；不带层级的 `owner` 含义不变。
  - 聊天 `角色 授予 / 撤销`：被替换或撤销的已有角色同样计入「被触及的角色」，低角色的授予不能覆盖同级或更高的角色，触及 owner 需更高层 owner；`角色 列表` 需要 admin，上级条目不显示身份。
  - Console `chat-roles.grant|revoke`：涉及 owner（授予、替换、撤销）需要全局 `iam.manage`；`chat-roles.list` 对调用者作用域之外的条目脱敏（`redacted: true`，`ConsoleChatRoleEntry.adapter` / `userId` 变为可选）。
  - 非关系型数据库时授予 / 撤销被拒绝（RPC 503 `chat-roles-unpersisted`，聊天回复「未保存」）；迁移来的授予只在内存生效、记录保持 pending 并标记，不再「撤销后复活」。
  - 迁移保持旧语义：适配器 `master` 迁为「没有自己 master 的账号」的账号层 owner（不再建适配器层 owner）；`ai.trigger.masters / trusted` 不再登记到声明 `runtime.sandbox` 的模拟适配器与无法判断的适配器（写日志）。
  - 线程 / 子话题沿用父会话键：Discord 线程上报为父频道 + `threadId`（出站仍发到线程）；会话无法生成会话键时退回账号层链解析，全局 owner 不再丢失角色。
  - 执行时复检重新读取发言者当前角色与机器人身份（`PermissionHost.setSenderRoleResolver` / `currentSenderRoles`）；定时任务记录创建者所在会话，到期按创建者当前角色运行，普通用户的任务以普通成员信任运行。
  - `AdapterIndex.selfStanding` 的 `cachedOnly` 读到过期缓存视为未知；入站时丢弃适配器上报的 `chatRole`，事件流发布增强后的 sender。`@zhin.js/testing` 的 `PluginTestKit` 声明的角色按全局层处理。
  - 跨群 / 账号级 Agent 工具改用层级限定：钉钉 `add_chat_members` / `update_chat`、Slack `unarchive` 要求 `owner@global`；NapCat `delete_friend` 要求 `owner@endpoint`。

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

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- 5cd9d3d: 插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

  - console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
  - gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
  - zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
  - adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
  - plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
  - rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。

- d655ef0: QQ 官方适配器支持群聊和单聊图文卡片，以及群聊、文字子频道的 @全体成员。管理端口可以拉取和审批入群申请，并查询、加入、移出群黑名单。

  `@zhin.js/adapter` 的 EndpointManagement 增加可选的群审批和黑名单方法。作用域端口只转发契约上声明的方法，不增加这些方法的话，QQ 端点上的实现到不了调用方。

- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
  - @zhin.js/logger@1.1.3
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/im-contract@1.1.14

## 1.1.32

### Patch Changes

- 0d76a7c: Overhaul Console interactive workbenches, platform-specific adapter account onboarding/login flows, DeclarativePageView visual/interactive capabilities, and official utility plugin Console pages.

## 1.1.31

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/feature-kit@1.1.15

## 1.1.30

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/feature-kit@1.1.14

## 1.1.29

### Patch Changes

- bc6ccb1: Deep audit bug fixes and 7 architectural improvements:
  - Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
  - Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
  - Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
  - Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
  - Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
  - Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
  - Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
  - Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/feature-kit@1.1.13

## 1.1.28

### Patch Changes

- cbd3f14: ADR 0044 integration and C6 guard. `delivery.spool` now reproduces the pre-0044 media rule (icqq `false`, every other official adapter `true`). icqq narrows `actions.recall.others` unless the Bot is admin or owner, and declares recall for groups. Endpoint kind capabilities merge the Endpoint's `operations` (Discord reactions keep working; Discord declares reaction feedback). Adapters in the `@zhin.js/` scope are trusted: their custom prompt text is not labelled `external_content`. Core no longer keeps a telegram/discord interactive-policy table (adapters declare `segments.interactive`). New `pnpm check:no-platform-branches` blocks platform-name branches in runtime code.
- 299863a: ADR 0044 C3: runtime consumers read capabilities instead of platform names. Scene facts (group info, member profile) are queried where the profile declares `scene.groupInfo` / `scene.memberProfile`; activity feedback (reaction, typing, status message, refresh interval, quote-only delivery) follows `feedback`, `actions.reaction` and `delivery.proactive` and the per-platform table is gone; large inline media is spooled only where `delivery.spool` is declared; the sandbox ingress and its console shell follow a new additive `runtime.sandbox` capability. `defineAgentTool` and Skill frontmatter accept `requiresCapabilities` (for example `actions.mute`), evaluated against the per-turn `TurnCapabilities`, so moderation tools disappear when the Bot is not an administrator and return when it is; the icqq/qq keyword boost in tool selection is removed and the icqq group-admin tools are tagged. The `icqq` command-line special case in the exec policy is now a generic `registerSensitiveExecCommand` rule registered by the icqq plugin. `EndpointCapabilities` gains a serializable per-kind `kinds` view. Adapters without a profile keep their previous behaviour (their derived profile also reads the management ports they implement).
- aaa93d7: ADR 0044 C1: adapter capability profile spec. `defineAdapter({ profile, resolveCapabilities })` declares seven capability groups (messaging, scene, actions, events, feedback, delivery, prompt) per conversation kind with inheritance from `default`, validated at definition time. `resolveTurnCapabilities` merges the sections and narrows them (Bot role, mute state, passive window, and the adapter's narrow-only patch), and the IM ingress attaches the result to the turn input as `platformCapabilities` (`has` / `get`). A declared action without its management/control port fails at assembly. Adapters without a profile get a conservative one derived from `capabilities`, `operations` and `segments`; `segments` and `liveDanmaku` remain as aliases. No behaviour change for existing adapters.
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12

## 1.1.27

### Patch Changes

- b88e988: Preserve account-profile write acknowledgements already observed before cancellation, distinguish native Discord REST rejection from unknown outcomes, and retain the last valid profile when a newer concurrent read fails. Keep scene-scoped SOUL presence consistent with the actual prompt and allow discovered URLs to pass through the existing network authorization policy.
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

- Updated dependencies [c15cef9]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/feature-kit@1.1.11

## 1.1.26

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
- Updated dependencies [2c3610a]
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/plugin-runtime@1.1.18

## 1.1.25

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

- ff3efe7: feat(adapters): notify masters when ICQQ or QQ goes offline and support ICQQ re-login

  - Add an explicit `notify` target to ICQQ and QQ endpoint config: when the
    transport goes offline or login fails, send a short notice through another
    adapter instance's Endpoint via `OutboundHost`.
  - ICQQ automatically retries login after `system.offline.kickoff` when
    `autoReconnect` is enabled, and exposes pending QR/slider/device challenges.
  - Add `icqq login status|qr|confirm|code|retry` recovery commands. They can be
    invoked from the QQ conversation that received the notice; `qr` returns the
    login QR code as an image when the notifying platform supports it.
  - `notify.id` also counts as the master identity for the related endpoint
    management commands, so recovery can happen from the notified conversation.
  - Document the new config and commands in the ICQQ/QQ READMEs and generated
    configuration reference.

- c58c589: Group deferred tools by their canonical plugin or MCP server instead of installation paths. Omit already represented delivered text and ledger facts only from the current model projection, preserving full history and restoring facts when their covering reply leaves the active context. Allow tools to declare a synchronous, read-only availability predicate before turn disclosure, with execution-time checks remaining authoritative.

  Preserve every confirmed platform message identity across Agent replies and ICQQ split sends. Give each bubble its own stable single-message alias while retaining the reply's ordered association; preserve confirmed prefixes on partial delivery without retrying or inventing unknown message IDs.

- Updated dependencies [c58c589]
  - @zhin.js/im-contract@1.1.9

## 1.1.24

### Patch Changes

- e23cabc: ADR 0041 slice B: the turn context now carries real scene facts. `EndpointManagement` gains `inspectGroupScene` (name, owner, admins, member count, global mute) and `inspectGroupMemberProfile` (role, card, title, mute expiry; one lookup), implemented by the ICQQ adapter from uncached group/member reads. The CLI resolves them per turn (bot role always fresh; group and sender facts reuse a 60 s, 256-entry in-memory cache scoped to the generation; failures omit fields) and the inbound actor now carries `groupNickname` / `groupTitle` / `mutedUntil` plus the platform role. The Session / Bot state blocks are replaced by one projected scene line `[scene_id:…;scene_type:…;scene_name:…;owner_id:…;admins:…;member_count:…;global_mute:…;assistant_role:…;]` (values escaped and clipped to 64 chars). No new on-disk state.
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- d0e1fac: Keep stable prompt instructions ahead of turn-specific capabilities, project unchanged context without placeholder text, and retain scoped state snapshots with readable updates and compaction recovery. Preserve native conversation/tool chronology and separate participant identity from runtime guidance.

  Resolve the ICQQ bot account and current-group role before capability discovery, and support explicitly declared current-conversation bot-role requirements without changing existing requester permissions or approvals. Keep role lookup failures unknown and preserve execution-time platform checks.

- Updated dependencies [4f96ad5]
  - @zhin.js/im-contract@1.1.8

## 1.1.23

### Patch Changes

- 334e92d: 公告：草稿 → 审批 → 发送（ADR 0037 第 1 期切片 B）。

  - 新表 `ai_announcements` 与 `AiAnnouncements`：状态只前进 `draft` → `pending` → `approved` → `sent`，旁路 `rejected` / `expired` / `failed`；`revision` 乐观并发；改正文回到 `draft` 并重算 `content_hash`；待审批默认 24 小时超时。
  - 新工具 `announcement_draft`（`risk: safe`）：模型只能建草稿，不能提交、审批或发送。
  - Console `plugin.root.announcements` / `announcement`（读）与 `announcement-create` / `-edit` / `-submit` / `-approve` / `-reject` / `-resend`（动作，暂用 `control:read` / `control:write`）。
  - 批准即发送：摘要复核 → 控制面 → 会话画像 → 硬闸以公告审批记录作批准（`ToolHardGate.checkPreApproved`，不弹第二张卡）→ `EndpointManagement.sendGroupNotice`（icqq / napcat）。被拦或失败置 `failed`，不自动重试；重发回到 `pending` 需再批一次；摘要不符拒绝（`announcement_hash_mismatch`）。
  - 审计追加 kind `announcement` 与码 `announcement_drafted` / `_submitted` / `_approved` / `_rejected` / `_expired` / `_sent` / `_send_failed` / `_resend` / `_hash_mismatch`。

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [69f9ef6]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/feature-kit@1.1.9

## 1.1.22

### Patch Changes

- 7d68df6: 精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
- e91235e: Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/feature-kit@1.1.8

## 1.1.21

### Patch Changes

- a3ab153: Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
- Updated dependencies [d3563d9]
- Updated dependencies [fbfefb7]
  - @zhin.js/feature-kit@1.1.7
  - @zhin.js/im-contract@1.1.5

## 1.1.20

### Patch Changes

- Updated dependencies [064b06d]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.19

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/logger@1.1.2

## 1.1.18

### Patch Changes

- 9891e66: Endpoint 新增运行期 `selfUserId` 访问器与受保护的 `reportSelfUserId()`（`EndpointImplementation` 另可声明 `selfUserId`，`EndpointActivationContext` 提供 `reportSelfUserId`），并新增进程级 Peer Registry（`getProcessPeerRegistry()` / `createPeerRegistry()`）。账号仅在 generation active 后登记，回滚 / retire / stop 后移除；`EndpointIdentity` 保持不可变。ICQQ 在 `system.online` 上报 uin；OneBot11 ws/wss 从事件 `self_id` 与 `get_login_info` 上报；Sandbox 以配置的 bot id 作为合成账号。未上报的旧 Endpoint 不进入 Registry（fail closed），不会用配置 id 兜底。OneBot12 / napcat / milky 等其余适配器留待后续。

  Peer Registry 使用登记序号（新 generation 胜出），旧实例在新实例登记后再次上报不会覆盖新条目；空值或非字符串的读取查询返回未命中而不抛错；OneBot11 在 stop 时清空 `selfUserId`。

  登记序号在 Endpoint 激活时通过 `PeerRegistry.reserve()` 分配，新实例先上报、旧实例晚到的首次上报不会覆盖新条目。

- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.17

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12

## 1.1.16

### Patch Changes

- b9b3953: Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

  Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.

- b9b3953: Bound QQ startup to 30 seconds with cancellation and late-client cleanup, own asynchronous CLI startup failures, and patch qq-official-bot session startup so authentication/receiver failures reject the returned promise without orphan rejection or lost synchronous readiness.

  Encode native QQ callback buttons with official action type 1, subscribe to interaction events by default, and map SDK action notices into canonical clicks with platform ACK and honest source-message association metadata.

  Reject outbound messages containing segments excluded by an explicit adapter supported policy, and reject unimplemented QQ share cards instead of silently dropping title/description/URL while confirming neighboring text.

- Updated dependencies [b9b3953]
  - @zhin.js/im-contract@1.1.3

## 1.1.15

### Patch Changes

- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2

## 1.1.14

### Patch Changes

- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- eb3227a: Move Endpoint project-configuration persistence behind the root-owned `EndpointConfigurationStore` resource. The Adapter package now owns only command semantics and no longer imports Node filesystem, path, or YAML APIs; CLI owns canonical YAML and `.env` persistence, while QQ and ICQQ special binding flows use the same injected boundary. Remove the old direct persistence helpers and reject legacy `plugins` arrays instead of promoting them at runtime.
- 73a24b7: Reorganize the Adapter package into one-way authoring, Endpoint boundary, managed lifecycle, and Runtime projection modules without changing public imports. Extract ICQQ content resolution behind a focused module and document its source map.
- df9f76b: Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [e561309]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/im-contract@1.1.1

## 1.1.13

### Patch Changes

- 769e67f: Add a compact adapter authoring form with framework-owned Endpoint identity, transactional connection cleanup, and lifecycle. Adapter `create()` may now return `{ client, connect, activate, send }`, while existing Endpoint subclasses remain compatible.

## 1.1.12

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.2.2

### Patch Changes

- f7ee28d: Prevent deferred connections from starting after stop, keep an older startup from marking a replacement connection open, and immediately close resources registered by the current connection after it has been stopped.

  Apply the same generation guard to automatic reconnect completion and failure so an obsolete reconnect cannot change the state of a replacement startup.

## 1.2.1

### Patch Changes

- 4e8117c: Expose the published imhelper protocol Clients from every Endpoint, preserve native action responses, and route host-owned HTTP, WebSocket, and raw ingress through the Client APIs. Add the shared `ClientEndpoint` deep base so concrete transports inherit one open-gated Client event bridge, and move reverse WebSocket lifecycle and heartbeat cleanup onto the common lifecycle state machine.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/logger@1.0.77
  - @zhin.js/feature-kit@1.0.13

## 1.2.0

### Minor Changes

- f2c532f: Expose exact per-Endpoint message operations through one validated Adapter capability model, route Core control calls through declared active capabilities, and connect existing recall, edit, reaction, and typing implementations across platform adapters.

## 1.1.11

### Patch Changes

- 5969c5b: Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
- 5969c5b: Drop ICQQ unified_inbox dual-write for request/notice; Console request.list prefers EndpointManagement.listRequests, and approval stays on $approve / management.
- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

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
- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/feature-kit@1.0.12

## 1.1.10

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.1.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.1.8

### Patch Changes

- 63253bb: Restrict Root consumers to the read-only `SnapshotReader` lease interface and
  remove public `RootRuntime.controller` access. Generation commit, transaction,
  close, and stop authority now remain inside the Root lifecycle.

  Close Root admission when rollback cleanup or retired-generation disposal can
  no longer prove lifecycle integrity. Existing leases may drain, but new
  operations and generation transactions fail closed until the Process Host
  stops the Root.

  Bind externally driven capability resources to lifecycle-owned generation admission gates.
  Adapter candidates can establish Endpoint connections during readiness while their IM ingress
  remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
  without closing the old Endpoint before the transaction succeeds.
  Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
  now retain their exact generation until settlement instead of escaping with a live object.

  Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
  connection readiness, and local admission are required generation prerequisites; any failure
  disposes the complete candidate set and leaves the previous generation serving traffic.

  Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
  `HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
  with generation admission so candidate routes cannot shadow committed routes before publish.

  Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
  quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
  only; the previous generation remains untouched until the single synchronous snapshot/admission
  publish point, then drains through its existing leases.
  Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
  database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
  fails closed and awaits candidate cancellation cleanup.

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9

## 1.1.7

### Patch Changes

- c106ecc: feat(permission): add unified @zhin.js/permission package with builtin DSL (adapter/group/private/channel/user/role), PermissionHost, and platform permit checker. Extract LegacyEndpointControlSurface to im-contract. Support Unicode capability local names in plugin-runtime.
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

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
- Updated dependencies [a7df753]
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/feature-kit@1.0.8

## 1.1.6

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/feature-kit@1.0.7
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4

## 1.1.5

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- 2e41ad5: fix: agent 优化
- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/feature-kit@1.0.6

## 1.1.4

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/feature-kit@1.0.5

## 1.1.3

### Patch Changes

- 7c1e63a: feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

  非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

## 1.1.2

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.1.1

### Patch Changes

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 9c997b2: 通用 endpoint 管理命令套件：`@zhin.js/adapter` 新增 `createEndpointCommands(spec, defineCommand)`——`<adapter> endpoint list / add <name> key=value... / remove <name>` 三件套，含 kv 解析、`.env` 凭据派生（`<ADAPTER>_<NAME>_<FIELD>`）、yaml 写回保留注释、master 权限门禁（通用 `isEndpointOperator`）、自定义 bindFlow 钩子。QQ 迁移至套件（行为与扫码绑定流程不变）；napcat / onebot11 / onebot12 / milky / slack / telegram 接入（字段对齐各自 schema，features 补 @zhin.js/command）。
- 09d4f25: Console 社交读取面（management 语义端口）多平台落地：napcat/onebot11/onebot12/milky（好友+群+群成员，OneBot 标准动作）；discord/kook/satori（guild+频道+成员，分页聚合，id 保精度留字符串）；slack（workspace 成员+public channels+conversations.members）；line（群/room 成员分页+profile 回退）；wechat-mp（followers openid）；weixin-ilink（context_token 对端推导）；lark（chats+members 全分页）。`EndpointFriend.user_id`/`EndpointGroup.group_id` 放宽为 `number | string`（雪花 id 不丢精度）。telegram/wecom/dingtalk/github/email/sandbox 注明平台无列表面暂不接。
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
- 6cb6152: 统一消息元素通道（UNI-Channel）落地：

  - **入站契约**：`IncomingMessage.segments`（canonical Segment[]，与 content 纯文本视图同源双轨），Message 透传；AI 兜底链路经 `collectSegmentMedia` 把图片/语音/视频/文件 MediaRef 写入会话 extra——多模态输入不再丢失。
  - **出站协商**：`normalizeOutboundPayload` 升级全量 canonical 归一（复用 generic-segment-mapper），html→image 按端点 `segments.outboundMedia` 声明降级（base64 直发 / url-or-text / passthrough 自行物化）；`MediaRef.kind` 新增 `'file'` 承载平台不透明引用（file_id/resource_id）。
  - **能力声明**：`defineAdapter.segments` policy（outboundMedia / interactive），三道段门禁复活（探测点改 adapters/\*.ts，豁免名单渐进收敛）。
  - **首批迁移**：icqq 全保真出入站（CQ ↔ canonical，quote→reply 段）；milky/telegram/discord 入站媒体段恢复（附件/贴纸/callback action）；napcat/onebot11/onebot12 出站 canonical→OneBot 数组段；wechat-mp/wecom `/cgi-bin/media/upload` 与 lark `/im/v1/images` 上传通路（base64/URL 图片不再静默丢图，失败降级文本）。

- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.1.0

### Minor Changes

- e5c84ed: Adapter 多账号：插件实例 config 支持 `endpoints: [{name, ...覆盖}]` 数组，`expandEndpointConfigs` 将一个实例展开为多个 endpoint record（id 为 `<slotId>~<name>`，顶层字段共享、逐项覆盖），替代多 `instanceKey` 方案；Console `/api/plugins` 收敛为一个插件卡片 + 多 endpoint。icqq / qq schema 与 README 补 `endpoints` 配置。

  Plugin Runtime Console Host：补 `/esm/*` React/router ESM 代理路由（legacy `consoleApiRouter` 对齐），TypeScriptClientBuilder 裸导入改写为 `/esm/<enc>.mjs`。

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

### Patch Changes

- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
