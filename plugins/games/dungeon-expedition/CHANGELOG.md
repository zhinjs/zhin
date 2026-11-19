# @zhin.js/plugin-dungeon-expedition

## 1.1.35

### Patch Changes

- Updated dependencies [23eb6ef]
  - @zhin.js/core@1.13.1
  - @zhin.js/game-kit@1.1.35

## 1.1.34

### Patch Changes

- Updated dependencies [7131501]
- Updated dependencies [1414572]
- Updated dependencies [257d289]
  - @zhin.js/core@1.13.0
  - @zhin.js/game-kit@1.1.34

## 1.1.33

### Patch Changes

- 4ff83f3: 命名空间下的参数指令、超过 10 项的选择、猜谜与地牢远征的入口（#1250 第 37 批）。

  - `command-namespace-param-commands-swallowed`：路由顺序原先是「所有静态路由先于所有带参数段的路由」，于是只要有一条更短的静态路由（例如另一个插件或根项目里的 `60s`）能匹配开头，`60s fanyi 你好`、`60s douyin`、`60s fuel 四川` 就会被它吃掉，无参数的指令又会忽略多出来的词，日志照样是 `command_replied | executed`。现在按字面路径长度优先：字面词更多的路由先匹配，字面长度相同时静态路由仍先于参数路由。`<命名空间>` 与 `<命名空间> --help`（以及任意指令组的 `<组> --help`）列出该组下发送者能用的全部指令；某条指令的 `--help` 也列出它下面（至少多一个字面词）的子指令，参数指令不会把自己列进去。插件的 `commandNamespace` 与它自己的指令同名（命名空间 `60s` + 指令 `60s` → `60s 60s`）时，实例启动时记一条 `command_namespace_collision` 警告。
  - `select-over-10-options-no-buttons`：core 不再只给 ≤10 项的 `select` 生成按钮，所有选项都交给端点；选择提示改为「回复序号或选项名称。」，不再声称「可以点击按钮」。适配器能力画像新增可选的 `segments.interactiveLimits.maxButtons`（`@zhin.js/adapter` 新增类型 `AdapterInteractiveLimits`）：原生按钮的端点超过上限时，前 N 项保留按钮，其余选项改成紧挨按钮的序号列表（回复序号或名称照常生效；整块键盘一起登记序号，列出的序号接在按钮之后，回复「1」仍是第一个按钮）；纯文本端点照旧降级为序号列表。QQ 官方、Discord、Slack 声明 25，Telegram 声明 100；Sandbox 不设上限，按钮较多时在气泡内滚动。`@zhin.js/core` 新增导出 `resolveOutboundMaxButtons()` / `applyOutboundButtonLimit()`。该字段与 Sandbox 全能力 ADR 草案 P3 的 `interactive` 对象形式（`{ buttons: { maxTotal } }`）对应：`maxButtons` 将折进 `maxTotal`，字符串形式的 `interactive` 继续作为简写有效；本批不新增 `select` 段。
  - 猜谜（字谜 / 猜成语）：直接回复「提示」「跳过」「结束」（以及 hint / skip / end）按对应操作处理，卡片上写明可以这样回复。提示给出真实信息：成语给第 1 个字，字谜给包含答案的 4 个候选字；提示扣 3 分（分数不会低于 0）、不再清零连击，每局最多 3 次（分数为 0 时提示也不是无限免费）。「结束」（按钮或 `猜谜 quit`）公布当前题的答案并结算本局（已答题数、得分、最佳连击）。题库去掉重复的标点（「……活下去。。」）。
  - `dungeon-entry-unhelpful`：`dungeon` / `地牢远征` / `地牢` 不带参数且当前频道没有队伍时显示帮助与开局方式（`dungeon start`）；指令新增别名「地牢」。群里的卡片是整个频道共用的，所以所有人看到同一套按钮、同样的序号（大厅：加入队伍 / 准备 / 开始远征 / 解散队伍），非队长点「开始」或「解散」会收到明确的拒绝；大厅里提示其他人回复「加入队伍」入队。结束远征先要求队长确认：确认请求记录在新的会话版本上，只有这张确认卡（或队长在它仍是最新状态时回复「确认结束」/ 序号）能结束远征，队伍之后有任何动作或选择「继续远征」都会让它失效；结束后给出结算（到达层数、清理房间数、队伍金币）。「你是不是想用」在指令名都不相近时也和插件显示名比对（带指令前缀时 `地牢探险` → 显示名为「地牢远征」的插件）；没有前缀（私聊、@机器人）时只按前一半逐字相同放宽的匹配要求这一半至少 4 个字，`天气不错`、`天气` 这类聊天不会被显示名「天气预报」截走。
  - `60s-gold-currency-mixed`：金价按接口返回的单位写货币符号（美元用 `$`、人民币用 `¥`，其他币种不加符号）。

- Updated dependencies [9ce43fe]
- Updated dependencies [661cc7c]
- Updated dependencies [4ff83f3]
- Updated dependencies [1dc5324]
- Updated dependencies [4bd5b64]
- Updated dependencies [2534b1d]
  - @zhin.js/core@1.12.0
  - @zhin.js/game-kit@1.1.33

## 1.1.32

### Patch Changes

- f1affdd: 游戏输入与入站结局（zhinjs/zhin#1250 第 34 批）：

  - `game-input-also-reaches-agent`：猜数字的数字中间件在游戏回复之后仍调用 `next()`，同一条「50」又流到 Agent，于是有两条回复。现在游戏处理过的输入就结束分发，只有没有对局时才放行。`replyGameOperation()` 返回游戏是否回复了（`boolean`），并接受可选的 `input`：传入后把消息结局记成 `handler_replied` / `game_input`。所有游戏的对局中间件都会传入它。成语接龙和猜谜的自由文本作答也改为只在游戏真正处理了输入时才结束分发。
  - `inbound-outcome-middleware-reply-mislabeled`：中间件先回复（回执 `sent`）再停止分发的，结局记 `handler_replied` / `middleware_replied`。只看停止分发的那个中间件所属插件自己送达的回复：别的插件先回复过、而它没回复就停止的，仍记 `filtered_by_policy` / `middleware_stopped`。入站结局端口 `InboundOutcomeSink` 新增可选方法 `replied(owner?)`。ADR 0061 已同步；没有改动已有的 reason 取值。
  - `game-button-label-text-not-accepted`：游戏会话同时接受序号和按钮文字（忽略 emoji、空白与大小写），例如「要牌」「🏳️ 放弃」。对局结束后的文字「再来一局」（以及二十一点的序号 1）只在结束后 10 分钟内有效，之后按普通聊天放行。地牢远征在群里由整个频道共享：不在队伍里的人只能用文字「加入」，其余文字和序号都放行。`buildChoiceKeyboard()` / `buildGridKeyboard()` 统一在卡片上加一行「回复序号或按钮文字也可以」：猜数字的数字是猜测本身，所以只提示按钮文字；对局结束后没有可点按钮时不加。键盘段新增 `fallback.layout: 'inline'`，在能力画像为 `interactive: 'text'` 的适配器上，按钮渲染成一行 `1. 要牌  2. 停牌  3. 放弃`。井字棋改为按棋盘位置编号：回复 1–9 落在对应格，卡片上写明「回复 1–9 在对应位置落子（左上为 1，右下为 9）」。
  - `game-command-names-mixed-language`：所有游戏的子命令都有中英两种写法，都能用（开始 / 继续 / 退出 / 认输 / 加入 / 离开 / 观战 / 人机）。帮助和提示里的写法跟命令名同一种语言，`formatGameHelp()` / `gameCommandHint()` 统一处理。井字棋的中文命令改为与标题一致的「井字棋」，旧名「井字游戏」仍可用。约定写在 `plugins/games/README.md`。
  - `near-miss-suggestion-param-misleading`：指令参数新增只用于显示的 `suggestions` / `suggestionsI18n`。「你是不是想用」改为列出真实子命令（`玩石头剪刀布 开始|继续|退出`），不再显示 `[action]`。「玩石头剪刀布 石头」/「猜拳 石头」现在一步开局并出拳。
  - `game-quit-means-forfeit`：会判负的退出（井字棋、成语接龙）在帮助里写「认输并结束对局」；其他游戏的退出写「结束当前对局（不计胜负）」。
  - `command-menu-unreadable-in-sandbox`：指令菜单模板加了媒体查询：宽度 860px 以下为两列，560px 以下为单列，名称按词换行。Sandbox 按 HTML 段请求的 `width` 渲染，再等比缩小到聊天栏宽度，和平台实际收到的图片一致。
  - `config-write-moves-inline-comment`：YAML 逐键补丁不再把写在键行上的注释（`"user:…": # …` 后接块状列表或映射）挪到下一行。补丁没有触及的顶层条目逐字节保留原文，flow 集合的空格风格也沿用原文件。`zhin disable` 现在只改 `disable_plugins`。

- Updated dependencies [f370ec5]
- Updated dependencies [48dc650]
- Updated dependencies [19526a6]
- Updated dependencies [f1affdd]
- Updated dependencies [2ab7fb9]
  - @zhin.js/core@1.11.0
  - @zhin.js/game-kit@1.1.32

## 1.1.31

### Patch Changes

- Updated dependencies [816c3f3]
  - @zhin.js/core@1.10.0
  - @zhin.js/game-kit@1.1.31

## 1.1.30

### Patch Changes

- Updated dependencies [da9dc8a]
- Updated dependencies [bc31cd3]
- Updated dependencies [760e9f5]
- Updated dependencies [5d90159]
- Updated dependencies [73475bd]
- Updated dependencies [809c6ee]
  - @zhin.js/core@1.9.0
  - @zhin.js/game-kit@1.1.30

## 1.1.29

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- 9026329: 官方插件指令补中文名与本地化说明，并统一子命令写法（#1250）：游戏指令新增中文别名（猜数字、玩石头剪刀布、游戏大厅 / 游戏列表、玩二十一点、骰子对决、地牢远征、成语接龙、文字冒险、井字游戏、猜谜语、俄罗斯轮盘），中文菜单显示中文名，说明改为中文并附英文 `descriptionI18n`；连字符指令新增空格子命令写法并在菜单中显示（`rss add` / `rss list` …、`lottery today` …、`keyword add` / `stats week` …、`ledger add` …、`repeater status`、`process status`、`game stats` / `game ranking`、`bili draft list` / `bili login status` …、`juejin draft list` …），旧的连字符名称继续可用。`teach-list` 因 `teach <问题> <答案>` 接收自由文本而保留原名。

  过于通用的顶层指令增加带插件名的形式（旧名保留为别名）：二维码 `qrcode gen` / `生成二维码`、`qrcode scan` / `识别二维码`；短链 `生成短链 <url>`、`short expand <url>` / `还原短链 <url>`，菜单显示新形式。未配置指令前缀时日常群聊里的高频词不会被当成指令：不使用单独的「游戏」「二十一点」（也是时间）「石头剪刀布」「短链」「short」作别名。

  **升级注意**：新增的别名与项目里已有的同名指令（或其他插件的别名）冲突时，启动会以 `Duplicate Command route` 失败；可用 `disabledCommands` 停用其中一条，或用 `commandNamespace` 给插件指令加命名空间。

- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- Updated dependencies [7cd299e]
- Updated dependencies [7cd299e]
- Updated dependencies [9026329]
- Updated dependencies [ccab2c1]
- Updated dependencies [c6b5563]
- Updated dependencies [e0b4e51]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
- Updated dependencies [07bd3dc]
  - @zhin.js/core@1.8.0
  - @zhin.js/game-kit@1.1.29

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
  - @zhin.js/game-kit@1.1.28

## 1.1.27

### Patch Changes

- d80964d: 修复 1.2 发版撞号：`@zhin.js/core` 与 `@zhin.js/agent` 按 minor 升到 1.2.0 时，npm 上早已有同号的旧架构版本（core 1.2.0–1.5.16、agent 1.2.0–1.2.1），`changeset publish` 只提示 already published 就跳过，导致 `zhin.js@1.1.26` 等已发布的包依赖了旧 core / agent，启动时缺少 `CHAT_ROLES`。

  本次把 core 发为 1.6.0、agent 发为 1.3.0（npm 上第一个空闲的 minor），并重新发布所有直接依赖它们的包，让依赖版本与 peer 范围指向新版本（`^1.6.0` / `^1.3.0`，不再落进旧架构版本）。

- Updated dependencies [d80964d]
  - @zhin.js/core@1.6.0
  - @zhin.js/game-kit@1.1.27

## 1.1.26

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
  - @zhin.js/game-kit@1.1.26

## 1.1.25

### Patch Changes

- @zhin.js/core@1.1.60
- @zhin.js/game-kit@1.1.25

## 1.1.24

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/core@1.1.59
  - @zhin.js/game-kit@1.1.24

## 1.1.23

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/core@1.1.58
  - @zhin.js/game-kit@1.1.23

## 1.1.22

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/game-kit@1.1.22

## 1.1.21

### Patch Changes

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/game-kit@1.1.21

## 1.1.20

### Patch Changes

- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/core@1.1.55
  - @zhin.js/game-kit@1.1.20

## 1.1.19

### Patch Changes

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
  - @zhin.js/core@1.1.54
  - @zhin.js/game-kit@1.1.19

## 1.1.18

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/core@1.1.53
  - @zhin.js/game-kit@1.1.18

## 1.1.17

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [4d728c0]
- Updated dependencies [24a2b71]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/game-kit@1.1.17

## 1.1.16

### Patch Changes

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [53bc6a0]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/core@1.1.51
  - @zhin.js/game-kit@1.1.16

## 1.1.15

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/game-kit@1.1.15

## 1.1.14

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49
  - @zhin.js/game-kit@1.1.14

## 1.1.13

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48
  - @zhin.js/game-kit@1.1.13

## 1.1.12

### Patch Changes

- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [53d5bd7]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/core@1.1.47
  - @zhin.js/game-kit@1.1.12

## 1.1.11

### Patch Changes

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/game-kit@1.1.11

## 1.1.10

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45
  - @zhin.js/game-kit@1.1.10

## 1.1.9

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/core@1.1.44
  - @zhin.js/game-kit@1.1.9

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
  - @zhin.js/game-kit@1.1.8

## 1.1.7

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42
  - @zhin.js/game-kit@1.1.7

## 1.1.6

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/game-kit@1.1.6

## 1.1.5

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/core@1.1.40
  - @zhin.js/game-kit@1.1.5

## 1.1.4

### Patch Changes

- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/game-kit@1.1.4

## 1.1.3

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/core@1.1.38
  - @zhin.js/game-kit@1.1.3

## 1.1.2

### Patch Changes

- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 0a6edaf: Replace the process-global game registry and implicit current database with a generation-owned Game Feature projection. Each game now publishes a typed Game capability with its own record port, while the hub reads the atomic GameIndex from the active operation snapshot.

  This removes setup-order routing, cross-Root state, HMR registration stacks, and the legacy GameKit singleton APIs.

- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [9110ab8]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [0a6edaf]
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
- Updated dependencies [5c3858e]
  - @zhin.js/core@1.1.37
  - @zhin.js/game-kit@1.1.2

## 1.1.1

### Patch Changes

- @zhin.js/core@1.1.36
- @zhin.js/game-kit@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
- Updated dependencies [a34bf91]
  - @zhin.js/core@1.1.35
  - @zhin.js/game-kit@1.1.0

## 2.0.1

### Patch Changes

- @zhin.js/core@1.5.16
- zhin.js@7.0.1
- @zhin.js/game-kit@4.0.1

## 2.0.0

### Patch Changes

- zhin.js@7.0.0
- @zhin.js/game-kit@4.0.0

## 1.0.20

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15
  - @zhin.js/game-kit@3.0.15

## 1.0.19

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14
  - @zhin.js/command@1.0.16
  - @zhin.js/middleware@1.0.13
  - zhin.js@6.0.14
  - @zhin.js/game-kit@3.0.14

## 1.0.18

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13
  - @zhin.js/game-kit@3.0.13
  - zhin.js@6.0.13

## 1.0.17

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/game-kit@3.0.12
  - @zhin.js/middleware@1.0.12

## 1.0.16

### Patch Changes

- @zhin.js/core@1.5.11
- @zhin.js/game-kit@3.0.11
- zhin.js@6.0.11

## 1.0.15

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 1.0.14

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/game-kit@3.0.10

## 1.0.13

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/command@1.0.13
  - @zhin.js/core@1.5.9
  - @zhin.js/middleware@1.0.10
  - @zhin.js/game-kit@3.0.9

## 1.0.12

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/game-kit@3.0.8
  - @zhin.js/command@1.0.12
  - @zhin.js/middleware@1.0.9

## 1.0.11

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/game-kit@3.0.7

## 1.0.10

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/core@1.5.6
  - @zhin.js/game-kit@3.0.6

## 1.0.9

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/core@1.5.5
  - @zhin.js/game-kit@3.0.5

## 1.0.8

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [b0f37ae]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - @zhin.js/game-kit@3.0.4
  - @zhin.js/middleware@1.0.8

## 1.0.7

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/game-kit@3.0.3
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/middleware@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.6

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/game-kit@3.0.2
  - @zhin.js/middleware@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/game-kit@3.0.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - @zhin.js/middleware@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/command@1.0.5
  - @zhin.js/core@1.5.0
  - @zhin.js/game-kit@3.0.0

## 1.0.3

### Patch Changes

- Updated dependencies [d52f3c5]
  - @zhin.js/game-kit@2.0.4

## 1.0.2

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/game-kit@2.0.3

## 1.0.1

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/game-kit@2.0.2
  - @zhin.js/command@1.0.4
  - @zhin.js/middleware@1.0.4
  - @zhin.js/core@1.4.2
