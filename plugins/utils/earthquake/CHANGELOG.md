# @zhin.js/plugin-earthquake

## 0.2.0

### Minor Changes

- a05eb73: #1250 第 78 批：拒绝文案与「是不是全局主人」判定各收成一处。

  - `@zhin.js/permission`：拒绝文案的唯一来源。新增导出 `describeCommandDenial(permit, locale, options)`（命令被 `permit` 拒绝时的回复）、`describeGlobalOwnerRequired(locale, { privateChat, bindCommand, commandPrefix })`（需要全局聊天主人的能力：说明需要全局 owner 以及去哪里授予——Console「聊天角色」页，授予前先私聊发送「绑定 <码>」把聊天身份绑定到 Console 账号；还没有全局 owner 时私聊发送「认领 <码>」）、`describeConversationManagerDenial(locale)`（`canManageConversation` 的标准拒绝）与类型 `PermitDenialOptions`；`describeDeniedPermit` 新增第三个参数。`bind` 是普通命令：调用方给出 `bindCommand`（如 `CommandContext.formatCommand('bind')`）或实际命令前缀 `commandPrefix` 时，文案写出带前缀的「!!绑定 <码>」，都没有时注明「配置了命令前缀时带上前缀」（英文同步，并补「to a Console account」）。（不兼容）`describeDeniedPermit` 一律返回完整句子（如「此功能需要 zhin 角色。……」/ "This needs a zhin role. …"，原为「它需要 zhin 角色……」/ "it needs a zhin role…" 这样的句子片段），它也是 `CommandDispatchResult.denial.reason` 与命令反馈渲染器拿到的 `reason`；只有 `describeCommandDenial` 在前面拼上「没有权限执行此指令。」/「无法执行此指令。」（原为「没有权限执行此指令：……」「无法执行此指令：……」）。zhin 角色条件的拒绝不再点名缺的角色（原「需要你在本会话拥有 zhin 角色 {value}」），`owner@global` 改为全局 owner 说明。
  - `@zhin.js/command`：再导出 `describeConversationManagerDenial`（`zhin.js/command` 同样可用）。
  - `@zhin.js/core`：命令拒绝回复改用 `describeCommandDenial`（全局 owner 说明里的「绑定」带上本条消息实际的命令前缀）；`private()` 不满足时回复「此指令只能在私聊中使用，请私聊机器人发送。」（原为通用的「没有权限执行此指令。」）；消息结局 `permission_denied` 的发送者文案与命令拒绝同源（「没有权限执行此指令。」）；按钮 `permit` 不满足的回复改为「你不能使用这个按钮。<原因>」（原因是完整句子）。`usageSubjectFromMessage` 的 `owner` 改用 `isOwner()` 判定（行为不变）。（不兼容）删除 `MessageSender.isMaster` / `isTrusted`（无写入点；角色只读 `sender.chatRole`，判全局主人用 `isOwner()`）。
  - `@zhin.js/agent`：（不兼容）`RuntimeSenderRoles`、`TurnIntentSenderRoles`、`RuntimeManagementSenderRoles` 的 `{ isMaster, isTrusted }` 改为 `{ hostRole?: 'owner' | 'admin' | 'trusted' }`（宿主信任角色：`owner` 只给全局 owner，低层 owner 记为 `admin`）；删除 `ownerApprovalMessages.denied`、`managementMessages.denied`。主人命令 `approve …` 的拒绝改用全局 owner 共享说明（「绑定」带本账号命令前缀）；管理命令对无角色者回复共享的 `describeCommandDenial('trusted')`；`reset` 的拒绝也以这句开头（原「仅聊天角色 owner / admin / trusted 可用」），后面保留改发 /clear 的引导。主人判定统一走 `isOwner` / `hasChatRole`。
  - `zhin.js`：`config` 命令的 permit 改为 `owner@global` + `private()`（与命令内部 `senderIsGlobalOwner` 同一身份集合）：群里不是全局 owner 的人发送时不回复（结局 `permission_denied`），私聊里得到全局 owner 说明，全局 owner 在群里发得到「请私聊」提示。执行时授权器拒绝时回复与 permit 拒绝同一段文案（不再是「仅可在私聊中使用」变体），并像 `restart` 一样记 `permission_denied`（原因 `not-global-owner`）、群里静默。`restart` 与 `config` 的拒绝都改用全局 owner 共享说明，「绑定」带上实际命令前缀。「是否已有全局 owner」只剩一处判定（实例内部 `hasGlobalOwner`）。
  - `@zhin.js/console-protocol`：新增导出 `isGlobalOwnerGrant(grant)`、`hasGlobalOwnerGrant(grants)`；`@zhin.js/host-http`、`@zhin.js/gateway` 判 Console 全局所有者改用它们（行为不变）。
  - `@zhin.js/plugin-bilibili`、`@zhin.js/plugin-earthquake`：（不兼容）删除未被引用的 `SUBSCRIPTION_PERMISSION_DENIED_MESSAGE` 与 i18n 的 `denied` 键；群里无权订阅时改回复标准拒绝 `describeConversationManagerDenial()`。
  - `@zhin.js/adapter-icqq`：`icqq login` 的操作者判定改用 `@zhin.js/core` 的 `isOwner()`（行为不变）。

- 58ce469: #1250 第 80 批：小型去重，统一多轨实现。

  - **重试、退避与可中断等待**：`@zhin.js/plugin-runtime` 新增 `sleep(ms, signal?)`（中止时清理计时器并以 `signal.reason` 拒绝）、`parseRetryAfterMs()`（解析秒数与 HTTP 日期：接受小数秒、`.5`、`5.` 与前导 `+`；负数、`1e3`、`0x10` 等非法值返回 `undefined`，AI 路径遇到这类值退回普通退避）和 `computeBackoffDelay()`（指数退避，默认等量抖动，可选对称抖动比例），插件经 `zhin.js` 导入。AI Provider 重试、OAuth 刷新冷却、适配器启动重试、地震与网络工具插件的 HTTP 重试、B 站直播 / QQ 扫码 / Telegram 轮询 / 微信 iLink 的等待全部改用它们；`@zhin.js/kernel` 删除不支持中止的 `sleep`，`@zhin.js/ai` 不再导出 `computeBackoffDelay` / `parseRetryAfterMs`，地震、网络工具和微信 iLink 插件不再导出各自的副本。
  - **HTML 转义**：`@zhin.js/plugin-runtime` 新增 `escapeHtml()`（转义 `& < > " '`），AI 输出、Console 页面外壳、`segment.escape`、链接海报和日历回调页改用它；`@zhin.js/pagemanager` 不再导出自己的 `escapeHtml`。`@zhin.js/jsx` 因只依赖 IM 契约保留同一实现，由契约测试锁定一致。
  - **`MarkdownView`**：`@zhin.js/components` 的 `Markdown` 组件改名为 `MarkdownView`（`MarkdownProps` → `MarkdownViewProps`，主题组件名同步），与 `zhin.js/jsx` 输出 Markdown 消息段的 `Markdown` 标签区分，不保留旧名。
  - **会话键**：`@zhin.js/console-protocol` 新增四段会话键 `parseConversationSessionKey()` / `formatConversationSessionKey()` / `isHashedSessionKey()`，网关用量统计（`parseSessionKey` 改名为 `sessionAddressOf`；endpoint 段为空的会话键照常解析，三段键只给出 platform）、实例的聊天记录与收件箱校验、沙盒页面都改用它。功能会话键在 plugin-runtime 与 console-protocol 中各保留一份（两者都是零依赖契约），由契约测试锁定语法、转义与错误文案一致。
  - **聊天角色导出格式**：`@zhin.js/console-protocol` 新增 `CHAT_ROLES_EXPORT_FORMAT`、`CHAT_ROLES_EXPORT_VERSION`、`CHAT_ROLES_BACKUP_DIRECTORY_SEGMENTS`、`chatRolesBackupFileName()` 与 `isConsoleChatRolesExport()`，`zhin chat-roles export|import` 与实例的导出、导入和迁移前备份共用；实例导入现在与 CLI 一样要求四个列表都存在。

### Patch Changes

- 00bebe8: 日期统一用 `formatDateTime`（zhinjs/zhin#1250 第 76 批）。不新增导出。

  - 修复：彩票插件的每日推荐、待评预测与"今天"判断，以及 B 站 `bili-login` 的登录过期日期，之前用 `toISOString()` 取 UTC 日期，北京时间 0–8 点会显示成前一天；现在按进程时区（`TZ`，否则系统时区）取日历日。彩票的 `predict_date` 也按同一时区记录，升级前在 0–8 点记下的待评预测仍是 UTC 日期。
  - 修复：Agent 的今日笔记文件 `data/memory/global/<YYYY-MM-DD>.md` 与好感度"每日增长上限"之前按 UTC 日，现在按进程时区的本地日（本地零点重置）。升级当天东八区 0–8 点会从前一天（UTC 日）的笔记文件切到本地日文件，此前这段时间写入的笔记留在前一天的文件里，不再作为"今日笔记"注入；好感度当日已用额度在升级后的第一次本地换日时重置一次。
  - 修复：日历插件创建全天事件时，Google（`date`）与 CalDAV（`VALUE=DATE`）之前取起止时刻的 UTC 日，配置时区在 UTC 以东时写成前一天；现在按插件配置的 `timezone` 取日期。Microsoft Graph 全天事件改为该日零点并带配置时区（之前是 UTC 时刻，非零点）。定时事件不变。
  - 文档：彩票 README 与生产部署文档说明按进程时区取日的功能，Docker 部署需设置 `TZ`（如 `TZ=Asia/Shanghai`）。
  - 显示改为仓库统一的 `YYYY-MM-DD HH:mm:ss`：`schedule_add` 一次性任务的执行时间（之前 `zh-CN` 本地格式）、RSS 预览条目时间（之前随语言变化，无法解析的日期原样显示）、GitHub `whoami` 的绑定时间、提醒任务详情（之前 `dateStyle: 'short'`，仍用配置的时区）。地震事件时间输出不变，零点不再可能显示为 `24`。
  - 记账、答案之书、进程监控与会话提醒的日期键改用 `formatDateTime`，输出不变。

- 49f9042: 统一显示语言类型、语言解析与列表分隔（zhinjs/zhin#1250 第 77 批）。

  - 新增：`@zhin.js/plugin-runtime` 导出 `formatList(locale, items, { separator? })`（`list` 默认 `、` / `, `，`comma` 为 `，` / `, `，`semicolon` 为 `；` / `; `；只拼接，英文不加 `and`），经 `zhin.js` 主入口与 `zhin.js/i18n` 再导出；`queryLocale()` 严格解析 `?locale=`；`projectLocale()` 从 `@zhin.js/core/runtime` 移入（core 不再导出）。
  - 命令的语言回退改走与消息相同的项目语言（先取 generation 投影的项目语言，再取根配置 `locale`）；之前命令只读根配置。消息自带的语言不合法时回退项目语言，而不是固定的 `zh-CN`。
  - Console 接口：`/conversations/workspaces/commands`、`/conversations/outcomes`、`/entries`、`/console/api/pages`、Console 首页与插件市场搜索的 `?locale=` 之前把非法值当作中文（或忽略），现在与任务、权限说明接口一样严格：不支持或重复的值返回 400（`invalid_locale`）。缺省行为不变。400 响应由 `@zhin.js/host-http` 新增导出的 `invalidLocaleResponse()` 统一给出（实例路由与插件市场共用，错误文案中英文一致：`locale 只能是 zh-CN 或 en（locale must be zh-CN or en）`；插件市场之前只有英文）。页面标题按 `titleI18n[locale]` 精确取值：`titleI18n` 的键只能是 `zh-CN` / `en`，不再按 `zh` / `en-US` 等前缀或其他键猜测。
  - 删除别名类型（不留兼容）：`@zhin.js/client` 的 `PluginUiLocale`（改为再导出 `@zhin.js/console-protocol` 新增的 `ConsoleLocale`），`@zhin.js/console-contract` 的 `PageKeywordLocale` 与 `DeclarativeUiLocale`（合并为本包零依赖的 `ConsoleLocale`），`@zhin.js/page` 对这两个类型的再导出；内部别名 `PlatformGuidanceLocale`、`CreateLocale`、`SandboxLocale`、`AdapterConsoleLocale` 一并删除。其余内联的 `'zh-CN' | 'en'` 改用 `Locale` / `ConsoleLocale`。
  - 语言判定改用 `resolveLocale()`：Agent 未执行工具提示与协作补充文案不再按 `en` 前缀猜测（`en-US` 之类的值回退中文；实际传入的都是已解析的语言）；系统提示的平台说明在缺少语言时改为中文（之前英文）；重启回执、消息结局文案、create-zhin、ICQQ 辅助脚本、成语接龙动作词同样改用统一解析。成语接龙的开局动作词（`chainStartAction`）之前把任何不以 `zh` 开头的值（如 `en-US`、`fr`）当作英文、给出 `pinyin` / `char`；现在只有 `en` 给出英文，其余不支持的值与缺省一样回退中文的「同音」/「同字」（`zh-CN` 与 `en` 不变）。B 站与掘金 Console RPC 删除各自的 `localeOf`。
  - 列表分隔统一用 `formatList`，输出不变：命令建议、回复兜底的工具列表、工具审批卡、群规豁免、账号命令字段、Console 提醒、地震订阅地区与数据源告警、游戏大厅、轮盘、文字冒险、猜词选项、内容审核动作、网络工具与 RSS 任务详情。`@zhin.js/command` 与 Agent 文案表中的分隔符条目（`suggestionSeparator`、`toolSeparator`、`listSeparator`、`detailSeparator`、猜词 `separator`）删除。

  `@zhin.js/console-ui`：仅补充 `ConsoleUiLocale` 与 `resolveConsoleUiLocale` 的说明注释（本地声明的理由、为何对浏览器语言标签保持宽松），行为不变。

  - @zhin.js/tool@1.1.25
  - @zhin.js/skill@1.1.22

## 0.1.17

### Patch Changes

- @zhin.js/skill@1.1.21
- @zhin.js/tool@1.1.24

## 0.1.16

### Patch Changes

- @zhin.js/skill@1.1.20
- @zhin.js/tool@1.1.23

## 0.1.15

### Patch Changes

- @zhin.js/tool@1.1.22

## 0.1.14

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- b56cca9: 定时任务（#1250）：`ScheduleJobRegistration` / `defineSchedule()` 新增可选 `title`、`titleI18n`、`kind`（`plugin-internal` 默认 / `user-task`）；实例 Schedule Host 记录每个任务最近一次实际执行的开始 / 结束时间与成功 / 失败（`lastRun`）。`schedule:list` / `cron:list` 的内存任务行新增可选 `kind`、`title`（按请求 `locale` 解析）、`titleI18n`、`displayName`、`lastExecutedAt`、`lastFinishedAt`、`lastDurationMs`、`lastStatus`、`lastError`，持久任务行新增 `kind: 'user-task'`。官方插件的内部轮询任务补中文标题。
  - @zhin.js/skill@1.1.19
  - @zhin.js/tool@1.1.21

## 0.1.13

### Patch Changes

- @zhin.js/skill@1.1.18
- @zhin.js/tool@1.1.20

## 0.1.12

### Patch Changes

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

- eae4ea8: 官方插件接入分层功能配置（ADR 0050 / 0055）：所有带配置 Schema 的官方插件都声明全部四级（全局 / 适配器 / 账号 / 会话），Console 的适配器、账号与会话页面都能开关它们；密钥、调度与全局资源类字段收窄为仅全局。answers 与 group-suite 可按会话覆盖字段并开放群内自助字段（答题超时、科目一开关；欢迎语、排行条数、教学冷却与分页），ledger 的 `reportWhenEmpty` 可按订阅者会话覆盖。主动推送在发送前按目标会话检查开关：提醒（含管理员提醒）、日历授权通知、地震速报、记账日报、彩票推送、B 站开播 / 动态推送、activity-feedback 的状态提示在已停用的账号或会话上不再发送；roulette 的超时扫描在已停用的会话里静默结束对局（不结算、不禁言、不发消息）。`@zhin.js/schema` 新增 `.fieldLevels(levels)` 用于收窄单个字段的层级；`@zhin.js/testing` 的假插件上下文提供 `isEnabledFor` / `configFor`（`feature` 选项可模拟按会话停用与字段覆盖）。
- 68659cd: `zod` 改为运行时依赖（原为可选对等依赖）：插件运行时在启动时就会加载这些包的约定目录（Agent 工具、命令等），其中静态导入了 `zod`；生成的项目里没有安装可选对等依赖，启动会报 `Cannot find package 'zod'`。范围为 `^4.6.7`（已修复的版本）。
- Updated dependencies [e1fda87]
- Updated dependencies [120e225]
  - @zhin.js/skill@1.1.17
  - @zhin.js/tool@1.1.19

## 0.1.11

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
  - @zhin.js/skill@1.1.16
  - @zhin.js/tool@1.1.18

## 0.1.10

### Patch Changes

- 5419b88: Add generation-scoped `definePluginStore` (`PluginStore`), `Scope.get()`, declarative `PluginSetupCapabilities` return in `definePlugin()`, and `JsonSerializable<T>` typing on `PluginStateStore` to eliminate `as never` casts on TypeScript interfaces.
  - @zhin.js/tool@1.1.17
  - @zhin.js/skill@1.1.15

## 0.1.9

### Patch Changes

- Updated dependencies [72b5a12]
  - @zhin.js/tool@1.1.16
  - @zhin.js/skill@1.1.14

## 0.1.8

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [0315ba0]
- Updated dependencies [00be764]
  - @zhin.js/tool@1.1.15
  - @zhin.js/skill@1.1.13

## 0.1.7

### Patch Changes

- Updated dependencies [af8f803]
- Updated dependencies [032dc96]
  - @zhin.js/tool@1.1.14
  - @zhin.js/skill@1.1.12

## 0.1.6

### Patch Changes

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

  - @zhin.js/skill@1.1.11
  - @zhin.js/tool@1.1.13

## 0.1.5

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/tool@1.1.12

## 0.1.4

### Patch Changes

- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
  - @zhin.js/tool@1.1.11

## 0.1.3

### Patch Changes

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [17d1301]
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10

## 0.1.2

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.1

### Patch Changes

- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- 520f64b: Add `@zhin.js/plugin-earthquake`: the `地震` query plus per-conversation alert subscriptions (`地震 订阅|退订|订阅状态`) with magnitude thresholds and region keywords, merging CENC (mirror-backed, configurable URLs) and USGS with cross-source de-duplication. Every request has a timeout, jittered exponential backoff with Retry-After support, per-source cooldown and failover; the poller never throws, baselines each source before pushing, and rate-limits pushes per conversation. Includes the read-only agent tool `recent_earthquakes`.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
  - @zhin.js/tool@1.1.8
  - @zhin.js/skill@1.1.8
