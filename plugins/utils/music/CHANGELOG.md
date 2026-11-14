# @zhin.js/plugin-music

## 1.1.29

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- Updated dependencies [7cd299e]
- Updated dependencies [7cd299e]
- Updated dependencies [9026329]
- Updated dependencies [ccab2c1]
- Updated dependencies [c6b5563]
- Updated dependencies [e0b4e51]
- Updated dependencies [cca4427]
- Updated dependencies [704c7a4]
- Updated dependencies [07bd3dc]
  - @zhin.js/core@1.8.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/skill@1.1.19
  - @zhin.js/tool@1.1.21

## 1.1.28

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [ce8edf5]
- Updated dependencies [f2fa3d7]
- Updated dependencies [eba2566]
- Updated dependencies [ac72706]
- Updated dependencies [8f237bd]
- Updated dependencies [b2aae3c]
- Updated dependencies [3c14aeb]
  - @zhin.js/core@1.7.0
  - @zhin.js/skill@1.1.18
  - @zhin.js/tool@1.1.20

## 1.1.27

### Patch Changes

- d80964d: 修复 1.2 发版撞号：`@zhin.js/core` 与 `@zhin.js/agent` 按 minor 升到 1.2.0 时，npm 上早已有同号的旧架构版本（core 1.2.0–1.5.16、agent 1.2.0–1.2.1），`changeset publish` 只提示 already published 就跳过，导致 `zhin.js@1.1.26` 等已发布的包依赖了旧 core / agent，启动时缺少 `CHAT_ROLES`。

  本次把 core 发为 1.6.0、agent 发为 1.3.0（npm 上第一个空闲的 minor），并重新发布所有直接依赖它们的包，让依赖版本与 peer 范围指向新版本（`^1.6.0` / `^1.3.0`，不再落进旧架构版本）。

- Updated dependencies [d80964d]
  - @zhin.js/core@1.6.0

## 1.1.26

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

- Updated dependencies [53932e5]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [63595fc]
- Updated dependencies [c2bbdcf]
- Updated dependencies [663473b]
- Updated dependencies [c606d51]
- Updated dependencies [1e54b1e]
  - @zhin.js/core@1.2.0
  - @zhin.js/skill@1.1.17
  - @zhin.js/tool@1.1.19
  - @zhin.js/im-contract@1.1.14

## 1.1.25

### Patch Changes

- @zhin.js/core@1.1.60

## 1.1.24

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/core@1.1.59
  - @zhin.js/skill@1.1.16
  - @zhin.js/tool@1.1.18

## 1.1.23

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/core@1.1.58
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/tool@1.1.17
  - @zhin.js/skill@1.1.15

## 1.1.22

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/tool@1.1.16
  - @zhin.js/skill@1.1.14

## 1.1.21

### Patch Changes

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
- Updated dependencies [00be764]
  - @zhin.js/core@1.1.56
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/tool@1.1.15
  - @zhin.js/skill@1.1.13

## 1.1.20

### Patch Changes

- Updated dependencies [c15cef9]
- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/core@1.1.55
  - @zhin.js/tool@1.1.14
  - @zhin.js/skill@1.1.12

## 1.1.19

### Patch Changes

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
  - @zhin.js/core@1.1.54
  - @zhin.js/skill@1.1.11
  - @zhin.js/tool@1.1.13

## 1.1.18

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/tool@1.1.12

## 1.1.17

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/tool@1.1.11
  - @zhin.js/im-contract@1.1.8

## 1.1.16

### Patch Changes

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/core@1.1.51
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7

## 1.1.15

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 1.1.14

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49

## 1.1.13

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.12

### Patch Changes

- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/tool@1.1.8
  - @zhin.js/core@1.1.47
  - @zhin.js/skill@1.1.8

## 1.1.11

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 1.1.10

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45

## 1.1.9

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/core@1.1.44
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6

## 1.1.8

### Patch Changes

- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/core@1.1.43
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5

## 1.1.7

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42

## 1.1.6

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/skill@1.1.4
  - @zhin.js/tool@1.1.4

## 1.1.5

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/core@1.1.40
  - @zhin.js/tool@1.1.3
  - @zhin.js/skill@1.1.3

## 1.1.4

### Patch Changes

- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39

## 1.1.3

### Patch Changes

- Updated dependencies [5b5d270]
  - @zhin.js/core@1.1.38
  - @zhin.js/skill@1.1.2
  - @zhin.js/tool@1.1.2

## 1.1.2

### Patch Changes

- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- b16f486: Move pending music selections and QR login coordination into the generation-owned `MusicRuntime`. The plugin now creates and disposes isolated `MusicSearchSessions` and `QrLoginRuntime` instances instead of sharing process-global maps and login providers across reloads.
- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [25a845a]
- Updated dependencies [9110ab8]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [535fed1]
- Updated dependencies [1cb1163]
- Updated dependencies [be3061e]
- Updated dependencies [75f8332]
- Updated dependencies [81935e2]
- Updated dependencies [f9ed01b]
- Updated dependencies [ac0ab50]
- Updated dependencies [5140ce1]
- Updated dependencies [522d75f]
- Updated dependencies [a7611b3]
- Updated dependencies [8823044]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [698f16f]
- Updated dependencies [5c3858e]
- Updated dependencies [33ea736]
  - @zhin.js/core@1.1.37
  - @zhin.js/tool@1.1.1
  - @zhin.js/skill@1.1.1

## 1.1.1

### Patch Changes

- 33b1582: Update vulnerable dependencies and replace unsafe HTML and protocol-text regular expressions with bounded scanners.
  - @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/core@1.1.35
  - @zhin.js/tool@1.1.0

## 9.0.1

### Patch Changes

- @zhin.js/core@1.5.16
- @zhin.js/adapter-icqq@10.0.1
- zhin.js@7.0.1

## 9.0.0

### Patch Changes

- zhin.js@7.0.0
- @zhin.js/adapter-icqq@10.0.0

## 8.0.8

### Patch Changes

- zhin.js@6.0.15
- @zhin.js/adapter-icqq@9.0.8

## 8.0.7

### Patch Changes

- zhin.js@6.0.15
- @zhin.js/adapter-icqq@9.0.7

## 8.0.6

### Patch Changes

- zhin.js@6.0.15
- @zhin.js/adapter-icqq@9.0.6
- @zhin.js/core@1.5.15

## 8.0.5

### Patch Changes

- @zhin.js/core@1.5.15
- zhin.js@6.0.15
- @zhin.js/adapter-icqq@9.0.5

## 8.0.4

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15
  - @zhin.js/adapter-icqq@9.0.4

## 8.0.3

### Patch Changes

- zhin.js@6.0.14
- @zhin.js/adapter-icqq@9.0.3

## 8.0.2

### Patch Changes

- Updated dependencies [45d4f24]
  - @zhin.js/adapter-icqq@9.0.2
  - zhin.js@6.0.14

## 8.0.1

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [e9c6a73]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14
  - @zhin.js/adapter-icqq@9.0.1
  - @zhin.js/command@1.0.16
  - @zhin.js/component@1.0.13
  - @zhin.js/middleware@1.0.13
  - @zhin.js/tool@1.0.13
  - zhin.js@6.0.14

## 8.0.0

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13
  - @zhin.js/adapter-icqq@9.0.0
  - zhin.js@6.0.13

## 7.0.14

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [7cd8b34]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - @zhin.js/adapter-icqq@8.0.14
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/component@1.0.12
  - @zhin.js/middleware@1.0.12
  - @zhin.js/tool@1.0.12

## 7.0.13

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11
- @zhin.js/adapter-icqq@8.0.13

## 7.0.12

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
- Updated dependencies [3556601]
  - @zhin.js/adapter-icqq@8.0.12
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 7.0.11

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
- Updated dependencies [eb84b77]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/adapter-icqq@8.0.11
  - @zhin.js/tool@1.0.11

## 7.0.10

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/adapter-icqq@8.0.10
  - @zhin.js/command@1.0.13
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/component@1.0.10
  - @zhin.js/middleware@1.0.10

## 7.0.9

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/tool@1.0.9
  - @zhin.js/command@1.0.12
  - @zhin.js/component@1.0.9
  - @zhin.js/middleware@1.0.9
  - @zhin.js/adapter-icqq@8.0.9

## 7.0.8

### Patch Changes

- @zhin.js/adapter-icqq@8.0.8

## 7.0.7

### Patch Changes

- @zhin.js/adapter-icqq@8.0.7

## 7.0.6

### Patch Changes

- @zhin.js/adapter-icqq@8.0.6

## 7.0.5

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/tool@1.0.8
  - @zhin.js/adapter-icqq@8.0.5
  - @zhin.js/component@1.0.8

## 7.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/component@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/tool@1.0.7
  - @zhin.js/adapter-icqq@8.0.4

## 7.0.3

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/adapter-icqq@8.0.3
  - @zhin.js/component@1.0.6
  - @zhin.js/tool@1.0.6

## 7.0.2

### Patch Changes

- @zhin.js/adapter-icqq@8.0.2

## 7.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/component@1.0.5
  - @zhin.js/tool@1.0.5
  - @zhin.js/adapter-icqq@8.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
  - @zhin.js/adapter-icqq@8.0.0

## 6.0.5

### Patch Changes

- @zhin.js/adapter-icqq@7.0.5

## 6.0.4

### Patch Changes

- @zhin.js/adapter-icqq@7.0.4

## 6.0.3

### Patch Changes

- @zhin.js/adapter-icqq@7.0.3

## 6.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/adapter-icqq@7.0.2
  - @zhin.js/component@1.0.4
  - @zhin.js/tool@1.0.4

## 6.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [078e3f7]
- Updated dependencies [74b035c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/tool@1.0.3
  - @zhin.js/adapter-icqq@7.0.1
  - @zhin.js/component@1.0.3

## 6.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [713445c]
- Updated dependencies [f32c424]
  - @zhin.js/adapter-icqq@7.0.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/component@1.0.2
  - @zhin.js/tool@1.0.2

## 5.0.3

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
- Updated dependencies [447f3e2]
  - @zhin.js/adapter-icqq@6.0.3
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/component@1.0.1
  - @zhin.js/tool@1.0.1

## 5.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/adapter-icqq@6.0.2
  - zhin.js@4.1.2

## 5.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - zhin.js@4.1.1
  - @zhin.js/adapter-icqq@6.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/adapter-icqq@6.0.0
  - zhin.js@4.1.0

## 4.0.2

### Patch Changes

- zhin.js@4.0.1
- @zhin.js/adapter-icqq@5.0.2

## 4.0.1

### Patch Changes

- Updated dependencies [ae5239c]
  - @zhin.js/adapter-icqq@5.0.1
  - zhin.js@4.0.1

## 4.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/adapter-icqq@5.0.0

## 3.0.1

### Patch Changes

- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/adapter-icqq@4.0.1
  - zhin.js@2.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [e62c23a]
  - @zhin.js/adapter-icqq@4.0.0
  - zhin.js@2.0.0

## 2.0.11

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/adapter-icqq@3.0.11

## 2.0.10

### Patch Changes

- Updated dependencies [3735e96]
  - @zhin.js/adapter-icqq@3.0.10
  - zhin.js@1.0.91

## 2.0.9

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90
  - @zhin.js/adapter-icqq@3.0.9

## 2.0.8

### Patch Changes

- Updated dependencies [c78d2cd]
  - @zhin.js/adapter-icqq@3.0.8
  - zhin.js@1.0.89

## 2.0.7

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88
  - @zhin.js/adapter-icqq@3.0.7

## 2.0.6

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/adapter-icqq@3.0.6
  - zhin.js@1.0.87

## 2.0.5

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [a51d504]
- Updated dependencies [7e14f8d]
  - @zhin.js/adapter-icqq@3.0.5
  - zhin.js@1.0.86

## 2.0.4

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/adapter-icqq@3.0.4

## 2.0.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/adapter-icqq@3.0.3

## 2.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/adapter-icqq@3.0.2
  - zhin.js@1.0.83

## 2.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82
  - @zhin.js/adapter-icqq@3.0.1

## 2.0.0

### Patch Changes

- @zhin.js/adapter-icqq@3.0.0

## 1.0.26

### Patch Changes

- Updated dependencies [8086ccb]
  - @zhin.js/adapter-icqq@2.0.26
  - zhin.js@1.0.81

## 1.0.25

### Patch Changes

- Updated dependencies [3b3e49b]
  - @zhin.js/adapter-icqq@2.0.25
  - zhin.js@1.0.80

## 1.0.24

### Patch Changes

- Updated dependencies [dc04e4a]
  - @zhin.js/adapter-icqq@2.0.24

## 1.0.23

### Patch Changes

- Updated dependencies [92da96d]
  - @zhin.js/adapter-icqq@2.0.23
  - zhin.js@1.0.79

## 1.0.22

### Patch Changes

- @zhin.js/adapter-icqq@2.0.22
- zhin.js@1.0.78

## 1.0.21

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/adapter-icqq@2.0.21

## 1.0.20

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/adapter-icqq@2.0.20

## 1.0.19

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/adapter-icqq@2.0.19

## 1.0.18

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/adapter-icqq@2.0.18

## 1.0.17

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/adapter-icqq@2.0.17

## 1.0.16

### Patch Changes

- @zhin.js/adapter-icqq@2.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [abc75a4]
  - @zhin.js/adapter-icqq@2.0.15

## 1.0.14

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/adapter-icqq@2.0.14

## 1.0.13

### Patch Changes

- @zhin.js/adapter-icqq@2.0.13

## 1.0.12

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/adapter-icqq@2.0.12

## 1.0.11

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/adapter-icqq@2.0.11

## 1.0.10

### Patch Changes

- @zhin.js/adapter-icqq@2.0.10
- zhin.js@1.0.67

## 1.0.9

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/adapter-icqq@2.0.9

## 1.0.8

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/adapter-icqq@2.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [36c1b8f]
  - @zhin.js/adapter-icqq@2.0.7

## 1.0.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/adapter-icqq@2.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/adapter-icqq@2.0.5
  - zhin.js@1.0.63

## 1.0.4

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/adapter-icqq@2.0.4

## 1.0.3

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/adapter-icqq@2.0.3

## 1.0.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/adapter-icqq@2.0.2
  - zhin.js@1.0.60

## 1.0.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/adapter-icqq@2.0.1

## 1.0.0

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/adapter-icqq@2.0.0

## 0.0.52

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/adapter-icqq@1.0.71

## 0.0.51

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/adapter-icqq@1.0.70

## 0.0.50

### Patch Changes

- @zhin.js/adapter-icqq@1.0.69

## 0.0.49

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/adapter-icqq@1.0.68

## 0.0.48

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/adapter-icqq@1.0.67

## 0.0.47

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/adapter-icqq@1.0.66

## 0.0.46

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/adapter-icqq@1.0.65

## 0.0.45

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/adapter-icqq@1.0.64

## 0.0.44

### Patch Changes

- @zhin.js/adapter-icqq@1.0.63

## 0.0.43

### Patch Changes

- Updated dependencies [607acc4]
  - @zhin.js/adapter-icqq@1.0.62
  - zhin.js@1.0.51

## 0.0.42

### Patch Changes

- @zhin.js/adapter-icqq@1.0.61

## 0.0.41

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/adapter-icqq@1.0.60

## 0.0.40

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/adapter-icqq@1.0.59

## 0.0.39

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/adapter-icqq@1.0.58

## 0.0.38

### Patch Changes

- Updated dependencies [de3e352]
  - @zhin.js/adapter-icqq@1.0.57
  - zhin.js@1.0.47

## 0.0.37

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/adapter-icqq@1.0.56

## 0.0.36

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/adapter-icqq@1.0.55

## 0.0.35

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/adapter-icqq@1.0.54

## 0.0.34

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43
  - @zhin.js/adapter-icqq@1.0.53

## 0.0.33

### Patch Changes

- @zhin.js/adapter-icqq@1.0.52

## 0.0.32

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/adapter-icqq@1.0.51

## 0.0.31

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/adapter-icqq@1.0.50
  - zhin.js@1.0.41

## 0.0.30

### Patch Changes

- Updated dependencies [7ef9057]
  - @zhin.js/adapter-icqq@1.0.49
  - zhin.js@1.0.40

## 0.0.29

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/adapter-icqq@1.0.48

## 0.0.28

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/adapter-icqq@1.0.47
  - zhin.js@1.0.38

## 0.0.27

### Patch Changes

- @zhin.js/adapter-icqq@1.0.46

## 0.0.26

### Patch Changes

- Updated dependencies [e23e732]
  - @zhin.js/adapter-icqq@1.0.45

## 0.0.25

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/adapter-icqq@1.0.44

## 0.0.24

### Patch Changes

- @zhin.js/adapter-icqq@1.0.43
- zhin.js@1.0.36

## 0.0.23

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/adapter-icqq@1.0.42

## 0.0.22

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/adapter-icqq@1.0.41

## 0.0.21

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/adapter-icqq@1.0.40

## 0.0.20

### Patch Changes

- Updated dependencies [48481a8]
  - @zhin.js/adapter-icqq@1.0.39

## 0.0.19

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/adapter-icqq@1.0.38

## 0.0.18

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/adapter-icqq@1.0.37

## 0.0.17

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/adapter-icqq@1.0.36

## 0.0.16

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/adapter-icqq@1.0.35

## 0.0.15

### Patch Changes

- @zhin.js/adapter-icqq@1.0.34
- zhin.js@1.0.28

## 0.0.14

### Patch Changes

- @zhin.js/adapter-icqq@1.0.33

## 0.0.13

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27
  - @zhin.js/adapter-icqq@1.0.32

## 0.0.12

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/adapter-icqq@1.0.31
  - zhin.js@1.0.26

## 0.0.11

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25
  - @zhin.js/adapter-icqq@1.0.30

## 0.0.10

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/adapter-icqq@1.0.29

## 0.0.9

### Patch Changes

- Updated dependencies [52ae08a]
  - @zhin.js/adapter-icqq@1.0.28
  - zhin.js@1.0.23

## 0.0.8

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/adapter-icqq@1.0.27

## 0.0.7

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/adapter-icqq@1.0.26

## 0.0.6

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/adapter-icqq@1.0.25
  - zhin.js@1.0.20

## 0.0.5

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/adapter-icqq@1.0.24

## 0.0.4

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/adapter-icqq@1.0.23

## 0.0.3

### Patch Changes

- @zhin.js/adapter-icqq@1.0.22

## 0.0.2

### Patch Changes

- @zhin.js/adapter-icqq@1.0.21
