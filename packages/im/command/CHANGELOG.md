# @zhin.js/command

## 1.5.0

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

### Patch Changes

- 50b577d: #1250 第 75 批：群里无权限者发确认 / 审批 / 管理类命令时，机器人不回复、不执行，避免旁人乱操作刷屏；私聊照旧回复无权限原因，有权限的人操作出错（确认码过期、格式不对等）照常提示。这些拒绝都记为入站结局 `permission_denied`（群里 `reply: no`，私聊 `reply: yes`），Console「消息结局」可查；原有审计照常写。

  - `@zhin.js/agent`：Agent 管理命令（`models`、`tree`、`fork`、`compact`、`reset`、`ai.health`）对非主人 / 受信任用户、审批卡命令 `approve <id>` / `deny <id>` 对不在审批人名单且不是能结算该自我变更卡的全局主人、主人命令 `approve …` 对非全局主人（全局主人在群里发仍提示改用私聊）、群规命令 `rule approve|reject|disable …` 对非群管理员 / 非审批人：在群聊与频道里不回复，消息在入站管理阶段终止，不会再进入 AI 回合（模型不会代为回答「没有权限」）；私聊回复不变。群规命令在频道等非群会话、或群规不可用时也先判审批人：非审批人静默，只有审批人收到「只能在对应的群里用」「群规不可用」。`rules` 列表、`memory` / `forget` 仍对所有人开放。`RuntimeManagementDeps`、`ImApprovalCommandInput`、`GroupRuleCommandInput`、`OwnerApprovalCommandContext` 新增可选回调 `onUnauthorized(reason)`：处理器在回复是「无权限拒绝」时调用它（返回的文案不变），由入站阶段决定群里静默、私聊回复。
  - `@zhin.js/agent`（不兼容）：删除只为兼容保留的 `ingressMessages.cleared` 键（清空确认文案只在清空命令里使用）。
  - `@zhin.js/core`：别人提问的确认 / 选择按钮被旁人点击时，群里不再回复「交互已过期」（提问仍属于被提问的人，结局 `permission_denied`，原因 `interaction_not_own`）；旁人打字回答本来就不会被当成回答，现有测试锁定。带 `permit` 的按钮被不满足条件的人点击时，群里不再回复「你不能使用这个按钮」，私聊照旧说明。提问结束后 10 分钟内（最多记 512 个按钮）仍记得它是问谁的：旁人在群里点已结束提问的按钮也不再回复「交互已过期」，被提问的人自己点仍提示过期，记录过期或被挤掉后按原样提示。插件命令的 `permit` 不满足、且不满足的是对发送者的条件（zhin 角色、`platform:*` / `platform-role:*` / `platform-permission:*`、`user(…)`、插件自定义 permit）时，群聊 / 频道里不再回复「没有权限执行此指令」（也不调用自定义命令反馈渲染器），结局 `permission_denied` 记 `reply: no`；场合条件（`private()`、`group()` 等）与机器人自身条件（`bot:*`）照常回复，例如 `config` 在群里仍对所有人回复。不新增公共导出。
  - `@zhin.js/command`：命令被拒时，若最先不满足的是场合或机器人条件、而发送者也不满足某个对发送者的条件，拒绝结果改为指名后者（`denial.permit`），使群里对无权限者静默；例如 group-suite 的 `teach`（`group()` + `trusted`）被不受信任的人在私聊里发时，回复改为说明需要 zhin 角色。
  - `zhin.js`：聊天 `restart` 对非全局主人在群里不回复（审计原因 `not-global-owner`）；另一位全局主人替别人确认他发起的重启时，审计与结局原因记 `confirmation-not-own`，但他有权限，群里照常提示「没有待确认的重启」；主人自己的确认过期或参数不对照常提示。`功能` / `角色` 自助在任何范围都没有 admin 时先按 `not-admin` 拒绝（`角色` 的用法错误、找不到人等格式类拒绝不再在群里回复无权限旁人），该范围没有 admin、角色不足以授予 / 撤销（`not-admin`、`role-denied`、`owner-denied`、`peer-denied`），或确认码属于别人（新拒绝原因 `confirm-not-own`；确认者本身是全局 admin 时照常提示）时，群里不回复，私聊照旧说明；有 admin 的人的用法错误、确认码过期等仍回复。不新增公共导出。

- 49f9042: 统一显示语言类型、语言解析与列表分隔（zhinjs/zhin#1250 第 77 批）。

  - 新增：`@zhin.js/plugin-runtime` 导出 `formatList(locale, items, { separator? })`（`list` 默认 `、` / `, `，`comma` 为 `，` / `, `，`semicolon` 为 `；` / `; `；只拼接，英文不加 `and`），经 `zhin.js` 主入口与 `zhin.js/i18n` 再导出；`queryLocale()` 严格解析 `?locale=`；`projectLocale()` 从 `@zhin.js/core/runtime` 移入（core 不再导出）。
  - 命令的语言回退改走与消息相同的项目语言（先取 generation 投影的项目语言，再取根配置 `locale`）；之前命令只读根配置。消息自带的语言不合法时回退项目语言，而不是固定的 `zh-CN`。
  - Console 接口：`/conversations/workspaces/commands`、`/conversations/outcomes`、`/entries`、`/console/api/pages`、Console 首页与插件市场搜索的 `?locale=` 之前把非法值当作中文（或忽略），现在与任务、权限说明接口一样严格：不支持或重复的值返回 400（`invalid_locale`）。缺省行为不变。400 响应由 `@zhin.js/host-http` 新增导出的 `invalidLocaleResponse()` 统一给出（实例路由与插件市场共用，错误文案中英文一致：`locale 只能是 zh-CN 或 en（locale must be zh-CN or en）`；插件市场之前只有英文）。页面标题按 `titleI18n[locale]` 精确取值：`titleI18n` 的键只能是 `zh-CN` / `en`，不再按 `zh` / `en-US` 等前缀或其他键猜测。
  - 删除别名类型（不留兼容）：`@zhin.js/client` 的 `PluginUiLocale`（改为再导出 `@zhin.js/console-protocol` 新增的 `ConsoleLocale`），`@zhin.js/console-contract` 的 `PageKeywordLocale` 与 `DeclarativeUiLocale`（合并为本包零依赖的 `ConsoleLocale`），`@zhin.js/page` 对这两个类型的再导出；内部别名 `PlatformGuidanceLocale`、`CreateLocale`、`SandboxLocale`、`AdapterConsoleLocale` 一并删除。其余内联的 `'zh-CN' | 'en'` 改用 `Locale` / `ConsoleLocale`。
  - 语言判定改用 `resolveLocale()`：Agent 未执行工具提示与协作补充文案不再按 `en` 前缀猜测（`en-US` 之类的值回退中文；实际传入的都是已解析的语言）；系统提示的平台说明在缺少语言时改为中文（之前英文）；重启回执、消息结局文案、create-zhin、ICQQ 辅助脚本、成语接龙动作词同样改用统一解析。成语接龙的开局动作词（`chainStartAction`）之前把任何不以 `zh` 开头的值（如 `en-US`、`fr`）当作英文、给出 `pinyin` / `char`；现在只有 `en` 给出英文，其余不支持的值与缺省一样回退中文的「同音」/「同字」（`zh-CN` 与 `en` 不变）。B 站与掘金 Console RPC 删除各自的 `localeOf`。
  - 列表分隔统一用 `formatList`，输出不变：命令建议、回复兜底的工具列表、工具审批卡、群规豁免、账号命令字段、Console 提醒、地震订阅地区与数据源告警、游戏大厅、轮盘、文字冒险、猜词选项、内容审核动作、网络工具与 RSS 任务详情。`@zhin.js/command` 与 Agent 文案表中的分隔符条目（`suggestionSeparator`、`toolSeparator`、`listSeparator`、`detailSeparator`、猜词 `separator`）删除。

  `@zhin.js/console-ui`：仅补充 `ConsoleUiLocale` 与 `resolveConsoleUiLocale` 的说明注释（本地声明的理由、为何对浏览器语言标签保持宽松），行为不变。

- 45dcb9e: #1250 第 84 批：收尾第 83 批（Agent 管理命令改为 Root 命令）的复审问题。

  - 命令只回应人：命令分发统一过滤非人类来源。消息的可信来源 `origin`（或没有可信来源时适配器自报的 `metadata.origin`）不是 `human` 时，这条消息不进任何命令——不执行、不回复无权限（permit 拒绝）、不给近似指令提示，对所有插件命令都生效；结局 `ignored_bot`（原因 `non_human_origin`，阶段 `command`）。过滤分两层：入站分类器判出的可信来源 `self` / `member` / `peer_bot` 在入站阶段就丢弃（结局 `ignored_self` / `ignored_bot`，阶段 `ingress`），中间件、事件处理器和命令都收不到；命令分发层的过滤是兜底，只对没有可信来源、靠 `metadata.origin` 自报的消息生效，这类消息中间件与事件处理器照常收到。「只回应人」只覆盖 PeerRegistry 里登记过的 zhin 机器人（以及出站台账认得出的本实例消息）：不在 PeerRegistry 里的第三方机器人会被分类器判成 `human`，命令照常响应。Agent 管理命令里各自的来源判断随之删除（结局由 `filtered_by_policy` 改为 `ignored_bot`）。
  - `@zhin.js/core`：新增导出 `isNonHumanOrigin()`（`@zhin.js/core/runtime`，Agent 入站复用同一判定）；`InboundOutcomeSink` 新增可选 `reportCount()`；`ImOperationResourcesInput` 新增可选 `conversationSequence`（这条消息在会话里的序号）。
  - 结局如实：指令什么都没返回、什么都没发，且执行期间自己记了结局时，分发层不再追加 `command_replied`（它的优先级会压过静默结局）。没有聊天角色的人发 `reset` 却没有清空时，结局记 `not_addressed`（原因 `clear_command`：群里未 @、AI 不回应他等）、`filtered_by_policy`（原因 `outbound_stopped`：控制面停了出站），直播间里记 `not_addressed`（原因 `live_room_clear`）；清空了但冷却期内没有再发确认时记 `cleared`。新增两条原因级结局说明（ADR 0061 表同步）。
  - 直播间里没有聊天角色的人发 `reset`：保持静默，不清空也不进 AI 回合（文档写明）。
  - `reset` 的清空路径带上这条消息的会话序号，发言闸门把截至这条消息的场景事件（如刚被禁言）折叠进来再判断。
  - 分发租约只给 Root 自己分发的 Root 命令操作（Agent 管理命令）：插件命令 / handler 的操作资源里不再有分发租约，深路径导入内部令牌也拿不到，无法钉住旧快照代。操作的 owner 由框架绑定，不由调用方自报：交给插件的消息视图只为它自己的作者打开 Host 资源，自称 Root（`owner: snapshot.root`）时这次操作没有任何 Host 资源；`CommandIndex.dispatch` 从来源消息读操作资源时改从命令作者的视图读取（在执行策略计数之前读取）。
  - 插件中间件 / handler / 按钮回调经 `CommandIndex.dispatch({ input, source: context.input })` 分发 Root 命令（项目自己的命令与宿主命令）照常执行，装不装 Agent 都一样，拿到的资源与直接发送一致（例如推理客户端），只是没有分发租约：消息视图经插件作者改绑（含 P → Q → Root、Root → P → Root 等多跳，记为第一个插件作者）时，Host 收到 `ImOperationResourcesInput.delegatedFrom`（新增可选字段）并只去掉分发租约。
  - 分发租约不靠令牌保密：Agent 管理命令只认**本 Host 实例**签发的租约端口，并由 Host 侧用真实快照存储再校验一次。`createHostOperationResources()`（`@zhin.js/agent/runtime`）返回值新增 `isDispatchLease(port)`，只认这个工厂实例自己签发的端口（登记在实例私有的 WeakSet 里，不再是模块级登记：插件自己调用公开的 `createHostOperationResources()` 签出的端口不算）；`RuntimeManagementCommandHost` 新增必填 `isDispatchLease`，Agent Host 把自己那个实例的判定传给 `createRuntimeManagementCommands()`。`AgentRuntime` 新增 `ownsLease(lease)`，`AgentTurnIngressRoute.runManagementOperation()` / `clearAsCommand()` 用它校验命令交来的租约属于这个 Root 的真实 SnapshotStore，不属于就拒绝。调用方经显式 `operation` 自造资源视图、对租约令牌（id 可读）回答 `has` / `use` 的，拿不到租约；没有 Host 资源时同样不执行。需要分发租约的 Agent 管理命令（`models` / `health` / `tree` / `fork` / `compact` / `reset`）经插件转发（或自造 `operation`）时不执行，回复中英文提示请用户直接发送该命令（带这条消息的命令前缀，如「请直接发送 /reset。」）。
  - `CommandIndex.dispatch`：调用方没传 `commandPrefix` 时用来源消息自身的 `commandPrefix`（帮助文本、命令里的 `formatCommand` 都带前缀）；显式传入消息自身的 `snapshot` 与不传等价——同样校验命令表、按 endpoint 过滤被关插件的命令（ADR 0050，之前显式传入会绕过）、拿到同样的资源；从来源消息读操作资源在执行策略计数之前，读取失败不占冷却额度。
  - 结局如实：经插件转发（来源为框架消息、未传 `operation`）的命令以 UserFacingError 拒绝时，`CommandIndex.dispatch` 自己记这条消息的结局 `refused`（原因为命令的拒绝码，如 `direct_command_required`，阶段 `command`），不再只剩中间件的 `handler_replied`。`dispatch` 返回的 `value` 就是给用户的回复（含拒绝提示），中间件必须把它回复出去（文档示例改为 `return result.value`）；中间件不回复时用户收不到提示。`@zhin.js/feature-kit` 新增内部钩子 `operationInputOutcome` / `reportOperationInputOutcome()`，由框架消息实现。
  - `createRuntimeManagementCommands()` 必须配合 Host 资源（同一个 `createHostOperationResources()` 实例的 `im` 端口与 `isDispatchLease`）。没有 Host 资源时（嵌入方没接），需要租约的管理命令即使用户直接发送也不执行，回复「管理命令在此实例不可用。」/「Management commands are not available on this instance.」，结局 `refused`（原因 `management_unavailable`，新增原因级结局说明，ADR 0061 表同步），不再误答「不能经插件转发执行，请直接发送」。

- Updated dependencies [0899424]
- Updated dependencies [7f39b10]
- Updated dependencies [49f9042]
- Updated dependencies [a05eb73]
- Updated dependencies [ee51324]
- Updated dependencies [58ce469]
- Updated dependencies [45dcb9e]
  - @zhin.js/im-contract@1.3.1
  - @zhin.js/plugin-runtime@1.5.0
  - @zhin.js/permission@1.3.0
  - @zhin.js/feature-kit@1.1.21

## 1.4.2

### Patch Changes

- 257d289: 等待中的提问不再吞掉消息（#1250 `interaction-prompt-swallows-messages`，ADR 0061 决定 11 修订）：`select`、多选、数字、列表提问认取消词「取消」「退出」「cancel」「exit」「quit」（中英文通用，提示里写明「回复『取消』退出」；列表回复恰好是一个取消词时按取消处理，多项里的「取消」仍是数据；带校验规则的 `text` 在回答没通过校验时也认取消词），取消后 `ask()` 以 `UserInteractionCancelledError` 结束并回复「已取消」；等待期间被问者发了能匹配到指令的消息或带图片 / 文件 / 语音 / 视频的消息（单独 @ 机器人不算退出：有的平台必须 @ 才投递或把回复当作 @，「@机器人 3」这类无效回答照样重发提问；去掉开头 @ 后能匹配到指令才退出；指令匹配同样检查 `adapter` 限制；已收下的有效回答不会被顶掉），提问结束、回复一次「已退出上一个选择」（每人每分钟最多一次），这条消息按正常流程处理；其余无效回答限频提醒（每次提问最多 2 次、间隔至少 20 秒），不再静默等待。

  提问超时、取消、被打断、被顶替不再记成 `internal_error`（#1250 `interaction-timeout-reported-as-internal-error`）：入站结局新增 `interaction_timeout` 与 `interaction_cancelled`，日志为 INFO，不算故障；指令阶段的结局记下提问方插件，诊断里不算一次指令执行，被新提问顶替时说明「被新提问替代」。Agent 工具审批的提问被取消或打断时按用户拒绝处理；提醒插件把被打断的提问当作已结束。

## 1.4.1

### Patch Changes

- 4ff83f3: 命名空间下的参数指令、超过 10 项的选择、猜谜与地牢远征的入口（#1250 第 37 批）。

  - `command-namespace-param-commands-swallowed`：路由顺序原先是「所有静态路由先于所有带参数段的路由」，于是只要有一条更短的静态路由（例如另一个插件或根项目里的 `60s`）能匹配开头，`60s fanyi 你好`、`60s douyin`、`60s fuel 四川` 就会被它吃掉，无参数的指令又会忽略多出来的词，日志照样是 `command_replied | executed`。现在按字面路径长度优先：字面词更多的路由先匹配，字面长度相同时静态路由仍先于参数路由。`<命名空间>` 与 `<命名空间> --help`（以及任意指令组的 `<组> --help`）列出该组下发送者能用的全部指令；某条指令的 `--help` 也列出它下面（至少多一个字面词）的子指令，参数指令不会把自己列进去。插件的 `commandNamespace` 与它自己的指令同名（命名空间 `60s` + 指令 `60s` → `60s 60s`）时，实例启动时记一条 `command_namespace_collision` 警告。
  - `select-over-10-options-no-buttons`：core 不再只给 ≤10 项的 `select` 生成按钮，所有选项都交给端点；选择提示改为「回复序号或选项名称。」，不再声称「可以点击按钮」。适配器能力画像新增可选的 `segments.interactiveLimits.maxButtons`（`@zhin.js/adapter` 新增类型 `AdapterInteractiveLimits`）：原生按钮的端点超过上限时，前 N 项保留按钮，其余选项改成紧挨按钮的序号列表（回复序号或名称照常生效；整块键盘一起登记序号，列出的序号接在按钮之后，回复「1」仍是第一个按钮）；纯文本端点照旧降级为序号列表。QQ 官方、Discord、Slack 声明 25，Telegram 声明 100；Sandbox 不设上限，按钮较多时在气泡内滚动。`@zhin.js/core` 新增导出 `resolveOutboundMaxButtons()` / `applyOutboundButtonLimit()`。该字段与 Sandbox 全能力 ADR 草案 P3 的 `interactive` 对象形式（`{ buttons: { maxTotal } }`）对应：`maxButtons` 将折进 `maxTotal`，字符串形式的 `interactive` 继续作为简写有效；本批不新增 `select` 段。
  - 猜谜（字谜 / 猜成语）：直接回复「提示」「跳过」「结束」（以及 hint / skip / end）按对应操作处理，卡片上写明可以这样回复。提示给出真实信息：成语给第 1 个字，字谜给包含答案的 4 个候选字；提示扣 3 分（分数不会低于 0）、不再清零连击，每局最多 3 次（分数为 0 时提示也不是无限免费）。「结束」（按钮或 `猜谜 quit`）公布当前题的答案并结算本局（已答题数、得分、最佳连击）。题库去掉重复的标点（「……活下去。。」）。
  - `dungeon-entry-unhelpful`：`dungeon` / `地牢远征` / `地牢` 不带参数且当前频道没有队伍时显示帮助与开局方式（`dungeon start`）；指令新增别名「地牢」。群里的卡片是整个频道共用的，所以所有人看到同一套按钮、同样的序号（大厅：加入队伍 / 准备 / 开始远征 / 解散队伍），非队长点「开始」或「解散」会收到明确的拒绝；大厅里提示其他人回复「加入队伍」入队。结束远征先要求队长确认：确认请求记录在新的会话版本上，只有这张确认卡（或队长在它仍是最新状态时回复「确认结束」/ 序号）能结束远征，队伍之后有任何动作或选择「继续远征」都会让它失效；结束后给出结算（到达层数、清理房间数、队伍金币）。「你是不是想用」在指令名都不相近时也和插件显示名比对（带指令前缀时 `地牢探险` → 显示名为「地牢远征」的插件）；没有前缀（私聊、@机器人）时只按前一半逐字相同放宽的匹配要求这一半至少 4 个字，`天气不错`、`天气` 这类聊天不会被显示名「天气预报」截走。
  - `60s-gold-currency-mixed`：金价按接口返回的单位写货币符号（美元用 `$`、人民币用 `¥`，其他币种不加符号）。

- 1dc5324: 中间件 / handler 里 `context.project<CommandIndex>(commandFeatureId).dispatch({ input, source: context.input })` 不再抛 `Message author binding belongs to another generation operation`（#1250 第 38 批）：命令表是按投影时的快照视图建的，和消息操作实际运行的已提交快照不是同一个对象；未显式传 `snapshot` 时，`dispatch` 改用 `source` 消息自己的操作快照（新的内部钩子 `readOperationInputSnapshot`），并带上该操作的资源。命令仍以原消息的真实发送者执行并照常检查 `permit`；传入别的快照、或拿着不属于该消息 generation 的命令表调用，仍然拒绝，报错会说明应在当前上下文里调用 `context.project()`。这条路径同样遵守按 endpoint / 会话关闭插件（ADR 0050）：被关插件的命令返回 `unmatched`，与 Core 自己的派发一致。
- Updated dependencies [c2cc4ba]
- Updated dependencies [1dc5324]
  - @zhin.js/plugin-runtime@1.4.1
  - @zhin.js/feature-kit@1.1.20
  - @zhin.js/permission@1.2.4

## 1.4.0

### Minor Changes

- 19526a6: 没回复、被拒绝、离线都说清原因（zhinjs/zhin#1250 第 31 批）：

  - `self-service-unknown-conversation-opaque`（回退的根因）：第 9 批（ADR 0060 P3，b6ec01464「Sandbox speaks as the linked chat identity; typed ids are simulated and role-less」）起，Sandbox 里手填的发送者以 `~sim:<id>` 进入运行时，而 `chatRoleMessageContext()` 把这种保留 id 当成「无法识别」，`功能` / `角色` / `认领` / `绑定` 都只回「无法识别当前会话。」；之前同一个群里 `功能 关闭 repeater` 能用，是因为当时手填的 id 还会被当成真实身份。现在 `@zhin.js/core` 新增 `resolveChatRoleMessageContext()`，返回 `{ ok: false, reason }`（`no-conversation` / `unknown-endpoint` / `no-adapter` / `no-sender` / `simulated-sender` / `invalid-sender`），实例侧再加 `unkeyed-conversation`（适配器没有提供可用的会话类型或会话 id）；四个指令按原因回复下一步（如「你正以模拟身份发言……请在 Sandbox 打开『以我的身份发言』，或在 Console『功能』/『聊天角色』页设置」）。不带参数的 `功能` / `角色` 直接列出。
  - 被拒绝或失败的自助指令不再记成 `command_replied | executed`：`UserFacingError` 新增闭合的拒绝码 `reason`，指令派发结果带 `refusalReason`，入站结局记 `refused` 与该码（如 `simulated-sender`、`not-admin`、`usage`、`locked`、`self-service-disabled`），回复文字不变。没有码的 `UserFacingError` 仍记 `user_facing_error`。
  - `unaddressed-message-no-record`（复测失败的根因）：第 18 批之后，没被 @、不是指令的群消息其实已经记了 `not_addressed`，但未点名的静默结局一律只写 debug 日志，Console 的运行日志看不到；结局只存在进程内，Sandbox 和轨迹页也没有入口，看起来就像「什么都没记」。现在每个会话每分钟第一条 `not_addressed` 写 info（`inbound_outcome | … | sampled: first_per_minute`），其余仍为 debug；新增 `GET {base}/conversations/outcomes`（`endpoint.view`，只限当前 Sandbox 连接绑定的会话、且只列该连接 owner 本人或其模拟身份发出的消息；只返回结局码和面向发送者的文案，不含插件名、阶段等运维文案），Sandbox 发消息后读取这条消息的结局，没有回复时显示原因（如「这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。（not_addressed · no_command_not_ambient）」）。`ConsoleMessageDiagnostic` 补上已有的 `outcome` 字段。
  - `console-offline-no-reason`：适配器不上报连接状态（如 GitHub 这类 Webhook 适配器）且没有失败记录的已启动账号，不再显示「离线 · 连接状态：未知」，改为「未上报连接状态」（提示级），并说明常见原因与检查方法；确实离线时附上最近一次失败的原因、失败时间与自动重试次数 / 下次重试时间。这些只改显示文字：条目的 revision 与之前相同，已忽略的待办不会重新出现（「已从配置导入聊天角色」的 revision 也仍按原始条目数计算）。
  - `principal-link-attention-ids`：「人员名单或身份链接等待确认」按人分组，每个身份写出适配器与账号（`qq·bot-a`），平台 id 只显示后 4 位（`尾号 1234`），数量按去重后的 (adapter, endpoint, userId) 计算；查看者本人显示为「你（显示名）」，其他 Console 用户显示 id 前 8 位，条目新增 `links`（`ConsoleAttentionItem.links`）供 Console 按 `iam.users.list` 换成用户名。

- f1affdd: 游戏输入与入站结局（zhinjs/zhin#1250 第 34 批）：

  - `game-input-also-reaches-agent`：猜数字的数字中间件在游戏回复之后仍调用 `next()`，同一条「50」又流到 Agent，于是有两条回复。现在游戏处理过的输入就结束分发，只有没有对局时才放行。`replyGameOperation()` 返回游戏是否回复了（`boolean`），并接受可选的 `input`：传入后把消息结局记成 `handler_replied` / `game_input`。所有游戏的对局中间件都会传入它。成语接龙和猜谜的自由文本作答也改为只在游戏真正处理了输入时才结束分发。
  - `inbound-outcome-middleware-reply-mislabeled`：中间件先回复（回执 `sent`）再停止分发的，结局记 `handler_replied` / `middleware_replied`。只看停止分发的那个中间件所属插件自己送达的回复：别的插件先回复过、而它没回复就停止的，仍记 `filtered_by_policy` / `middleware_stopped`。入站结局端口 `InboundOutcomeSink` 新增可选方法 `replied(owner?)`。ADR 0061 已同步；没有改动已有的 reason 取值。
  - `game-button-label-text-not-accepted`：游戏会话同时接受序号和按钮文字（忽略 emoji、空白与大小写），例如「要牌」「🏳️ 放弃」。对局结束后的文字「再来一局」（以及二十一点的序号 1）只在结束后 10 分钟内有效，之后按普通聊天放行。地牢远征在群里由整个频道共享：不在队伍里的人只能用文字「加入」，其余文字和序号都放行。`buildChoiceKeyboard()` / `buildGridKeyboard()` 统一在卡片上加一行「回复序号或按钮文字也可以」：猜数字的数字是猜测本身，所以只提示按钮文字；对局结束后没有可点按钮时不加。键盘段新增 `fallback.layout: 'inline'`，在能力画像为 `interactive: 'text'` 的适配器上，按钮渲染成一行 `1. 要牌  2. 停牌  3. 放弃`。井字棋改为按棋盘位置编号：回复 1–9 落在对应格，卡片上写明「回复 1–9 在对应位置落子（左上为 1，右下为 9）」。
  - `game-command-names-mixed-language`：所有游戏的子命令都有中英两种写法，都能用（开始 / 继续 / 退出 / 认输 / 加入 / 离开 / 观战 / 人机）。帮助和提示里的写法跟命令名同一种语言，`formatGameHelp()` / `gameCommandHint()` 统一处理。井字棋的中文命令改为与标题一致的「井字棋」，旧名「井字游戏」仍可用。约定写在 `plugins/games/README.md`。
  - `near-miss-suggestion-param-misleading`：指令参数新增只用于显示的 `suggestions` / `suggestionsI18n`。「你是不是想用」改为列出真实子命令（`玩石头剪刀布 开始|继续|退出`），不再显示 `[action]`。「玩石头剪刀布 石头」/「猜拳 石头」现在一步开局并出拳。
  - `game-quit-means-forfeit`：会判负的退出（井字棋、成语接龙）在帮助里写「认输并结束对局」；其他游戏的退出写「结束当前对局（不计胜负）」。
  - `command-menu-unreadable-in-sandbox`：指令菜单模板加了媒体查询：宽度 860px 以下为两列，560px 以下为单列，名称按词换行。Sandbox 按 HTML 段请求的 `width` 渲染，再等比缩小到聊天栏宽度，和平台实际收到的图片一致。
  - `config-write-moves-inline-comment`：YAML 逐键补丁不再把写在键行上的注释（`"user:…": # …` 后接块状列表或映射）挪到下一行。补丁没有触及的顶层条目逐字节保留原文，flow 集合的空格风格也沿用原文件。`zhin disable` 现在只改 `disable_plugins`。

### Patch Changes

- 2386370: 不同插件的命令或别名重名不再让实例启动失败（#1250 duplicate-command-route-crashes-instance）。以前 Command 索引遇到重名路由直接抛 `Duplicate Command route`，实例退出、被网关反复拉起，所有适配器下线。现在：

  - 命令名称冲突时，先声明的插件保留（按插件在配置里的声明顺序），后来的那条命令连同它的别名、快捷方式不注册，它的子命令仍然可用；
  - 只有别名或快捷方式冲突时，只跳过这个别名或快捷方式，命令本身照常注册；命令名称优先于别的插件的别名；
  - 同一插件内部的冲突仍然在加载时报 `Duplicate Command route`，插件自己的测试能发现；
  - 插件热重载替换自己的命令不算冲突，热重载也不会改变由谁保留路由；
  - 插件按适配器、账号或会话关闭时，在保留方被关闭的端点上，原来被跳过的命令会生效。

  **升级注意**：后声明的插件如果有与前一个插件的别名同名的命令（例如 A 的 `admin` 带别名 `ban`，B 有命令 `ban`），升级后 `ban` 由 B 处理，而不是像以前那样启动失败。用户熟悉的指令换了处理方，所以这种冲突在「需要你处理」里标为严重（`danger`），升级后请检查并处理。

  每处冲突在启动（及热重载）日志里打一条 warn（`op=command_route_conflict`），并作为 `command.conflict` 列在 Console「需要你处理」和 `zhin doctor` 的运行状态里，写明两个插件名、命令名或别名，以及建议：让其中一个插件改名（或配置 `commandNamespace`），或在配置里用 `disabledCommands` 禁用其一。`CommandIndex` 新增 `conflicts()`；`@zhin.js/console-protocol` 的 attention 新增 `command.conflict`（需要 `feature.view`）与 `subject.pluginId` / `commandRoute` / `command` / `commandKind`。

- Updated dependencies [d216b84]
  - @zhin.js/plugin-runtime@1.4.0
  - @zhin.js/feature-kit@1.1.19
  - @zhin.js/permission@1.2.3

## 1.3.1

### Patch Changes

- Updated dependencies [816c3f3]
  - @zhin.js/im-contract@1.3.0

## 1.3.0

### Minor Changes

- 7cd299e: 指令执行中抛出的「面向用户」的拒绝不再被静默吞掉（#1250）：`@zhin.js/command` 新增 `UserFacingError`（及 `isUserFacingError` / `userFacingErrorText`，经 `zhin.js/command` 导出），指令分发把它转成该指令的回复，经正常出站链（`$reply`）发出，按发送者语言调用 `format(locale)`；其他错误照旧抛给入站运行时记录日志，不把错误信息或堆栈回给用户。`GameSessionConflictError` 改为继承 `UserFacingError`，群里已有一局「guess」时发「rps 开始」会收到「你在当前频道已有进行中的「guess」对局…」，不再只在适配器日志里出现 `sandbox_gateway_receive_failed`。
- 9026329: 未命中的消息首词与已注册指令名 / 别名高度相似时（私聊、@机器人或带指令前缀；忽略大小写与 `-` / `_` / 空格，默认 1 次编辑且名称至少 5 个字符或 3 个汉字），经正常回复链直接回复「没有这个指令，你是不是想用：X、Y」，不再交给 AI 编造指令名（#1250）。只列出发送者有权使用的指令；根配置 `commandSuggestion: false` 关闭，`{ maxDistance, limit }` 调整。Agent 提示在有指令菜单时引导模型不确定就让用户发送菜单，而不是猜指令名。

  只有带指令前缀的消息才按首词命名空间匹配（`/rss foo` → `rss-list`）；私聊与 @机器人 但未带前缀时，只匹配与指令名本身相近、且简短像指令的消息（不含「是什么 / 怎么 / 吗 / 啥 / ？」等疑问词或问号，名称后只跟指令声明的参数），所以「rss 是什么」「process 太慢了」之类的问题仍交给 AI。

### Patch Changes

- 7cd299e: 指令菜单降噪（#1250）：「子插件」只列出子树里有当前发送者可用指令的插件，不再列出适配器（如 icqq、github）和无指令的纯服务插件（仍可用「菜单 <插件名>」直接查看）；根菜单标题不再显示内部实例名「=== root 指令菜单 ===」，改用项目显示名（`metadata.displayName`）或「=== 指令菜单 ===」。会话历史回放带原生按钮的回复时，未渲染的 JSX 不再被序列化成 `[markdown]{"$jsx":"zhin.jsx/1",…}`：Markdown 取原文，按钮（键盘行与 `<button>`）降级为 `[标签]`。
- Updated dependencies [e6d7cc1]
- Updated dependencies [7cc703a]
- Updated dependencies [cca4427]
- Updated dependencies [70ddaf4]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/feature-kit@1.1.18
  - @zhin.js/permission@1.2.2

## 1.2.2

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/feature-kit@1.1.17
  - @zhin.js/permission@1.2.1

## 1.2.1

### Patch Changes

- 73ef48b: `defineCommand` 新增两项便捷写法：`reply` 用固定内容代替 `execute`；`match` 正则让整句消息触发命令（命令名路由优先，结果在 `context.match`，不允许 `g` / `y` 标志）。命令列表的描述中带上 `match` 的字面形式。

## 1.2.0

### Minor Changes

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

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/permission@1.2.0
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/im-contract@1.1.14

## 1.1.17

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/feature-kit@1.1.15
  - @zhin.js/permission@1.1.15

## 1.1.16

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/feature-kit@1.1.14
  - @zhin.js/permission@1.1.14

## 1.1.15

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

- Updated dependencies [fed2c27]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/feature-kit@1.1.13
  - @zhin.js/permission@1.1.13

## 1.1.14

### Patch Changes

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/permission@1.1.12

## 1.1.13

### Patch Changes

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/feature-kit@1.1.11
  - @zhin.js/permission@1.1.11

## 1.1.12

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
  - @zhin.js/permission@1.1.10

## 1.1.11

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- adb4af2: 允许应用 Root 显式选择命令反馈、菜单展示与按完整会话区分的出站展示偏好。未配置、返回 undefined 或策略函数异常时沿用默认展示；保留权限、30 项分页、代际隔离和统一发送链，投递失败不重试。
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/permission@1.1.9
  - @zhin.js/feature-kit@1.1.9

## 1.1.10

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/permission@1.1.8

## 1.1.9

### Patch Changes

- 8302701: Explain the parameter directory rule when a command path is invalid. Nested parameter directories such as `commands/term/[word]/[...definition]/index.ts`, or a static directory after a parameter directory, now fail with a message that states the rule (one parameter directory per command, and it must be the last directory), names the file and shows the corrected path and `params` declaration. A directory parameter that is not the first `params` entry now gets the reordered list in the error.
- 9943df6: Type the plugin config in convention commands and tools without losing inference (#857). `defineCommand.withConfig<Config>()({...})` fixes the config type and still infers `params`, `options` and the result; `defineAgentTool.withConfig<Config>()({...})` (or `defineAgentTool.withConfig<Config>()<Input>({...})` with a JSON Schema) does the same for tools. The returned definer can be shared across a plugin's files. The existing forms are unchanged: `defineCommand({...})`, `defineCommand<Config>({...})` (whose `params` still fall back to `Record<string, CommandParameterValue>`, because TypeScript has no partial type-argument inference) and `defineAgentTool<Input, Result, Config>({...})`. To get `params` inferred together with a typed config, change `defineCommand<Config>({` to `defineCommand.withConfig<Config>()({`.

  `zhin new` normal plugins now declare an `echoPrefix` option in `schema.json` and a matching `<Name>Config` type in `src/index.ts`, and use it in the echo command through `defineCommand.withConfig<<Name>Config>()`; the generated tests cover the typed config.

- de5b2a1: Plugin instances accept a framework-owned `disabledCommands` list (like `commandNamespace`). Listed commands, given by their local path without namespace or parameters (`fanyi`, `netease login`; a parent path covers its subcommands), are left out of routing, so an application can drop the few commands that overlap with another plugin instead of prefixing every command of the plugin.
- c5741c0: `runCommand(fake, definition, { source })`：传入命令的 `commands/.../index.ts`（路径或 `new URL(..., import.meta.url)`）时，先走运行时同一套约定路径校验（新导出的 `bindCommandSource`），`commands/term/[word]/[...definition]` 这类运行时会拒绝的布局在单测里也会报错；不传 `source` 行为不变。`zhin new` 生成的测试默认传 `source`。
- 584161e: 命令执行预算表满时，淘汰最旧的空闲（无运行中操作）条目，即使其冷却尚未结束，不再让所有新身份对带 `execution` 策略的命令一律得到 `capacity`；只有所有条目都在运行时才拒绝。
- 2a1a3d9: `CommandIndex.execute()` 不再因为没有入站来源而对声明了 `execution` 的命令一律返回 `operation_unavailable`：程序化调用按命令维度应用 `maxConcurrent` / `cooldownMs`（不做发送者预算，也不发送进度提示），并在执行结束时释放。权限 permit 检查仍保持 fail-closed，`dispatch` 行为不变。
- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- Updated dependencies [d3563d9]
  - @zhin.js/feature-kit@1.1.7

## 1.1.8

### Patch Changes

- c407bd2: 安装 HTML 渲染能力时，内置指令菜单通过统一发送链生成菜单图；渲染失败或平台无法投递图片时保留原有文本菜单。菜单采用可自定义标题、配色与背景的三列主题，每页最多 30 项，支持根菜单与插件菜单翻页。平台同时支持原生 Markdown 与按钮时自动附加上一页、下一页控件，在边界禁用；其他平台保留文本导航。Telegram 禁用按钮映射为 Bot API 10.3 DisabledButton。补充中英文文档。
- 064b06d: 通过中立的 operation input 生命周期 hook 将真实入站运行代的退休信号传给 CommandContext.signal，使补问与确认能及时取消。
  保留旧 lease 普通操作和已开始发送的正常排空语义，不全局拦截回复。
- a50fc8a: 群欢迎可配置完整账号与会话的精确白名单，区分全部、空范围及具体会话，修正欢迎出站 requester 身份。新增只读命令权限说明与内置规则假设检查，共享真实准入的主体投影与匹配语义，不执行命令、动态默认值、平台或自定义权限检查；显式区分未知、未评估与条件匹配。
- b58548a: 为命令增加可选冷却、并发准入与一次进度提示，以真实发送者和完整会话身份隔离；Root 预算跨热更新共用，并在业务、渲染、中间件和已启动发送真正结束后释放。准入拒绝通过 limited 状态与有界原因进入消息诊断，避免回落到 AI。
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.7

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/interaction@1.1.2
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/interaction@1.1.1
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.5

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/permission@1.1.4

## 1.1.4

### Patch Changes

- b9b3953: Resolve command permissions and command/component contexts from the current operation snapshot when unchanged projections are reused after hot reload. Preserve old snapshots for draining operations.

## 1.1.3

### Patch Changes

- Updated dependencies [0de4836]
  - @zhin.js/permission@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/permission@1.1.2

## 1.1.1

### Patch Changes

- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [b076eae]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/interaction@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.16

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13
  - @zhin.js/permission@1.0.4

## 1.0.15

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- Updated dependencies [67ef8c4]
- Updated dependencies [974772e]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/interaction@1.0.1
  - @zhin.js/feature-kit@1.0.12
  - @zhin.js/permission@1.0.3

## 1.0.14

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.0.13

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.0.12

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9
  - @zhin.js/permission@1.0.2

## 1.0.11

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

## 1.0.10

### Patch Changes

- 2d0a622: feat(command): 支持 shortcut 和 params.default 的动态函数取值

  引入 `CommandDynamicValue` 统一类型，shortcut 预填值、`params.default`、`defaultValue` 均可接受 `(session: CommandSession) => value` 形式的函数，在分发时从运行时上下文（adapter、endpoint、scene、sender）动态解析。

  - 新增 `CommandDynamicValue` 类型和 `resolveDynamicParams()` 集中解析函数
  - 新增 `CommandSession` 和 `resolveCommandSession()` 用于从 Message 提取上下文
  - 帮助文本中函数值显示为 `<dynamic>` 而非函数源码
  - 三条分发路径（shortcut、normal、host/execute）统一调用 `resolveDynamicParams`

## 1.0.9

### Patch Changes

- ca92e03: feat(command): add alias/permit/shortcut fields and Unicode command names

  Commands can now declare alias (multi-word static segment replacements),
  permit (builtin DSL access control), and shortcut (global exact-match with
  prefilled params). Static command filenames support Unicode names
  (e.g. 赞我.ts) alongside ASCII kebab-case. Permit failures result in silent
  non-match for graceful degradation.

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/permission@1.0.1
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/feature-kit@1.0.8

## 1.0.8

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/feature-kit@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.7

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/feature-kit@1.0.6

## 1.0.6

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/feature-kit@1.0.5

## 1.0.5

### Patch Changes

- 7c1e63a: feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

  非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。

## 1.0.4

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.0.3

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 50497a5: CommandContext session fields are structured objects (scene/sender) and TInput is constrained to CommandMessage.
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
- fa66c4c: Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
  expose unmatched structured segments through CommandContext. Preserve structured command input
  while stripping adapter command prefixes in the Core message dispatcher.
- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
