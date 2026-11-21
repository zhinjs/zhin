# @zhin.js/agent

## 1.10.0

### Minor Changes

- 64612cf: 会话列表与审批卡片显示来自哪个聊天（zhinjs/zhin#1250 第 63 批）。全部是新增的可选字段，已有字段含义不变，不新增权限。

  - `@zhin.js/agent`：trace 会话摘要（`TurnTraceArchive.sessions()`，Console `GET /api/agent/trace-archive/sessions`，权限仍是 `agent.view`）新增 `origin`（最近一个记录了来源的回合的来源，与回合 `origin` 同形状）、可读名 `platform`、`scope_kind`、`scene_label`、`display_name`（如 `sandbox · 私聊 Developer`、`定时任务 每日早报`，与用量统计 `bySession[].displayName` 同格式）与 `conversations`（一个会话跨多段聊天时每段的 `{ origin, turns, last_started_at }` 加同样的可读名字段，最近的在前，最多 10 段，超出时给 `conversations_total`；只有 IM 会话、定时任务与内部来源分段，A2A / MCP / HTTP 回合同一会话只算一段）；旧 trace 没有来源时这些字段不出现。trace 的 `origin.conversation` 现在记录会话名 `name`（最长 128 个码点）；平台给的名字（群名、发起人显示名）在记录与生成可读名时清理控制字符、U+2028/2029 与双向控制符（转义为 `\uXXXX`）并按码点截断，新增导出 `sanitizeOriginText()`。工具审批队列的卡片（`ToolApprovalEntry`）新增 `turnOrigin` 与 `turnOriginLabel`。`@zhin.js/agent/trace` 新增导出 `turnOriginLabelOf()`、`turnOriginDisplayName()`、`turnOriginKey()`、`withScheduleJobLabel()`、`summarizeTraceSessions()`、`sessionLabelFields()`、`withSessionScheduleLabels()`、`TURN_TRACE_SESSION_CONVERSATION_LIMIT` 与类型 `TurnOriginLabel`、`TurnTraceSessionConversation`、`TurnTraceSessionLabelFields`。
  - `zhin.js`：Console `plugin.root.tool-approvals` 的卡片（`ToolApprovalCard`）新增 `origin`（与 trace `origin` 同形状）与可读名 `platform`、`scopeKind`、`sceneLabel`、`displayName`（卡片的 IM `origin` 只保留 `platform`、`endpoint`、`scope`、`sceneId` 与 `conversation: { kind, id, name? }`，新增导出类型 `ToolApprovalCardOrigin`）；trace 会话摘要里的定时任务会话、用量统计 `bySession` 里的 `schedule:<id>` 会话在实例还认得该任务时用任务的 `label` 命名（之前显示 `sched_<id>`）。
  - `@zhin.js/gateway`：用量统计新增可选 resolver `resolveScheduleJob`（导出类型 `UsageScheduleJobResolver`），定时任务会话的 `sceneLabel` / `displayName` 用任务名；会话名清理控制字符与双向控制符（新增导出 `sanitizeSessionText()`、`formatSessionDisplayName()`），缺 `platform` 时取会话的适配器，空白的 `scope` / `sceneId` 退回 `conversation.kind` / `conversation.id`。
  - `@zhin.js/cli`：`zhin trace --sessions` 每行显示 `平台 · 私聊/群 名称（短会话键）`（与 `zhin usage report` 同格式，输出前转义控制字符），跨多段聊天的会话在下面缩进列出每段聊天；没有记录来源的旧 trace 仍显示完整会话键。

- 53d2523: #1250 第 73 批：审批卡、群规卡与提示里的命令按本账号的真实命令前缀书写，并按收件人的语言输出。

  - `@zhin.js/agent`：IM 审批卡（危险工具卡与变更审批卡）、群规预览卡、「Bot 不是管理员」群通知与群规冲突提示不再写死 `/`：卡片按收件 Endpoint 的真实命令前缀拼写 `approve <id>` / `deny <id>` / `rule approve <短码>` / `rule disable <短码>`（与入站解析剥掉的前缀一致）。默认值由 `/` 变为「裸命令 + 加前缀提示」：前缀未知时卡片、「Bot 不是管理员」通知与冲突回复都给裸命令并提示加上本账号的命令前缀。这些卡片、通知、`approve` / `deny` 与 `rule …` 的回复按收件人 / 发送者的语言输出中英文，过期时间改用 `YYYY-MM-DD HH:mm:ss`；群里公开的通知（禁言等阶梯通知、「Bot 不是管理员」）与默认群规模板的说明用项目语言，不随违规者的个人语言变化；踢人审批卡参数里的 `reason` 与定时任务被预算 / 超时终止的附注也按语言输出。
  - `@zhin.js/agent`（不兼容）：`formatImApprovalCard()` / `formatSelfChangeCard()` / `formatGroupRuleCard()` 的第 3 / 2 / 3 个参数类型变为命令呈现对象（`{ locale?, commandPrefix? }`，不再接受前缀字符串），返回值由 `string` 变为出站内容 `SendContent`；`ImApprovalSender`、`GroupRuleImDeps.send` 的第 2 个参数相应变为 `SendContent`，`GroupRuleImChannel.handleCommand()` 返回 `SendContent | null`。卡片与回复里所有由用户、模型或插件提供的内容（工具名与参数预览、会话与发起人、变更摘要、文件路径、diff 摘录、试跑详情、群规说明、`rule disable` / 待审回显的用户键）以 `untrustedContent(...)` 分段发送：出站模板不会展开其中的 `${…}`（自变更卡的 diff 摘录原样显示），其中的换行显示为 `⏎`；diff 摘录与群规说明作为 `│ ` 引用行列出，命令行只来自框架文案。变更回报（自变更生效 / 回滚等私聊与会话回报）整体按字面发送，摘要折成一行。删除导出常量 `GROUP_RULE_TRIGGER_LABELS`（中文固定标签，改为按语言取）；`defaultGroupRuleTemplate()` 新增可选参数 `locale`。`formatGroupRuleStage()` / `formatGroupRuleNotice()` 新增可选参数 `locale`；`ImToolApprovalChannelOptions`、`GroupRuleImDeps` 新增可选 `resolvePresentation`，`GroupRuleEffects` 新增可选 `presentation`，`ImApprovalCommandInput` 新增可选 `locale` 与 `senderIsGlobalOwner`，`GroupRuleCommandInput` 新增可选 `locale`、`commandPrefix`，`AgentTurnIngressRouteOptions` 新增可选 `resolveConversationPresentation`，`EnsureDefaultGroupRuleInput` 新增可选 `locale`。
  - `@zhin.js/agent`：主人 `approve` 指令与自变更卡的私聊结算改为「发送者是任一全局聊天主人（global owner）」（`OwnerApprovalCommandContext` 新增必填 `senderIsGlobalOwner`），不再只认账号解析出的第一个 owner；放行规则仍记在账号的 owner 地址下。拒绝文案改为「仅全局聊天主人（global owner）可在私聊中使用此指令」，并给出步骤：先私聊发「绑定 <码>」绑定聊天身份，再在 Console「聊天角色」给自己授予全局 owner；或私聊发「认领 <码>」。模型空回复兜底（`formatReplyFallback()` / `formatToolCallsForUser()` 的 `context` 新增可选 `locale`）按回合语言输出英文，`/clear` 是不需要前缀的入口词，保留字面。
  - `zhin.js`：实例为这些回合外的卡片解析命令呈现时，前缀取自 IM 运行时提供给出站模板的同一个命令环境（与入站命令分发同一个 dispatcher，含 `ImRuntimeOptions.commandPrefix` 覆盖），语言取收件人的偏好（群里取项目语言）；`绑定` / `功能` / `角色` 三个命令声明中文首选名，中文的用法、翻页与全局确认提示写成 `#功能 列表` 这样的中文命令，命令菜单同步显示中文名。

- 637383b: 确认 / 取消词统一为一套词表，中英文都认、不分语言（zhinjs/zhin#1250 第 74 批）。之前至少 6 处各有一份词表，有的按提问语言分开（中文提问回 `yes` 不算确认），有的中英混收，有的只认一个词。

  - 新增导出（`@zhin.js/core`，经 `zhin.js` 再导出）：`isConfirmWord(text, options?)`、`isCancelWord(text, options?)` 与类型 `ReplyWordOptions`。匹配先做 NFKC（全角转半角）、去首尾空白、去掉末尾标点（`！!。.？?` 等）、不区分大小写，再整句比对——`我不确定`、`取消了吗` 都不是取消词。
  - 基础确认词：`确认` / `确定` / `同意` / `confirm` / `yes` / `y` / `ok` / `agree`；基础取消词：`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`。是非答语 `是` / `好` / `true` 与 `不` / `否` / `拒绝` / `no` / `n` / `reject` / `false` 只在明确的是非问答里算（`{ yesNo: true }`：`confirm` 提问、布尔列表），普通对话里一句「不」或「no」不会被当成取消。选项序号 `1` / `2` 只在 `confirm` 提问与布尔列表里局部认。
  - 行为放宽：`confirm` 提问不再按提问语言区分回答（中文提问回 `yes`、英文提问回 `取消` 都有效；提问与提示文案仍用流程固定的语言），并新增 `确定`、`好`、`不`、`ok`、`算了` 等；`select` / `multiselect` / `number` / `list` / `text` 的取消词新增 `算了`，并接受全角、大小写与末尾标点；选项的名称与别名比对也做同样的规范化（`生产。` 选中「生产」）。普通 `select` / `multiselect` 只按名称、别名与序号匹配，不会因为选项名或别名在词表里就接受同类词（选项「好」不认 `ok`，选项 `N` 不认 `no`）。
  - 审批（`purpose: 'approval'`：普通审批、`humanOnly`、需主人、一次性确认）更严，只认明确答语，中英文不分提问语言：批准是 `确认` / `同意` / `批准` / `confirm` / `approve` / `yes`，拒绝是 `拒绝` / `否` / `no` / `deny` / `reject`，以及选项名与序号。`好`、`是`、`ok`、`y`、`true`、`确定`、`agree` 不再批准（之前英文审批认 `y`），按无效回答重问；`不`、`n` 也不再算拒绝。别名不再按语言分开，统一显示 `否 / no` 与 `确认 / yes`。回复 `取消` / `cancel` 等取消词仍算拒绝（现在与其他提问一样按取消离开，并回复「已取消。」）。
  - Agent 停止当前回合：`取消` 之外也认 `退出`、`算了`、`quit`、`exit` 及全角、大小写、末尾标点；`@zhin.js/agent/turn` 的 `isCancelIntent(text, commandPrefix?)` 新增可选参数，带命令前缀的取消词（如前缀为 `/` 时的 `/cancel`、前缀为 `#` 时的 `#取消`）按会话真实的命令前缀剥离后识别，不再写死 `/cancel`——命令前缀不是 `/` 的会话里，`/cancel` 不再停止回合（发 `cancel` 或带本会话前缀即可）。
  - 聊天重启 `restart` 的确认参数、功能自助 `功能 确认 <码>` 的确认子命令认所有基础确认词（如 `restart 确定`、`restart ok`、`功能 OK 123456`），仍需同一个人在同一会话、在时限内确认；`是` / `no` 等是非答语不算。
  - 插件：提醒创建（`@zhin.js/plugin-reminder`）只对等待中的补问回复判断取消，不再把命令参数当取消（之前 `remind create 十分钟后 取消` 会直接取消；现在 `remind create 明天9点 退出` 按正文「退出」创建）。提醒的补问与点歌选择（`@zhin.js/plugin-music`）之前只认当前语言的一个取消词（`取消` 或 `cancel`），现在不分语言都认上述取消词；回复文案仍用流程固定的语言。

- 50b577d: #1250 第 75 批：群里无权限者发确认 / 审批 / 管理类命令时，机器人不回复、不执行，避免旁人乱操作刷屏；私聊照旧回复无权限原因，有权限的人操作出错（确认码过期、格式不对等）照常提示。这些拒绝都记为入站结局 `permission_denied`（群里 `reply: no`，私聊 `reply: yes`），Console「消息结局」可查；原有审计照常写。

  - `@zhin.js/agent`：Agent 管理命令（`models`、`tree`、`fork`、`compact`、`reset`、`ai.health`）对非主人 / 受信任用户、审批卡命令 `approve <id>` / `deny <id>` 对不在审批人名单且不是能结算该自我变更卡的全局主人、主人命令 `approve …` 对非全局主人（全局主人在群里发仍提示改用私聊）、群规命令 `rule approve|reject|disable …` 对非群管理员 / 非审批人：在群聊与频道里不回复，消息在入站管理阶段终止，不会再进入 AI 回合（模型不会代为回答「没有权限」）；私聊回复不变。群规命令在频道等非群会话、或群规不可用时也先判审批人：非审批人静默，只有审批人收到「只能在对应的群里用」「群规不可用」。`rules` 列表、`memory` / `forget` 仍对所有人开放。`RuntimeManagementDeps`、`ImApprovalCommandInput`、`GroupRuleCommandInput`、`OwnerApprovalCommandContext` 新增可选回调 `onUnauthorized(reason)`：处理器在回复是「无权限拒绝」时调用它（返回的文案不变），由入站阶段决定群里静默、私聊回复。
  - `@zhin.js/agent`（不兼容）：删除只为兼容保留的 `ingressMessages.cleared` 键（清空确认文案只在清空命令里使用）。
  - `@zhin.js/core`：别人提问的确认 / 选择按钮被旁人点击时，群里不再回复「交互已过期」（提问仍属于被提问的人，结局 `permission_denied`，原因 `interaction_not_own`）；旁人打字回答本来就不会被当成回答，现有测试锁定。带 `permit` 的按钮被不满足条件的人点击时，群里不再回复「你不能使用这个按钮」，私聊照旧说明。提问结束后 10 分钟内（最多记 512 个按钮）仍记得它是问谁的：旁人在群里点已结束提问的按钮也不再回复「交互已过期」，被提问的人自己点仍提示过期，记录过期或被挤掉后按原样提示。插件命令的 `permit` 不满足、且不满足的是对发送者的条件（zhin 角色、`platform:*` / `platform-role:*` / `platform-permission:*`、`user(…)`、插件自定义 permit）时，群聊 / 频道里不再回复「没有权限执行此指令」（也不调用自定义命令反馈渲染器），结局 `permission_denied` 记 `reply: no`；场合条件（`private()`、`group()` 等）与机器人自身条件（`bot:*`）照常回复，例如 `config` 在群里仍对所有人回复。不新增公共导出。
  - `@zhin.js/command`：命令被拒时，若最先不满足的是场合或机器人条件、而发送者也不满足某个对发送者的条件，拒绝结果改为指名后者（`denial.permit`），使群里对无权限者静默；例如 group-suite 的 `teach`（`group()` + `trusted`）被不受信任的人在私聊里发时，回复改为说明需要 zhin 角色。
  - `zhin.js`：聊天 `restart` 对非全局主人在群里不回复（审计原因 `not-global-owner`）；另一位全局主人替别人确认他发起的重启时，审计与结局原因记 `confirmation-not-own`，但他有权限，群里照常提示「没有待确认的重启」；主人自己的确认过期或参数不对照常提示。`功能` / `角色` 自助在任何范围都没有 admin 时先按 `not-admin` 拒绝（`角色` 的用法错误、找不到人等格式类拒绝不再在群里回复无权限旁人），该范围没有 admin、角色不足以授予 / 撤销（`not-admin`、`role-denied`、`owner-denied`、`peer-denied`），或确认码属于别人（新拒绝原因 `confirm-not-own`；确认者本身是全局 admin 时照常提示）时，群里不回复，私聊照旧说明；有 admin 的人的用法错误、确认码过期等仍回复。不新增公共导出。

- a05eb73: #1250 第 78 批：拒绝文案与「是不是全局主人」判定各收成一处。

  - `@zhin.js/permission`：拒绝文案的唯一来源。新增导出 `describeCommandDenial(permit, locale, options)`（命令被 `permit` 拒绝时的回复）、`describeGlobalOwnerRequired(locale, { privateChat, bindCommand, commandPrefix })`（需要全局聊天主人的能力：说明需要全局 owner 以及去哪里授予——Console「聊天角色」页，授予前先私聊发送「绑定 <码>」把聊天身份绑定到 Console 账号；还没有全局 owner 时私聊发送「认领 <码>」）、`describeConversationManagerDenial(locale)`（`canManageConversation` 的标准拒绝）与类型 `PermitDenialOptions`；`describeDeniedPermit` 新增第三个参数。`bind` 是普通命令：调用方给出 `bindCommand`（如 `CommandContext.formatCommand('bind')`）或实际命令前缀 `commandPrefix` 时，文案写出带前缀的「!!绑定 <码>」，都没有时注明「配置了命令前缀时带上前缀」（英文同步，并补「to a Console account」）。（不兼容）`describeDeniedPermit` 一律返回完整句子（如「此功能需要 zhin 角色。……」/ "This needs a zhin role. …"，原为「它需要 zhin 角色……」/ "it needs a zhin role…" 这样的句子片段），它也是 `CommandDispatchResult.denial.reason` 与命令反馈渲染器拿到的 `reason`；只有 `describeCommandDenial` 在前面拼上「没有权限执行此指令。」/「无法执行此指令。」（原为「没有权限执行此指令：……」「无法执行此指令：……」）。zhin 角色条件的拒绝不再点名缺的角色（原「需要你在本会话拥有 zhin 角色 {value}」），`owner@global` 改为全局 owner 说明。
  - `@zhin.js/command`：再导出 `describeConversationManagerDenial`（`zhin.js/command` 同样可用）。
  - `@zhin.js/core`：命令拒绝回复改用 `describeCommandDenial`（全局 owner 说明里的「绑定」带上本条消息实际的命令前缀）；`private()` 不满足时回复「此指令只能在私聊中使用，请私聊机器人发送。」（原为通用的「没有权限执行此指令。」）；消息结局 `permission_denied` 的发送者文案与命令拒绝同源（「没有权限执行此指令。」）；按钮 `permit` 不满足的回复改为「你不能使用这个按钮。<原因>」（原因是完整句子）。`usageSubjectFromMessage` 的 `owner` 改用 `isOwner()` 判定（行为不变）。（不兼容）删除 `MessageSender.isMaster` / `isTrusted`（无写入点；角色只读 `sender.chatRole`，判全局主人用 `isOwner()`）。
  - `@zhin.js/agent`：（不兼容）`RuntimeSenderRoles`、`TurnIntentSenderRoles`、`RuntimeManagementSenderRoles` 的 `{ isMaster, isTrusted }` 改为 `{ hostRole?: 'owner' | 'admin' | 'trusted' }`（宿主信任角色：`owner` 只给全局 owner，低层 owner 记为 `admin`）；删除 `ownerApprovalMessages.denied`、`managementMessages.denied`。主人命令 `approve …` 的拒绝改用全局 owner 共享说明（「绑定」带本账号命令前缀）；管理命令对无角色者回复共享的 `describeCommandDenial('trusted')`；`reset` 的拒绝也以这句开头（原「仅聊天角色 owner / admin / trusted 可用」），后面保留改发 /clear 的引导。主人判定统一走 `isOwner` / `hasChatRole`。
  - `zhin.js`：`config` 命令的 permit 改为 `owner@global` + `private()`（与命令内部 `senderIsGlobalOwner` 同一身份集合）：群里不是全局 owner 的人发送时不回复（结局 `permission_denied`），私聊里得到全局 owner 说明，全局 owner 在群里发得到「请私聊」提示。执行时授权器拒绝时回复与 permit 拒绝同一段文案（不再是「仅可在私聊中使用」变体），并像 `restart` 一样记 `permission_denied`（原因 `not-global-owner`）、群里静默。`restart` 与 `config` 的拒绝都改用全局 owner 共享说明，「绑定」带上实际命令前缀。「是否已有全局 owner」只剩一处判定（实例内部 `hasGlobalOwner`）。
  - `@zhin.js/console-protocol`：新增导出 `isGlobalOwnerGrant(grant)`、`hasGlobalOwnerGrant(grants)`；`@zhin.js/host-http`、`@zhin.js/gateway` 判 Console 全局所有者改用它们（行为不变）。
  - `@zhin.js/plugin-bilibili`、`@zhin.js/plugin-earthquake`：（不兼容）删除未被引用的 `SUBSCRIPTION_PERMISSION_DENIED_MESSAGE` 与 i18n 的 `denied` 键；群里无权订阅时改回复标准拒绝 `describeConversationManagerDenial()`。
  - `@zhin.js/adapter-icqq`：`icqq login` 的操作者判定改用 `@zhin.js/core` 的 `isOwner()`（行为不变）。

- d3aae4d: #1250 第 81 批：失败、拒绝、限流文案统一用 `createMessages` 中英双语目录，并在 ADR 0061 §1.8 写明三类失败文案（聊天失败话术、消息结局模板、命令反馈）各自的界面与边界。

  - `@zhin.js/core`：消息结局模板（`formatMessageOutcome`）改由 `createMessages` 渲染，加载时检查中英文占位符一致；缺值仍显示 `—`，文案不变；模板用到 `MESSAGE_OUTCOME_PLACEHOLDERS` 以外的占位符时加载即报错；原因级模板只按自有键查找，`reason` 为 `constructor` 等原型键时回落到码级模板，不再抛错。出站媒体被拒时的占位文本（来源不被允许 / 地址不被允许）合成一个目录；`record`（语音）段在来源被拒时显示「[语音未发送：媒体来源不被允许]」/ "[audio not sent: media source not allowed]"（原为「附件」/ "attachment"）。
  - `@zhin.js/agent`：模型没写出可见回复时的英文兜底按被拒工具数量用单复数（一个工具为 "The required tool `x` was denied and did not run"，原为 "tools … were"）；中文不变，`/clear` 照写（它不看命令前缀）。回合末「操作未执行」说明、后台协作的失败 / 停止 / 补充行改用 `createMessages`，文案不变。（不兼容）删除 `@zhin.js/agent/runtime` 的导出 `renderTriggerError()` 与内置的「❌ AI 处理失败: {error}」模板（生产路径本就不会用到它）：回合失败的聊天回复只经 `renderChatTurnError()`，配置了 `ai.trigger.errorTemplate` 时照旧替换 `{error}` 发出（错误信息里的 `$&`、`$'` 等按原文插入，不再被当作替换模式），未配置时是聊天失败话术。

- 74eb13a: 「这条消息是不是命令」只有一套判断，游戏短口令改走命令系统（#1250 第 82 批）。

  - AI 入口（触发匹配、插话判断、直播间、群聊合并窗口）判断「命令样消息」统一为：该消息所在适配器 / 账号的真实 `commandPrefix`（非空时）加上 `ai.trigger.ignorePrefixes`（默认 `/`、`!`、`！`）。`commandPrefix` 为 `''` 时不加入，不会把所有消息都当命令；配置了 `ignorePrefixes` 时替换默认三项，但真实前缀始终算命令。消息只有在没有命令认领后才会进入 Agent，这里只决定「未被认领的命令样消息」不当 AI 消息、不进合并窗口。
  - 合并窗口去掉写死的 `/^[/#]/`：被 @ 后的内容（`@bot /status`）也走同一判断；`#` 只有是该适配器的命令前缀时才算命令（原始消息以 `#` 触发前缀开头时照旧不进窗口）。
  - 行为变化：适配器 `commandPrefix` 为 `#` 等时，以该前缀开头而没有命令认领的消息不再被 `#` 触发前缀交给 AI。
  - `@zhin.js/agent/runtime` 的 `hasIgnoredTriggerPrefix(text, trigger, commandPrefix)` 新增必填参数 `commandPrefix`（不兼容）。
  - 游戏短口令（`21点 开始`、`接龙 继续`、`猜拳 石头`、`轮盘 加入`……）不再由各游戏的 `middlewares/*-alias` 入站中间件接管，改为命令自身的 `match`（`gameCommandMatch()`：整句正好是口令，或口令加一个该游戏认识的动作词）。删除 `@zhin.js/game-kit` 的 `defineGameCommandAliasMiddleware()` 与类型 `GameCommandAliasRoute`，以及 10 个游戏的 `middlewares/*-alias`，不留兼容。
  - 行为变化（更一致）：短口令现在照常经过指令前缀、permit、冷却与结局记录；不再无条件剥掉开头的 `/`——适配器配置了 `commandPrefix` 时要带该前缀，未配置时 `/21点` 不再是命令。
  - 新增 `二十一点` 短口令；`二十一点 开会`、`21点 开会`、`接龙 今天天气不错` 这类聊天不是命令（旧中间件对 `21点 <任意词>` 会接管）。21 点新增动作 `要牌` / `停牌`（`hit` / `stand`）。
  - `@zhin.js/game-kit`：新增 `gameCommandMatch()`、`gameCommandAction()`、`normalizeBjAction()`、`gameActionWords()` 与类型 `GameActionTableId`；删除 `isTttAction()`、`isAdvAction()`、`isRpsAction()`、`isGuessAction()`、`isDiceAction()`、`isChainAction()`、`isRiddleAction()`（只供已删除的别名中间件使用）。21 点不再各写两份动作归一化，统一用动作表。
  - 合并窗口：`/` 开头（原始消息或被 @ 后的内容）始终不进合并窗口，即使 `ignorePrefixes` 改成了别的（如 `['~']`）、适配器前缀也不是 `/`——`/` 是各平台通用的斜杠命令记号，这样的消息单独成一轮，不与相邻消息拼成一句。只影响合并窗口，不影响 AI 触发判断。
  - 游戏进行中发本游戏的命令口令不再被当成作答：猜谜进行中发 `猜谜` / `猜谜语`、接龙进行中发 `接龙` / `成语接龙`（及口令加已知动作）会交给命令（回帮助），不当谜底 / 成语，不扣失误、不判负。判断按该会话真实的指令前缀：配置了 `/` 时 `/猜谜` 是命令、裸 `猜谜` 仍是作答。`@zhin.js/game-kit` 新增 `routesToGameCommand(input, pattern)` 供自由文本作答的中间件使用。
  - （不兼容）`@zhin.js/game-kit` 的游戏定义（`RuntimeRegisteredGame` / `defineGame()`）删除 `commandPrefix` 字段：各游戏写死的 `'/21点'` 一类值不再存在，入口只由 `commandPath` 与命令系统决定。原值去掉 `/` 后并入各游戏的 `aliases`（`骰子`、`地牢`、`猜数`、`接龙`、`轮盘`、`猜拳`、`冒险`、`井字棋`、`猜谜`），`排行 骰子`、`游戏大厅 骰子` 照旧能找到游戏。
  - 游戏大厅 AI 工具 `game_catalog` 的 `startCommand` 不再是写死 `/` 的 `/猜数 开始`：改用与 `games` 命令同源的命令索引渲染（`GameIndex.formatCommand`），工具调用没有会话前缀，因此不带前缀（如 `猜数字 开始`），工具说明提示模型在配置了指令前缀的会话里加上前缀；拿不到命令索引时退回 `commandPath`（如 `guess 开始`）。`toGameCatalogEntry()` 新增可选第二参数。
  - 各游戏 README 的命令示例注明 `/` 只是示例前缀、按适配器 `commandPrefix` 书写，并把已不存在的 `/游戏` 改为 `游戏大厅`；`docs/ai` 注明与 `commandPrefix` 相同的触发前缀（如 `#`）不再生效。

- 93c5172: #1250 第 83 批：Agent 管理命令改为 Root 命令，和 `bind`、`config`、`restart`、`language` 一样走命令分发。

  - `models`、`health`、`tree`（`tree N`）、`fork N`、`compact`、`reset`，以及启用语义记忆时的 `memory`、`memory forget <key|id|all>`，由 zhin 实例的 Agent Host 注册（未安装 Agent 时不存在）。它们出现在菜单 / 帮助里，有近似指令提示，参数由命令模块解析（`tree 0`、`fork` 缺编号等给出用法），处理结果记 `command_replied`；命令认领的消息不进入 AI 回合。都不设冷却。
  - 权限：`models`、`health`、`tree`、`fork`、`compact` 声明 permit `trusted`（本会话链上任一 zhin 聊天角色，与原来的「有宿主聊天角色」判定等价），菜单只给有权限的人列出；群里无权限者静默（`permission_denied`），私聊回复原因；拒绝原因只有 `denied:trusted` 一种（不再有 `not_operator`）。
  - `reset` 对所有人开放，菜单里人人可见：有聊天角色的人发它直接归档当前会话（成功归档的固定确认仍记为本会话自己的投递，ADR 0067 D8）；其他人发 `reset` 等同 `/clear`——同一条清空路径、AI 触发与 @ 要求、确认冷却、控制面与发言闸门，不再回复无权限或「改发 /clear」的引导。
  - 只回应人：消息来源标为其他机器人（`origin` 不是 `human`）时这些命令不回复、不执行，结局 `filtered_by_policy`（原因 `non_human_origin`），与改前 Agent 入站的处理一致。
  - 命令在分发它的那一代上运行：推理与模型操作持有的是这条消息被分发时那一代的租约（Host 操作资源里的分发租约），不再取当前最新一代。没有 Host 模型操作时 `tree N`、`fork`、`compact` 报错，不再直接执行。
  - `memory` 在群聊 / 频道里不再把发送者的记忆公开到群里，只提示「记忆只在私聊里列出，请私聊机器人发送 /memory 查看」（中英文）；私聊照常列出。`memory forget` 在群里照常执行，只回复遗忘了几条，不回显记忆内容。`memory` 只作用于发送者自己的记忆；语义记忆未就绪时回复「未启用长期记忆」，不再交给 AI。
  - （不兼容）删除无前缀 `ai.health`（改用 `health` 命令）；`forget` 改为 `memory forget`。
  - `@zhin.js/agent`：（不兼容）删除 `handleRuntimeManagementCommand`、`RuntimeManagementDeps`、`RuntimeManagementSenderRoles`；新增 `createRuntimeManagementCommands()`、`RUNTIME_MANAGEMENT_PERMIT` 与类型 `RuntimeManagementCommand`、`RuntimeManagementCommandHost`（`open(message, dispatch, run)`、`clear(message, dispatch)`）、`RuntimeManagementDispatch`、`RuntimeManagementOperation`；`AgentTurnIngressRoute` 新增 `runManagementOperation()` 与 `clearAsCommand()`；`createHostOperationResources()` 的 IM 操作资源额外提供分发租约（内部令牌）。入站管理阶段（`tryHandleIngressCommands`）只保留带短码的 `rule …`、`approve …` / `deny …` 与主人 `/approve …`，其上下文去掉 `lease`、`operationSignal`、`sessionKey`、`senderRoles`、`withInference`、`withModelScope`、`replyFixed`。

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

### Patch Changes

- 0899424: 私聊里发起人自己按原文存下的消息不再算作外部内容来源（zhinjs/zhin#1250 `own-unhandled-message-counts-as-background`，ADR 0067 D8）。

  - 行为变化：私聊里本回合发起人自己更早发的、没被处理的纯文本消息（例如不是指令的 `/clear`）再以背景消息出现时，不再让回合算作「读过外部内容」，之后建定时任务不再因此要求确认。只认声明了 `messaging.inboundTextAuthoredBySender` 的适配器、同一平台、同一 endpoint、同一会话里与发起人同一 sender id（发起人来源须为 `human`）、带核心入站原文证据的 `message.created`；未声明能力的适配器、带转发标记的消息、群聊、频道、别人发的、带引用 / 转发 / 媒体 / @、被改写或缺少证据的消息照旧计来源。
  - 行为变化：清空与 `<指令前缀>reset` 的固定回复按原文送达时，以带 `key:` 前缀的会话键记入本会话投递记录，下一回合不把它算作背景来源（`/clear`、`/reset`、`/new` 本身的处理见同批 b67 changeset：直接清空本会话上下文）。
  - `@zhin.js/adapter`（新增公开能力位）：能力画像 `messaging` 新增 `inboundTextAuthoredBySender`，声明本适配器入站的文本段都是发送者亲笔（转发、引用、卡片表示为非文本段、`replyTo` 或 `forwarded` 标记）；没声明按不保证处理。
  - `@zhin.js/im-contract`：`ConversationMessage` 新增可选 `inboundTextDigest`，`ConversationContextBlock` 新增可选 `inboundActorId` / `inboundTextDigest`。
  - `@zhin.js/core`（新增公开字段）：`IncomingMessage` 新增可选 `forwarded`；`ConversationRuntime` 构造参数新增可选 `{ evidenceKey }`，`recordIncoming` 新增可选第三个参数 `{ textAuthoredBySender }`。入站链按适配器画像传入声明；只对声明了能力、有发送者、无转发标记、无引用、纯文本（纯文本视图与文本段一致、非空）且未被认领码脱敏改动的入站消息写原文证据。证据是以实例进程内随机密钥计算的 HMAC-SHA256，绑定会话、消息、发送者 id 与原文；聚合背景块时按存储内容重算核对后才给出，进程重启后旧证据失效。发送者 id 去掉首尾空白后存储。
  - `@zhin.js/adapter-telegram`：转发（`forward_origin` 与旧版 `forward_*`）、自动转发、inline bot 结果（`via_bot`）、跨会话引用（`external_reply`、`quote`）的入站消息带 `forwarded: true`；新增导出 `isTelegramRelayedMessage`；声明 `inboundTextAuthoredBySender`。
  - `@zhin.js/adapter-onebot11`、`@zhin.js/adapter-napcat`：CQ 字符串上报格式下，`[CQ:reply,id=…]` 解析为 `replyTo`；串里出现 reply 以外的 CQ 码（at、face、卡片、转发、markdown、媒体等）、不合规的方括号，或 `message` 与 `raw_message` 不一致时，入站消息带 `forwarded: true`，不写原文证据（失败关闭）。NapCat 不再把原始 CQ 串包成单个文本段，纯文本视图改为剥掉 CQ 码后的文本，与 OneBot11 一致（判定见 `src/protocol.ts` 的 `inspectCqString` / `isCqStringRelayed`）。
  - `@zhin.js/adapter-sandbox`、`@zhin.js/adapter-onebot11`、`@zhin.js/adapter-napcat`、`@zhin.js/adapter-discord`：核实入站转发 / 引用 / 卡片都不以纯文本段出现后声明 `inboundTextAuthoredBySender`。

- ea1195f: #1250：聊天里发 `/clear`、`/reset`、`/new` 直接清空本会话的 AI 上下文，不再回「怎么重置」的提示。

  - 行为变化：没被任何指令处理的 `/clear`、`/reset`、`/new`（任意大小写，半角或全角斜杠，整条只有这个词）在私聊或 @ 机器人时，调用与「清空」、`<指令前缀>reset` 相同的归档（`ZhinAgent.archiveSession`）清空发送者自己的会话上下文（私聊是该发送者的私聊会话，群里是该发送者在这个群的会话），回复「已清空本会话的 AI 多轮上下文。长期记忆和定时任务不受影响。」（英文同义）；入站结局记 `cleared`（`clear_command`），不再记 `suggested`（`reset_hint`）。长期记忆、定时任务、会话设置不受影响。
  - 生效范围：清空只在机器人会回应你的地方生效——私聊，或群里 @ 机器人（`mentioned` 或 `metadata.mentioned`，与 AI 触发同一判定；Telegram 群里的 `/clear@<本机器人用户名>` 也算，@ 的是别的机器人时不算），且经过控制面入站闸与发言判定、AI 触发开着并会回应这类消息（`respondToPrivate` / `respondToAt`）。`ai.access` 不参与判定（IM 入站各处都不执行它）。不要求主人身份（与发「清空」一致）。
  - 行为变化（收紧）：直播间和插话（ambient）里一律不触发清空——此时会话是共享的场景任务——「清空」、`#/new`、`@机器人 /reset` 等照旧当普通消息处理；原先直播间里发「清空」会清掉共享场景会话，现在不会。
  - 控制面拦了出站时不清空、不回复，消息照旧往下走（触发写法「清空」与斜杠写法一致）。
  - 防刷屏：确认在确实归档了内容时发送，否则同一会话同一发送者 60 秒内只确认一次；冷却只在真正发确认时开始。
  - 指令先认领：插件命令或管理命令先认领的消息照旧按命令处理。命令前缀为 `/` 时 `/reset` 是管理命令，仍只给主人或受信任用户；其他人得到的无权限回复现在会指引改发 `/clear`（或「清空」）清空自己的上下文。
  - 公开行为变化：`isClearCommand`（`@zhin.js/agent` 入口导出）的识别范围变宽，除 `clear` / 清空 / 重置外，也识别 `/clear`、`/reset`、`/new`（`NFKC` 归一、不分大小写、半角或全角斜杠）。`ingressMessages` 保留 `cleared` 键（文案与新确认一致）。
  - `@zhin.js/adapter-telegram`：入站消息的 `metadata` 带本机器人用户名 `botUsername`（来自 `getMe`），供 Agent 区分 `/clear@<本机器人>` 与别的机器人的命令。

- 4bb60d7: AI 回复遵从用户用 `/language` 设置的个人语言（zhinjs/zhin#1250 第 69 批）。之前 `/language en` 只影响指令与固定回复，AI 仍跟随提问的语言作答；现在设置过个人语言的用户，用中文提问也会收到英文回复。

  - 行为变化：IM 入站回合会核对发送者是否亲自设置过个人语言（复用 Root 的个人语言偏好端口，并写入可信回合元数据，适配器元数据无法冒充）。设置过时，本轮 `[Turn context]` 的语言行由 `Reply language fallback: en.` 改为 `Reply language (set by the user with /language): en.`，并说明：即使用户用另一种语言书写也照此回复，只有当前这条消息里的明确语言要求才能覆盖它，`[User profile]` 里的 language 只作参考。进度摘要与步数用尽后的总结使用同样的措辞。
  - 稳定系统提示里的回复语言规则改为：明确要求 → 用户的 `/language` 设置 → 用户原文语言 → `Reply language fallback` → SOUL.md；规则仍与用户无关，缓存前缀结构不变。
  - 未设置个人语言的用户、群里合并多人消息的回合、直播弹幕窗口和机器人主动插话的回合行为不变（仍是 `Reply language fallback`）；群里每人按自己的设置，互不影响；聊天创建的提醒与计划任务仍使用创建时记录的语言。
  - `user_profile` 工具说明更新：language 维度只作参考、不决定回复语言；用户想改回复语言时应提示其发送语言指令（如 `/language en`），保存 language 时工具回执也会提示这一点。
  - 不新增导出，公共类型不变。

- 7f39b10: feat!: 出站模板占位符重组为分组字段，并按发送账号渲染命令前缀、菜单与命令写法（#1250 第 70 批）

  **不兼容变更**：`TemplateContext` 字段重组，旧的顶层占位符 `${adapter}`、`${endpoint}`、`${endpointId}`、`${kind}`、`${conversationId}`、`${content}`、`${segments…}`、`${messageId}`、`${timestamp}`、`${mentioned}` 不再展开，会原样发出。所有占位符都至少两段，不再和配置加载时的环境变量引用（单个名字的 `${NAME}`）冲突。

  - `@zhin.js/plugin-runtime`：`TemplateContext` 改为分组——`bot`（`adapter`、`endpoint`、`endpointId`、新增的 `prefix` 与 `menu`，新增导出类型 `TemplateBot`）、`conversation`（`kind`、`id`）、`sender`（`id`、`name`、`roles`）、`message`（`content`、`segments`、`id`、`timestamp`、`mentioned`）与新增的 `command`（发出消息的插件自己的命令在该账号下的写法，`${command.checkin}`、`${command.group.kick}`，命令名里的 `-` 写成 `_`，新增导出类型 `TemplateCommandPaths`）。由事件触发、没有入站消息的发送，由发送方插件经 `incoming.sender` 传入事件主体。
  - `@zhin.js/core`：出站渲染按新结构填值；`${bot.menu}` / `${command.*}` 按这次发送的语言（`SendRequest.locale`，`$reply` 带入站消息的语言）取菜单关键词，没有时用项目语言，与入站 `message.commandMenu` / `formatCommand` 一致；`menuKeyword: false` 时 `${bot.menu}` 原样保留并按代告警一次（`reason=menu_disabled`）；`bot.prefix` / `bot.menu` 用与入站命令派发同一个 MessageDispatcher（同一个前缀解析器，含 `ImRuntime` 的 `commandPrefix` 覆盖）计算，只有文本含 `${` 时才计算，`${command.*}` 只在文本写了它时才列命令。模板仍是白名单路径替换、单次扫描；`command` 数据冻结、只有数据属性、不含其他插件的命令。
  - `@zhin.js/plugin-group-suite`：**不兼容变更**——入群欢迎语与问答回答改用出站模板占位符，旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 不再展开，会原样发出。欢迎语写 `${sender.name}` / `${sender.id}`（新成员作为数据传入，昵称里的占位符不会被展开）、`${bot.menu}`、`${bot.prefix}`、`${command.*}`；问答回答另可写 `${now.time}`、`${now.date}`（由插件按提问者语言填写），正则捕获组 `$1`–`$9` 作为不受信任内容发送，不会被当成模板。账号配置了命令前缀而欢迎语直接写「帮助」「菜单」「help」「menu」时，在该账号第一条群消息时打一条 warn（只对本插件实际负责欢迎的群：在 `welcomeConversations` 内、且未由 Agent 会话欢迎接管）。欢迎语与已存问答里的旧占位符（`{name}`、`{sender.id}`、`{time}`、单段 `${menu}` 等）首次用到时按账号与文本各告警一次并给出新写法，只告警，不兼容、不迁移。
    - 回显用户数据的命令回复不再把数据当模板展开：teach / teach-regex 的确认、teach-list、forget、keyword-add / keyword-list / keyword-remove、积分与消息排行、mypoints、mystats 里引用的问题、回答、关键词、昵称与正则错误信息作为不受信任分段发送，按存储原样显示（此前教 `你好|你好 ${sender.name}` 的确认会显示「你好 Admin」）；只有插件自己的文案是模板。
    - **公开导出的返回类型变化**：`tryTeachReply` 由 `Promise<string | null>` 变为 `Promise<SendContent | null>`；`teachAdd`、`teachList`、`teachForget`、`myPoints`、`pointsRank`、`statsRankText`、`myStatsText` 由 `Promise<string>` 变为 `Promise<SendContent>`（引用用户数据时是含不受信任分段的数组）。直接调用这些函数的代码需按 `SendContent` 处理，或交给 `$reply` / 出站链发送。
  - `@zhin.js/agent`：Agent 会话入群欢迎（ADR 0037）的 `{nickname}` / `{group}` / `{rules_url}` 填入的值作为数据（`WelcomePart` 文本段新增可选 `literal: true`，发送时为不受信任分段），昵称里的 `${bot.menu}` 等不再被展开；运营者写的其余文本仍是出站模板。
  - `@zhin.js/testing`：`PluginTestKit` 与 `zhin start` 一样安装出站模板 Host（测试自己提供时不覆盖）。
  - `@zhin.js/gateway`：群欢迎用途页的提示改为新占位符写法。

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

- ee51324: 统一 `${VAR}` / `env://` 环境变量引用的识别（#1250 第 79 批）：所有识别、提取与「缺少环境变量」检查都改用 `@zhin.js/plugin-runtime` 里与展开器共用同一解析器的函数，规则与展开完全一致。

  - `@zhin.js/plugin-runtime` 新增 `parseEnvironmentReference()`（整段引用，含 `:-` / `:=` 默认值）、`isWholeEnvironmentReference()`、`environmentReferencesIn()`（提取所有引用及是否带默认值）、`parseEnvUri()`（`env://NAME`）、`isEnvironmentVariableName()`、`findUnsetEnvironmentReferences()` 与 `createEnvironmentLookup()`。
  - 「缺少环境变量」只有一个实现：实例启动警告与网关配置校验的 `missingEnv` 都调用 `findUnsetEnvironmentReferences()`；带默认值的引用（`${VAR:-…}` / `${VAR:=…}`，即使默认值为空）不再被报缺失。
  - `@zhin.js/host-http` 删除导出 `ENVIRONMENT_REFERENCE_PATTERN`，改用 `isWholeEnvironmentReference()`。
  - 密钥字段识别（`isConfigEnvironmentReference`）只把展开器会替换的引用或合法的 `env://NAME` 当作引用：`p${ss`、`${1KEY}`、`env://bad-name` 这类文字现在按字面值密钥处理（启动警告、`zhin doctor --fix`、Console 写入 `.env`）。
  - 网关：密钥字段原本是 `${HTTP_TOKEN:-默认值}` 时，写入新值会原地更新该字段自己的变量（不再另起 `_2`），配置改为 `${HTTP_TOKEN}`；数据库初始化向导里整段带默认值的引用按引用保留，不再写入 `.env`。
  - AI：`${VAR:-默认值}` 凭据表达式的默认值与展开一致，可以包含 `{`；旧配置迁移只把整段 `${VAR}` / `env://VAR` 转成 `env://` 账号来源（写错的 `${…` 仍然拦下，不当作字面密钥）。
  - 适配器 Console：环境变量字段只在值为不带默认值的整段 `${VAR}` 时显示原文，带默认值时按密钥遮蔽（默认值可能就是密钥）。
  - 适配器账号导入（`zhin.config.yml` → 持久化账号）：含 `${` 的值仍一律作为引用存入 `secretRefs`（与旧版一致，按密钥遮蔽、不进入保存的配置），即使它不是合法引用。启动时，旧版本已存储的不合法引用（如没有闭合的 `${QQ_SECRET`，或本身含 `${` 的真实令牌）按原文作为字面值使用，并记一条警告（只含账号 ID，不含值）提示改正后重新导入；过去这类值同样按原文生效，升级后账号照常启动。
  - 网关 `.env` 视图：`isReference` 只标记不带默认值的整段 `${NAME}`（与协议说明一致）；Console 配置遮蔽只遮蔽解析器认可的引用，其他含 `${` 的文字在普通字段按原文显示，密钥字段仍遮蔽。
  - 脚手架数据库校验、`@zhin.js/plugin-code-runner` 与 `@zhin.js/plugin-calendar` 的「未展开占位符」判断改用同一解析器（插件经 `zhin.js` 主入口拿到 `isWholeEnvironmentReference()`）：`${1KEY}` 这类文字现在按真实值处理，`${VAR:-}` 仍视为未配置。
  - 实例：`readConfiguredEndpointKeys()` 新增可选的环境查找参数，实例传入自己的 EnvStore，未生效配置里的端点 ID 能读到 `.env` 里的变量（过去只读进程环境）；`resolveAiConfig()`、Speech 与协议 Host 的配置读取不再对已展开的配置做第二次只读进程环境的展开（过去会把 `.env` 值里的 `${…}` 文字再展开一次）；`http` 配置改为与网关 / CLI 相同，从未展开的配置文档只展开一次（过去 `${B:-${C}}` 在 `B` 未设置时会被二次展开成 `C` 的值）。实例内部删除了从未被读取的 `secureCredentialProvider` 选项。

- 58ce469: #1250 第 80 批：小型去重，统一多轨实现。

  - **重试、退避与可中断等待**：`@zhin.js/plugin-runtime` 新增 `sleep(ms, signal?)`（中止时清理计时器并以 `signal.reason` 拒绝）、`parseRetryAfterMs()`（解析秒数与 HTTP 日期：接受小数秒、`.5`、`5.` 与前导 `+`；负数、`1e3`、`0x10` 等非法值返回 `undefined`，AI 路径遇到这类值退回普通退避）和 `computeBackoffDelay()`（指数退避，默认等量抖动，可选对称抖动比例），插件经 `zhin.js` 导入。AI Provider 重试、OAuth 刷新冷却、适配器启动重试、地震与网络工具插件的 HTTP 重试、B 站直播 / QQ 扫码 / Telegram 轮询 / 微信 iLink 的等待全部改用它们；`@zhin.js/kernel` 删除不支持中止的 `sleep`，`@zhin.js/ai` 不再导出 `computeBackoffDelay` / `parseRetryAfterMs`，地震、网络工具和微信 iLink 插件不再导出各自的副本。
  - **HTML 转义**：`@zhin.js/plugin-runtime` 新增 `escapeHtml()`（转义 `& < > " '`），AI 输出、Console 页面外壳、`segment.escape`、链接海报和日历回调页改用它；`@zhin.js/pagemanager` 不再导出自己的 `escapeHtml`。`@zhin.js/jsx` 因只依赖 IM 契约保留同一实现，由契约测试锁定一致。
  - **`MarkdownView`**：`@zhin.js/components` 的 `Markdown` 组件改名为 `MarkdownView`（`MarkdownProps` → `MarkdownViewProps`，主题组件名同步），与 `zhin.js/jsx` 输出 Markdown 消息段的 `Markdown` 标签区分，不保留旧名。
  - **会话键**：`@zhin.js/console-protocol` 新增四段会话键 `parseConversationSessionKey()` / `formatConversationSessionKey()` / `isHashedSessionKey()`，网关用量统计（`parseSessionKey` 改名为 `sessionAddressOf`；endpoint 段为空的会话键照常解析，三段键只给出 platform）、实例的聊天记录与收件箱校验、沙盒页面都改用它。功能会话键在 plugin-runtime 与 console-protocol 中各保留一份（两者都是零依赖契约），由契约测试锁定语法、转义与错误文案一致。
  - **聊天角色导出格式**：`@zhin.js/console-protocol` 新增 `CHAT_ROLES_EXPORT_FORMAT`、`CHAT_ROLES_EXPORT_VERSION`、`CHAT_ROLES_BACKUP_DIRECTORY_SEGMENTS`、`chatRolesBackupFileName()` 与 `isConsoleChatRolesExport()`，`zhin chat-roles export|import` 与实例的导出、导入和迁移前备份共用；实例导入现在与 CLI 一样要求四个列表都存在。

- a5ac09e: #1250 第 85 批：收紧入站路由与 Agent 管理命令的分发租约。

  - `ingressRouteToken` 改为 Root 私有 token（`createRootPrivateToken`）：插件作用域 `use` / `has` 读不到它，运行时快照的公开资源里也没有它。IM 运行时改经 Root 的真实快照存储按消息租约读取：`resolveIngressRoute(snapshots, lease)`（签名变化，原来是 `resolveIngressRoute(snapshot)`）；`executeInboundTurnSpine` 不再从快照公开资源回退读取路由，只用 `envelope.ingressRoute`。
  - 令牌下承载的也只是入站钩子的窄外观：新增 `createIngressRouteFacade(route)`（`@zhin.js/core/runtime`），返回冻结对象，只有绑定到路由的 `preRoute` / `shouldRouteBeforeDispatch` / `route`；Agent Host 不再提供 `AgentTurnIngressRoute` 对象本身，路由的选项（Agent 运行时、快照存储）与 `clearAsCommand` / `runManagementOperation` 都不经令牌暴露。`AgentTurnIngressRoute` 的选项改为 ECMAScript 私有字段（`#options`）。
  - 纵深防御：`AgentTurnIngressRoute` 的 `route` / `preRoute` 只处理 Root 真实快照存储签发且仍有效的租约（`AgentRuntime.ownsLease(lease) && lease.active`）；伪造或他人的租约不路由（返回 `false`，静默，记一条 warn 日志），伪造消息无法借此执行清空等操作。
  - 分发租约只认本 Host 分发交出的：`createHostOperationResources()` 返回值新增 `holdsDispatchLease(lease)`（只认本工厂签发的租约端口 `retain()` 交出的租约），`AgentTurnIngressRoute` 新增可选项 `holdsDispatchLease`；管理路径除了用真实快照存储校验，还要求租约是本 Host 分发交出的，直接从快照存储 `acquire()` 的租约不执行。**行为变化（嵌入方）**：自行装配时必须把同一个 `createHostOperationResources()` 实例的 `holdsDispatchLease` 传给 `AgentTurnIngressRoute`，不传时 `/models`、`/health`、`/tree`、`/fork`、`/compact`、`/reset` 一律以 `dispatch_lease_rejected` 拒绝；`runManagementOperation` 收到没有 `retainLease` 的分发时也同样拒绝（与 `clearAsCommand` 一致）。校验抛错时，已 retain 的租约在抛出前释放。
  - Host 侧拒绝租约时不再抛普通错误：以 UserFacingError 拒绝（结局 `refused`，原因 `dispatch_lease_rejected`），回复「这条管理命令没有通过本实例 Agent Host 的分发校验，没有执行。」（英文同义）。
  - `createRuntimeManagementCommands()` 新增可选项 `hostResourcesInstalled`：Host 接好操作资源时传 `true`（`zhin start` 装配的实例已传），调用方自传的 `operation` 即使不提供任何资源，管理命令的结局也是 `direct_command_required`（之前误报 `management_unavailable`）。`imOperationResourcesToken` 是 Root 私有 token，不在运行时快照的公开资源里，所以由 Host 显式声明，而不是从快照判断。
  - 结局说明新增原因级模板 `refused` / `direct_command_required` 与 `refused` / `dispatch_lease_rejected`，ADR 0061 表同步；`docs/ai/agent.md`（中英文）补充说明。

- Updated dependencies [0899424]
- Updated dependencies [7f39b10]
- Updated dependencies [637383b]
- Updated dependencies [50b577d]
- Updated dependencies [49f9042]
- Updated dependencies [a05eb73]
- Updated dependencies [ee51324]
- Updated dependencies [58ce469]
- Updated dependencies [d3aae4d]
- Updated dependencies [74eb13a]
- Updated dependencies [45dcb9e]
- Updated dependencies [a5ac09e]
- Updated dependencies [884d827]
  - @zhin.js/core@1.14.0
  - @zhin.js/im-contract@1.3.1
  - @zhin.js/adapter@1.6.0
  - @zhin.js/plugin-runtime@1.5.0
  - @zhin.js/permission@1.3.0
  - @zhin.js/ai@1.9.0
  - @zhin.js/kernel@1.6.0
  - @zhin.js/feature-kit@1.1.21
  - @zhin.js/tool@1.1.25
  - @zhin.js/agent-feature@1.1.22
  - @zhin.js/mcp-feature@1.2.1
  - @zhin.js/prompt-section@1.1.21
  - @zhin.js/skill@1.1.22

## 1.9.1

### Patch Changes

- dff78e6: #1250 第 55 批：定时任务权限收紧。

  **行为变化：普通用户在聊天里只能看到、管理自己的任务。**

  - 聊天工具 `schedule_list`：所有者（`owner` 角色）照旧看到全部持久化任务；其他人（群管理员也一样）只看到自己在聊天里创建的任务（同一用户、同一平台账号与 endpoint，与 `createdBy` 记录的规则相同）和投递到当前会话的任务，不再看到别人的提示词、投递目标与 Agent；投递到当前会话的他人任务，会话成员能看到其提示词与标签。非 IM 来源（A2A、MCP、到点运行、远程 Mail 等，`createdBy` 没有聊天地址）创建的任务不认创建者，只有所有者能在聊天里看到和管理，避免共用的 `a2a-client` / `mcp-client` / `schedule` 或对端自报的 id 互相冒充。任务指定的 Agent 不在当前会话可用的 Agent（`@名称` 可见范围加默认 `zhin`）之内时，只显示「其他 Agent」（`agent_hidden: true`）；已从配置删除的 Agent 只对所有者显示名称，其他人看到「其他 Agent」（仍带 `agent_missing: true`）。插件内存任务（只有插件名与 cron）照常列出。
  - 聊天工具 `schedule_remove` / `schedule_pause` / `schedule_resume`：所有者可以管理任何任务；其他人只能管理自己创建的任务；任务不存在与不是自己的任务得到同一句「未找到你能管理的任务：<id>」，不透露任务是否存在（所有者仍得到「未找到」）。Console / CLI / Profile 创建的任务（没有 `createdBy`）只有所有者能在聊天里管理。Profile 例程（`source: profile`）在聊天里一律不能删除、暂停或恢复（重启会还原），提示去 Profile 文件（`assistant.profile.file`，默认 `assistant.profile.yml`）修改。
  - Console `cron:resume` 与 `POST /api/assistant/jobs/resume`：恢复后任务会再次投递，因此与 `cron:add` / `cron:set-agent` / `POST /api/assistant/jobs` 一样，任务有 IM 投递目标时要求该账号上的 `endpoint.operate`，否则 403 `schedule_target_forbidden`（RPC：`data.code` / `data.status: 403`）。暂停与删除仍只需 `ops.schedule.write`。
  - Agent 不存在时，`cron:add`、`cron:set-agent` 与 `POST /api/assistant/jobs`、`POST /api/assistant/jobs/set-agent` 的错误新增 `data: { code: 'schedule_agent_not_found', agent, available }`，错误文本不变。
  - 预演不再自己建任务（所有者反馈 `schedule-preview-prompt-creates-schedule`）：预演回合不提供内建的 6 个调度工具（`schedule_list` / `add` / `preview` / `remove` / `pause` / `resume`，带插件前缀的同名限定名与执行计划里点名的也排除；第三方的 `schedule_meeting` 等照常提供），模型把「明天 8 点提醒我喝水」这类建任务请求原样传给 `schedule_preview` 时，预演不会再调用 `schedule_add` 并被无人值守规则拒绝、让用户点了允许却收到「任务没建成」。`schedule_preview` / `schedule_add` 的 `prompt` 参数说明改为「到点要执行的内容（例如『提醒我喝水』），不是建任务的请求，不要包含时间安排」。调度回合的执行画像（`TurnExecutionProfile` 的 `schedule` 分支）新增可选 `preview`。
  - Profile 例程写的 Agent 不在配置中（`zhin` 与 `ai.agents`）时，启动同步记一条警告日志 `profile_routine_agent_missing`；任务照常同步。`syncProfileRoutinesToStore` 新增可选的第三个参数 `{ agents }`。

- 23eb6ef: 前几批审查遗留的低危项（#1250 第 56 批）。

  - **移除工具预执行**（ADR 0067 遗留）：`preExecutable` 工具原先在模型调用前被执行，输出作为「Pre-fetched data」注入提示词，不经工具运行时、不记来源。Plugin Runtime 路径本就不保留这个标记，只有旧的 `ZhinAgent.process` / `processTurn` / `processStream` 能走到，而这条路径没有来源门禁，因此直接删除该机制：回合不再注入预取数据；`@zhin.js/agent/tool` 的 `planToolRun()` 与 `ToolRunPlan` 已弃用、不再起作用（不执行任何工具，总是返回空的预执行结果），下一个 minor 删除；`AgentTool.preExecutable`（`@zhin.js/ai`）、`Tool.preExecutable` 与 `SceneManagementMethodSpec.preExecutable`（`@zhin.js/core`）保留为 `@deprecated`、不再起作用，成员列表 / 场景信息工具不再标记它。`ai.agent.preExecTimeout` 改为已弃用键（启动告警、`zhin config check` 报告、`--fix` 删除），从 `@zhin.js/runtime` 的配置 schema 与默认配置中移除。
  - `TriggerTimeoutError` 合并为一个类：`@zhin.js/agent/runtime` 重新导出 `@zhin.js/agent/turn` 的实现，工具运行时把入站超时正确认作 harness 错误。构造函数以超时毫秒数为主（`new TriggerTimeoutError(60000)`），旧的 `(sessionKey, timeoutMs)` 写法仍可用（已弃用），消息统一为「AI 处理超时（Nms）」。
  - 网络请求被重定向到不允许的地址，或重定向那一跳出现其他网络错误（DNS 解析失败、TLS 证书主机名不符等）时，错误原因改为固定文案，不再带出重定向目标的主机名或解析出的地址（原因只写 debug 日志）；首个 URL 的错误原因不变。
  - `zhin update` 的 pnpm overrides 同步（`@zhin.js/gateway`，`zhin update --dry-run` 的 `@zhin.js/cli` 同步一致）：`pnpm-workspace.yaml` 中值为 YAML 块标量（`>-` / `|`）、带锚点且被别名引用、或本身是别名的 Zhin 条目，一律列为「需要手动修改」并给出文件行号，不再自动剪下（块标量原先会多剪下一条，锚点剪掉后别名悬空）。
  - 协作：有协作的根回合在流式回复的每次中间更新和收尾时都过滤 `[[no_reply]]` 标记（含大小写、反引号变体；生成中结尾可能成为标记的残片先暂缓发出，只暂缓最后一个已删标记之后新增的内容；只剩空白的段在生成中也先暂缓，前导空白加纯标记的回答不再发出空白消息），已发内容不被改写，不会因前缀变化被平台流拒绝；actor 回合结束和根回合结束后迟到的委派读取不再登记，结果邮件立即照常处理，不再空等 120 秒。

- a4b52bd: #1250 第 60 批：机器人自己的上一条回复不再让下一回合算作「读过外部内容」（`own-reply-counts-as-background`，ADR 0067 D7）。

  - 行为变化：会话游标停在本回合的入站消息上，回复会作为背景消息出现在下一回合。现在本会话里 Agent 按原文投递的回复再以背景消息出现时，不再记来源 `conversation_context`：只发过一句话的私聊里，下一回合直接 `schedule_add` 不再弹确认（默认分级下），执行命令、写文件、外发、改配置也不再因为「机器人说过话」而确认。背景块仍保留在提示里，模型照旧知道自己说过什么；会话历史本身不算来源，自己的回复与历史同等对待。
  - 仍算来源：成员的消息、场景事件，以及机器人经插件命令、定时任务投递、其他会话发出或被中间件改写过的消息（证据是出站回执的文本摘要与本会话的投递记录，缺任一项都按外部内容处理）；投递记录只在进程内存里，重启后以前的回复重新算作外部内容。
  - 来源链文案按场景：私聊写「私聊里的背景消息」，群聊 / 频道仍写「群聊背景消息」；持久化在定时任务上的来源键不变（`conversation_context`），显示为「会话背景消息」。
  - 安全审查修订：只有没读过外部内容的回合写的回复才进投递记录；读过网页、工具结果、成员消息等的回合，其回复可能复述注入内容，下一回合照旧算来源（回复继承污染），用户回一句「好」不能让 `schedule_add` 跳过确认。重置会话（`/clear`）时一并清空该会话的已告知与投递记录。

- Updated dependencies [23eb6ef]
  - @zhin.js/ai@1.8.2
  - @zhin.js/core@1.13.1

## 1.9.0

### Minor Changes

- 1414572: 协议端自己端口上的媒体地址不再因端口限制被拒（#1250 第 48 批端口限制的后续）。

  - 端点的 `inboundMedia` 新增可选 `origins()`：声明 Endpoint 配置的协议端地址（`http(s)://` 或 `ws(s)://`，后者按同主机同端口的 `http(s)://` 处理）。`roots()` 改为可选，只声明 `origins()` 的端点同样有效。
  - `fetchPublicMediaBytes()`（kernel）新增 `trustedOrigins`：URL 本身就在其中某个 origin 上（scheme、主机、端口完全相同）时，这个 origin 内的各跳不受默认端口限制；从别处重定向进来、或重定向到别的端口，仍只认默认端口。私网 / 回环、scheme 与 DNS 固定检查照旧。
  - 适用范围：协议端部署在**公网**主机的非默认端口上。协议端与实例同机或在内网时，地址因私网规则被拒，与本次无关；识图下载仍只走 https，平台语音链接允许 http。
  - 入站识图与平台语音转写会带上产出端点声明的 origin；用户输入的地址（`[audio:URL]`、`voice_stt`）不受影响。
  - Satori、Milky 声明 `baseUrl`；OneBot11、NapCat 的正向 WebSocket 声明 `url`，NapCat 的 HTTP 方式声明 `http_url`；反向连接没有配置地址，不声明。

- a73fd9c: #1250 第 50 批：委派结果只给一次结论；新建模型服务不再叫 `service`。

  - `delegate` 新增参数 `wait`，默认在本回合内等待子 Agent 的结果：结果按时回来，就直接出现在工具结果里，主模型据此回答一次，这条结果不会在之后再唤醒主 Agent（看图这类短任务走这条路）。同一步里的多个 `delegate` 一起发出、一起等待；每个回合的等待合计最多 20 秒，并扣除回合已用的时间，不会把回合拖到超时。传 `wait: false`（长任务）或等待超时，结果仍作为结果邮件稍后到达；工具结果要求模型期间不要自己回答被委派的部分、也不要猜结果。回合被停止时立即停止等待。
  - 等待中读到的结果只在回合成功把回复送达后才算已用；回合失败、超时、被顶替或被停止时撤销，结果照原路唤醒入口 Agent，子 Agent 的结论不会丢。嵌套委派里，子 Agent 自己等到的结果同样不会再唤醒它。等待中读到的失败结果算作已告知一次。
  - 本次请求已经回复过用户之后，迟到的委派结果唤醒主 Agent 时，会先看到它之前回复的原文（作为数据展示，不当作指令）；结果没有新内容时模型输出 `[[no_reply]]`（忽略大小写、首尾空白与反引号），什么都不发；确有新内容才发一条，开头标「补充：」（英文会话为「Update: 」）。失败结果没有这个出口，模型仍拒答时发固定的失败话术；补充回合被取消时不算已告知。根回合输出的 `[[no_reply]]` 标记也会被去掉，不会发给用户。
  - `zhin ai account add` 新建服务时用驱动的显示名（如「Anthropic」）作服务名称，与已有服务重名时自动加序号（「Anthropic 2」）；账号名称（`--name`）同时作为新建服务的名称；不再把计划别名 `service` 存成服务名称。
  - 插话判断等日志里的服务名遇到泛化名称 `service` / `account` 时改用驱动的显示名（如 `language:Anthropic/claude-haiku-5-5`）；`ambientLanguageSource()` 与 `CreateEngagementJudgeMemberInput` 新增可选 `driverLabel`。

- c7f6285: 定时任务可以指定由哪个 Agent 执行（#1250 第 52 批 `schedule-agent-no-creation-path`）。运行时早已支持 `action.agent`，但没有任何入口能设置它，只能停服改数据库 `agent_schedule_jobs.agent`。不指定 Agent 时行为不变（默认 `zhin`）。

  - CLI：`zhin schedule add --agent <名称>`；新增 `zhin schedule set-agent <id> <名称>` 与 `set-agent <id> --clear`（恢复默认）。`zhin schedule list` 每个任务多一行 `Agent:`（未指定时为「zhin（默认）」）。
  - 实例接口：`POST /api/assistant/jobs` 接受可选 `agent`；新增 `POST /api/assistant/jobs/set-agent`（`{ id, agent }`，`agent: null` 清除）。名称必须是已配置的 Agent（`zhin` 与 `ai.agents` 的键），否则 400 `schedule_agent_not_found`，错误里列出可用的 Agent；心跳任务不能指定 Agent。权限沿用 `ops.schedule.write`。`GET /api/assistant/jobs` 新增 `agents`（可用的 Agent 名称）。
  - Console RPC：`cron:add` 接受可选 `agent`（同样校验）；新增 `cron:set-agent`（`ops.schedule.write`，已登记到 `CONSOLE_RPC_PERMISSIONS`）；`schedule:list` 的持久化任务行新增 `agent`，返回值新增 `agents`。`ConsoleScheduleEngine` 新增可选 `listAgents()` / `setJobAgent()`。
  - 对话工具：`schedule_add` 新增可选参数 `agent`，`schedule_list` 的持久化任务带 `agent`。聊天里只能指定当前会话里自己能用的 Agent：与 `@名称` 点名时的可见范围相同（Agent 包的 `platforms` / `scopes` / `permissions` 过滤），外加默认的 `zhin`；看不到的 Agent 与不存在的一样被拒绝。不在运行时回合内调用（如外部工具协议）时只接受默认 Agent。
  - `@zhin.js/agent`：`AgentTurnConfiguration` 新增可选 `availableAgents`（回合内可见的专家 Agent 名称）；`TimerScheduler` 新增 `setJobAgent()`；`AssistantRuntimeHandle.jobs` 新增可选 `agents()` / `setAgent()`；`ScheduleManager` 新增可选 `agents`；`ScheduleAddInput` 新增可选 `agent`。
  - `set-agent`（CLI / `POST /api/assistant/jobs/set-agent` / `cron:set-agent`）与创建时一样检查任务投递目标账号上的 `endpoint.operate`，没有时 403 `schedule_target_forbidden`（RPC：`data.code` 同名、`data.status: 403`）；`cron:add` 的同一拒绝也带上这个 `data`。
  - Profile 例程（`source: profile`）拒绝 `set-agent`（400 `schedule_agent_profile`，错误里说明去 Profile 文件改）：它们每次启动按 Profile 重新声明，原地修改会被静默还原。Profile 的 cron 例程新增可选 `agent` 字段，同步时写入 `action.agent`。心跳任务的拒绝码为 `schedule_agent_heartbeat`；调度器抛出的这两类拒绝在 HTTP 路由返回 400，不再是 500。`TimerScheduler.setJobAgent()` 对这两类抛 `ScheduleJobAgentError`（带 `code`）。
  - Agent 已从 `ai.agents` 删除的任务：`zhin schedule list` 标出「⚠ Agent 不存在」；`schedule:list` 的持久化任务行带 `agentMissing: true`；`schedule_list` 工具带 `agent_missing: true`。
  - 文档：CLI 与 Agent 文档（中英文）补充 `--agent`、`set-agent`、Profile 例程的 `agent`、聊天里的权限规则（可见性只在创建时检查，撤销权限后任务仍由原 Agent 执行）。
  - `TimerScheduler.stop()` 等正在进行的任务写完状态、投递与历史再返回（以前只等队列，关闭存储或删除数据目录时可能还有写入）。

- 2f49a9c: 读取外部内容后的高危动作确认按类别分级，第一方声明 `readOnly` 的工具结果算受信输出（#1250 第 53 批，[ADR 0067](https://github.com/zhinjs/zhin/blob/main/docs/adr/0067-high-risk-confirm-tiers.md)）。

  - `ai.agent.injectionGuard.confirmHighRisk` 改为按类别分级：执行命令 `shell`、写文件 `fileWrite`（新增类别）、外发 / 跨会话发送 `outbound`、修改配置 `config`、定时任务 / 提醒 `schedule`，每类可设 `off` / `untrusted_content` / `any_content` / `always`。默认 `schedule: untrusted_content`，其余 `any_content`。
  - 工具结果的来源判定：第一方插件（包名为 `zhin.js` 或在 `@zhin.js/` 作用域下）声明了有效 `readOnly: true`（无 `risk: 'dangerous'`、无 `riskCategory`、名称不属于高危类别）、且不是 MCP 工具、没有 `external_content` 标签的工具，其结果算**受信输出**；MCP 工具（即使上游 `readOnlyHint: true`）、网页、文件、记忆、子 Agent 报告、群聊背景仍算外部内容。
  - `@zhin.js/agent/config` 新增类型导出 `InjectionGuardConfig`、`ConfirmHighRiskSetting`、`HighRiskConfirmTiers`、`HighRiskConfirmLevel`（`injectionGuard.confirmHighRisk` 的配置形状）；`ZhinAgentConfig.injectionGuard` 改为 `InjectionGuardConfig`；`ToolCapability` 新增可选 `firstParty`；审批策略指纹 `APPROVAL_POLICY_REVISION` 升为 3（旧规则下被拒的调用会提示「策略已变更」）。级别解析、来源判定等函数属于内部实现，不对外导出。
  - `@zhin.js/runtime`：`host-config-schema.json` 中 `confirmHighRisk` 改为「字符串 | 按类别对象」，字符串新增 `always`，并去掉 `default`（让「没写」与「显式写了 `external_content`」可以区分）。
  - `@zhin.js/cli`：`zhin doctor`「审批渠道」一项按类别描述；所有类别都关闭时报 `warn` 并给出更窄的替代写法，部分关闭时列出关闭的类别，显式写了字符串 `external_content` 时提示迁移方式；默认说明里写明定时任务放宽的范围（只放宽创建，到点运行与预演仍按读过外部内容处理，`schedule_preview` 不放宽）；无法识别的级别（如 `Always`）或未知类别（如 `file_write`）报 `warn`。
  - 定时任务记住创建时的来源（ADR 0067 D2.1）：模型在读过任何内容（含受信输出）的回合里用 `schedule_add` / `schedule_preview` 建的任务带上 `ScheduleJob.provenance`，到点运行与预演一开始就按读过外部内容处理（来源 `scheduled_prompt`）；SQL 存储新增可空列 `provenance_json`（启动时自动给旧表补列），JSON 存储同样保存；没有该字段的旧任务按原行为运行。`schedule_preview` 至少按 `any_content` 确认。`@zhin.js/agent` 新增类型导出 `ScheduleJobProvenance`、`SchedulePreviewOptions`。
  - `confirmHighRisk` 的解析改为幂等：已解析的策略（`file_write` 键）再解析一次不再把 `always` / `off` 改回默认值。
  - 官方插件：`@zhin.js/plugin-60s` 的天气、汇率、金价、油价、摸鱼日历工具补 `readOnly: true`，其中摸鱼日历、油价、金价原样拼接上游自由文本，另加 `external_content`（不算受信输出）；`@zhin.js/plugin-ledger` 的 `ledger_list`、`ledger_summary` 加 `external_content`（分类名、备注是以前回合写入的文本）；`@zhin.js/adapter-qq` 的群信息 / 群成员 / 禁言列表 / 黑名单 / 加群申请 / 会话信息工具与 `@zhin.js/plugin-content-moderation` 的 `moderation_check` 补 `external_content` 标签（返回他人可写的文本，不算受信输出）。

  **兼容性**：原来的字符串写法照旧可用——`external_content` 保持原来的严格程度（映射为所有类别 `any_content`，不享受定时任务的放宽，并同样覆盖新增的写文件类别），`off` 映射为所有类别 `off`，新增的 `always` 映射为所有类别 `always`；无法识别的值按 `any_content` 处理。已有的显式配置都不会被放宽。

  **行为变化**：

  - 默认配置（不写 `confirmHighRisk`）下，「查天气 + 建提醒」不用再确认：只读过第一方只读工具的结果后建定时任务 / 提醒，不确认、也不会因为没有确认渠道或无人值守而被拒。读过网页、MCP 结果、文件内容等外部内容后建提醒仍要确认；执行命令、写文件、外发、改配置在读过任何内容（含受信输出）后仍要确认。
  - 收紧：写文件新增为高危类别，读过任何内容后要确认，无人值守回合中直接拒绝；已有的「读网页后写文件」的无人值守任务会被拒绝，需要恢复原行为可设 `confirmHighRisk: { fileWrite: off }`。
  - 收紧：模型在读过任何内容（网页，或天气这类受信输出）之后新建的定时任务，每次到点运行时写文件、外发、改配置、执行命令都会被拒绝（无人值守，审核 Agent 不能放行），任务记为 `degraded`；需要无人值守写文件 / 外发的任务请在 Console 创建。`schedule_preview` 不享受定时任务的放宽：读过任何内容后预演要确认，预演回合同样带着来源运行。
  - 收紧：`@zhin.js/plugin-60s` 的摸鱼日历、油价、金价与 `@zhin.js/plugin-ledger` 的账目列表 / 汇总算外部内容：读过它们之后建定时任务也要确认（无确认渠道或无人值守时拒绝）。
  - 收紧：工具失败的文本也算来源（ADR 0067 D1 第 5 条）。工具抛出的错误（如 `web_fetch` 的 `HTTP 503: <服务端给的原因短语>`、MCP 服务端的 JSON-RPC 错误消息）、返回的 `{ error }` 或 MCP `isError` 结果会交给模型，以前抛错的路径不记来源；现在不在受信清单（`trustedOutputTools`、`trusted_output` 标签、harness 工具）里的工具失败一律记为外部内容，第一方受信工具的失败也不例外。随后建定时任务要确认，执行命令、写文件、外发、改配置照常确认，无人值守时拒绝。本地策略拒绝（网络白名单、MCP 权限）、回合取消与超时中止不计入。

### Patch Changes

- 7131501: 出站 / 入站媒体下载只连默认端口（#1250 第 48 批，第 46 批安全审查 L3；**行为变化**）。

  - `fetchPublicMediaBytes()`（kernel）与 `fetchOutboundMedia()`（core）默认只接受 https 的 443，以及 `allowHttp` 时 http 的 80（URL 不写端口或写默认端口都算）；其他端口（如 `https://public-host:22/`、`:8443`、`:0`）一律拒绝，重定向的每一跳同样检查，防止借实例对任意公网主机和端口发起 TLS 握手做端口探测。
  - 被拒时沿用 `blocked` / `outbound_media_url_blocked`，附 `reason: 'port'`（`PublicMediaFetchResult` 与 `OutboundMediaFetchError` 新增可选 `reason`，日志行带 `reason=port`）；说明文字和日志只含主机名，不含完整 URL。
  - 新增可选参数 `allowedPorts?: readonly number[]`（`PublicMediaFetchOptions` / `OutboundMediaFetchOptions`）用于注入额外端口；只对首个 URL 的 origin（scheme、host、port 都相同，`allowHttp` 时的 http 同样）生效，重定向到其他 origin 仍只允许默认端口；默认不放开，不提供配置项。
  - `ai.imageStorage.publicBaseUrl`（R2）带非默认端口时，启动时直接报错（`imageStorage.publicBaseUrl must use the default HTTPS port 443`），不再等到发布的图片逐张被拒。
  - 入站识图 `fetchUrlAsBase64()`（agent）与语音转写下载随之生效；语音下载失败日志的 `reason` 为 `blocked:port`。

  **可能出现回退的场景**：公网部署的协议端（OneBot / Satori / Milky 等）在非默认端口上提供语音或文件服务；自建图床使用非默认端口；R2 `publicBaseUrl` 带了端口。这些下载现在会被拒绝。排查：媒体下载日志里出现 `reason=port`（`outbound_media_url_blocked`），或语音下载日志里出现 `blocked:port`。协议端可信来源（为平台自带地址放行端口）的支持会在后续 PR 补上。

- 257d289: 等待中的提问不再吞掉消息（#1250 `interaction-prompt-swallows-messages`，ADR 0061 决定 11 修订）：`select`、多选、数字、列表提问认取消词「取消」「退出」「cancel」「exit」「quit」（中英文通用，提示里写明「回复『取消』退出」；列表回复恰好是一个取消词时按取消处理，多项里的「取消」仍是数据；带校验规则的 `text` 在回答没通过校验时也认取消词），取消后 `ask()` 以 `UserInteractionCancelledError` 结束并回复「已取消」；等待期间被问者发了能匹配到指令的消息或带图片 / 文件 / 语音 / 视频的消息（单独 @ 机器人不算退出：有的平台必须 @ 才投递或把回复当作 @，「@机器人 3」这类无效回答照样重发提问；去掉开头 @ 后能匹配到指令才退出；指令匹配同样检查 `adapter` 限制；已收下的有效回答不会被顶掉），提问结束、回复一次「已退出上一个选择」（每人每分钟最多一次），这条消息按正常流程处理；其余无效回答限频提醒（每次提问最多 2 次、间隔至少 20 秒），不再静默等待。

  提问超时、取消、被打断、被顶替不再记成 `internal_error`（#1250 `interaction-timeout-reported-as-internal-error`）：入站结局新增 `interaction_timeout` 与 `interaction_cancelled`，日志为 INFO，不算故障；指令阶段的结局记下提问方插件，诊断里不算一次指令执行，被新提问顶替时说明「被新提问替代」。Agent 工具审批的提问被取消或打断时按用户拒绝处理；提醒插件把被打断的提问当作已结束。

- Updated dependencies [7131501]
- Updated dependencies [1414572]
- Updated dependencies [257d289]
  - @zhin.js/kernel@1.5.0
  - @zhin.js/core@1.13.0
  - @zhin.js/adapter@1.5.0
  - @zhin.js/ai@1.8.1

## 1.8.0

### Minor Changes

- 49a1136: MCP 工具按聊天角色授权（ADR 0065 P0 + P1）。**行为变更：已经绑给聊天 Agent 的 MCP 服务器，升级后立刻收紧**——不写 `permit` 时，只有上游标注 `readOnlyHint: true` 的工具对所有人开放，其余工具（未标注、标注为写、`readOnlyHint` 与 `destructiveHint` 矛盾）只给全局主人 `owner@global`。迁移说明见 `docs/migrations/mcp-tool-permit.md`。

  - 接入 MCP 服务器时保留上游 `annotations`，转成 `McpToolDescriptor.hints` / `ToolCapability.mcpHints`（只接受布尔值）。标注只决定权限档位，不放宽审批：MCP 工具仍是 `on-risk`，照常走审批、文件策略、网络白名单和硬闸。
  - 配置：`ai.mcpServers[].permit`（`readOnly` / `default` / `tools`，值为 `everyone`、`deny`、一个 permit DSL 字符串或 DSL 数组），`ai.agents.<name>.mcpServers[]` 可写 `{ name, permit }`，与服务器级结果取 AND，只能收窄。`tools` 按上游原始工具名匹配：精确名优先，其次字面字符最多的 `*` 模式，并列时都要满足；非 ASCII 工具名只能被精确名命中。`everyone` / `deny` 放进数组、空数组、未知键、重复的模式、同一 Agent 里重复的服务器、DSL 写错（含已移除的 `master` 等）都会让启动报错。
  - 每轮组装工具池时按本轮发送者的聊天角色过滤：没有权限的 MCP 工具不进工具池，`discover`、`load_tool` 和 `alwaysLoaded` 里都没有。执行前按角色存储里的当前角色再判一次；会话历史里重放的旧调用、回合中被撤销的角色、子 Agent 沿用的父回合能力都会被拒绝，记 `tool_denied`，`policy: 'mcp-permit'`。
  - 定时任务按创建者当前的角色降一档运行，所以全局主人创建的任务默认也用不了「仅主人」的 MCP 工具；需要时在 `permit.tools` 里把该工具放宽到 `trusted`。A2A、zhin 自己的 MCP Server 入口同样只能用只读工具。
  - 恢复旧行为写 `permit: { default: everyone }`（不推荐：普通成员发起的写操作在 `execApprovalMode: auto` 下经自动审核即可执行）。
  - 修复：配置的 MCP 服务器投影给 Agent 的工具名带了一层多余的服务器前缀，调用上游时发送的也是带前缀的名字；现在使用上游报告的原始名。
  - 修复：合并的群聊回合（ADR 0038）此前只收窄 `roles`，聊天角色仍取第一个发言者的，permit（含 MCP 工具档位）因此把 trusted / admin 成员的工具借给了同一合并窗口里的普通成员；现在聊天角色取所有成员共同持有的最低角色，层级取最窄的。
  - 修复：`ai.agents.<name>.mcpServers`（含 Agent 层 `permit`）加入自我变更禁改名单，Agent 不能用 `self_change` 删掉收窄或给绑定加服务器。
  - 修复：跨进程 A2A Mailbox 的远端信件一律按 `user` 运行、不带聊天角色。此前对端声明的 `authority.trust`（如 `trusted`）会变成本地角色，签名正确的远端信件因此能用开放给 `trusted` 的 MCP 工具和插件工具。
  - 修复：读取上游 `annotations` 时只认工具自身的字段，继承来的 `readOnlyHint` 不算标注。
  - `@zhin.js/runtime`：配置 schema 增加上述两处字段，`ai.agents.<name>.mcpServers` 标为安全敏感。

- f5bf768: 插话判断改由一条判断器链负责切换备用模型（ADR 0066 P0，配置与行为不变）。

  - `@zhin.js/agent` 新增 `EngagementJudgeChain`：一次判断是一次操作，链成员（每个只是一个模型，语言模型或决策模型）按顺序尝试，共用整次判断的 15 秒预算；预算用完或调用方取消时立即停止。选型时跳过模型跳过表里的成员（不计失败），全部在跳过期时记 `judge_failed`（`all_unavailable`）。失败按 ADR 0066 D2 的表切换：配额用完、欠费、凭据被拒换下一个并写全局跳过表；超时、网络错误、5xx 只在本次判断内换，2 分钟内至少 2 次不同判断都这样放弃同一模型才全局跳过 5 分钟（超时与网络 / 5xx 分开计数）；回答无效换下一个但不写跳过表；单纯 403、限流、内容拦截、上下文超长不换。每次切换写 `ambient_judge_fallback` 日志并进入 `recentFallbacks`（`purpose: 'ambient'`）。新增 `createEngagementJudgeMember()`（按 Profile 的模型类型构造语言或决策判断器）、`engagementJudgeFailureAction()`、`engagementJudgeKindOf()`；`FallbackEngagementJudge` 标为废弃并改为链的薄包装。
  - 判断结果的 `source` 改为结构化的 `{ kind, profile, model, fallbackFrom? }`（与第 47 批的 `ref` 相同，`ref` 保留到废弃期结束），显示字符串移到 `sourceLabel`；审计 payload 的 `judge*` 键名不变，改从结构化 `source` 填写。整条链失败时，`judge_failed` 的 `failure.attempts`、`ambient_silent` 结局的 `detail` 和审计的 `judgeAttempts` 列出每个成员的失败类别。语言模型成员不再套用途备用层（`resolvePurposeExecution`），只有判断器链这一层切换；链里每个成员各算一次调用（`[ai.usage] judge`）。
  - `@zhin.js/ai`：`ProviderErrorKind` 新增 `invalid_response`（驱动以 `code: 'invalid-response'` 报告无法使用的回答），`ModelFallbackReason` 新增 `invalid_response`，`ModelFallbackEvent.purpose` 可为 `ambient`；新增导出 `classifyFallbackFailure()`。
  - `@zhin.js/service-typesafe`：请求失败保留 HTTP 状态、`Retry-After` 与响应体的错误码（不含正文），连接失败标为网络错误，SDK 超时标为 `timeout`，`classifyProviderError` 可以据此分类。

- 5cfb5d7: 「旁听」用途和决策「旁听参与判断」合成一项「插话判断」`purposes.ambient`，旧配置自动迁移（ADR 0066 P1，行为变更）。

  - 新的配置形状 `purposes.ambient: { profile, fallbacks, compare, minConfidence, mode, timeoutMs }`：主判断与备用链可以混排语言模型和决策模型（判断器按 Profile 的模型类型分派），`compare` 是只记录的对照模型，`minConfidence`（默认 0.7）是唯一的门槛，`mode: shadow` 是唯一的「只记录不插话」，`timeoutMs` 是决策模型成员的单次超时。字符串写法 `ambient: <profile>` 仍然有效；写入总是整项替换，`null` 清除。没写 `profile` 时继承部署聊天的主项和备用链（此时不能单独写 `fallbacks`）。只允许这 6 个键，Profile 必须存在、属于 Host、不能是图像模型，链内不能重复、不能包含 `profile`，`compare` 不能在链内；错误带路径（如 `purposes.ambient.fallbacks[1]`）。
  - **行为变化**：旧配置在 Host 加载模型配置时自动迁移一次（一个 CAS 事务，同时写迁移记录，`before` 保存迁移前完整的 `purposes`）。原来决策「启用」并单独配置了旁听语言模型的部署，该语言模型成为第一个备用：决策模型超时、网络错误、5xx、回答无效或配额用完时由它接手插话（以前直接不插话）。门槛取原来两道门槛中较大的值，插话不会因此变多。决策「仅评估」迁移为对照模型，主判断与插话行为不变；决策「关闭」的 Profile 不迁移。`zhin.config.yml` 的 `ai.trigger.ambient.minConfidence` / `mode` 在迁移时读入一次，之后不再生效（每个 generation 启动时警告一次）。迁移失败时不写数据库，本次按同一张表在内存里转换后运行，记 `ambient_judge_migration_failed`，下次加载重试。
  - **降级前必须先回退**：新增 `zhin ai purposes revert ambient-judge`（只能经本机网关执行），在 `purposes.ambient` 自迁移后没被修改时恢复迁移前的旧写法；旧版本读不了含 `purposes.ambient` 的模型配置。回退后当前版本仍按旧写法换算运行，不会自动再迁移。
  - `DecisionEngagementJudge` 不再设内部门槛（`DecisionEngagementJudgeOptions` 新增 `timeoutMs` / `mode`，`policy` 废弃），`AmbientEngagement` 只按 `purposes.ambient` 的门槛判一次，语言模型与决策模型都是 `engage && confidence ≥ minConfidence` 才插话。`DecisionPurpose` / `DECISION_TASKS` 去掉 `ambient`（决策用途剩五类）。
  - 废弃期（本 minor 和下一个 minor）：导入 `purposes.decisions.ambient` 时按迁移表合并进 `purposes.ambient`，导入结果带警告（`warnings`，路径 `purposes.decisions.ambient`）；导出只写新形状。自我变更和聊天里的 `config set` 不能再写 `ai.trigger.ambient.minConfidence` / `mode`。
  - 新增 `GET {base}/agent/inference/ambient-judge`（生效的插话判断与迁移记录，Host 管理员）、`POST …/ambient-judge/migration/noticed`、`POST …/cli/purposes/revert-ambient-judge`（本机 CLI）。
  - `@zhin.js/runtime`：配置 schema 中两键的描述改为「已废弃」。

- 3b88aa7: 插话判断的「仅评估」改为可选的对照模型，一致率按「过门槛后会不会开口」比较（ADR 0066 P2）。

  - `purposes.ambient.compare` 选一个 Profile（语言或决策模型都可以）：主判断（经过备用链）照常决定；对照模型对同一份输入同时判一次，只记录、从不影响结果。两边都等结束再返回，共用同一个 15 秒预算；对照模型没有备用链，失败只记 `compare_failed`，不写全局跳过表。`mode: shadow` 时对照模型照常运行。开了对照模型，每次判断的模型调用翻倍（只发生在通过冷却、限次和判断间隔之后的判断上）。
  - `@zhin.js/agent` 新增 `CompareEngagementJudge`（取代废弃的 `ShadowEngagementJudge`）与类型 `EngagementCompareResult` / `EngagementCompareReport` / `CompareEngagementJudgeOptions`，判断结果新增 `compare`；`AgentAssistantStatusPort` 新增可选 `recordAmbientCompare()`，`recordAmbientShadow()` 废弃期内保留。日志 `ambient_compare`；`ambient_decision` 审计 payload 新增 `compare`（`engage` / `quiet` / `failed`）以及 `compareJudge` / `compareJudgeKind` / `compareJudgeProfile` / `compareJudgeModel` / `compareJudgeMs` / `compareJudgeUsage` / `compareJudgeError`，不含理由原文。
  - `zhin.js`：Console 群聊插话状态（`plugin.root.ambient` RPC）新增 `compare`：最近 24 小时一致次数、「主判断插话、对照不插」次数、「主判断不插、对照插话」次数、对照失败次数，并按给出结论的链成员（主项 / 第 N 个备用）分别列出；只有两边都给出结果才计入一致率。`decisionShadow` 废弃期内保留，填同样的数据（加上旧的陪跑记录），数值口径与旧版不同。新增导出类型 `AmbientCompareStatus` / `AmbientCompareCounts`。

- c86e2f6: Console 只显示真正生效的插话判断，`zhin doctor` 检查插话判断迁移与废弃配置项（ADR 0066 P3）。

  - 管理视图（`GET {base}/agent/inference`）的 `purposeEffects` 新增 `ambient`：实际使用的判断器链（成员与模型类型，跟随聊天时标 `inheritedFrom: 'chat'`）、对照模型，以及插话根本不运行时的忽略原因 `ambient-not-configured`（配置里没有 `ai.trigger.ambient`）/ `no-conversations`（没有任何群开启、也没有功能开关打开）；新增 `decisions.<task>`，关闭的决策用途标 `mode-off`。`PurposeIgnoredReason` 新增这三个值（新增类型 `AgentPurposeIgnoredReason`、`AmbientDeploymentView`，导出 `ambientPurposeEffects()`）。
  - Console 群聊插话状态的 `judges` 改为实际判断器链（决策模型判断时不再显示从未被调用的语言模型），新增结构化的 `judgeChain`（成员、类型、角色、是否在跳过期）和 `minConfidence`；`mode` 读 `purposes.ambient.mode`。`HostInference.ambientModels()` 返回 `AmbientJudgeStatusView`，新增导出 `ambientJudgeStatusView()`。
  - `zhin doctor`：迁移结果只提示一次（`--verbose` 可再看），迁移失败报错并给出要修正的位置，`ai.trigger.ambient.minConfidence` / `mode` 给出警告并可用 `--fix` 删除（其他键和注释保留），`purposes.ambient.minConfidence < 0.5` 时提示它对决策模型不起作用。
  - 文档：`docs/ai/index.md` 的「群聊旁听」改为「插话」，「判断模型」改写为「插话判断」（含切换表和置信度说明）；结构化决策改为五个用途；`provider-upgrade` 补废弃键；新增迁移说明 `docs/migrations/ambient-judge.md`（含英文版）。

- 8c0d262: 插话判断（ADR 0066）审查修复：yml 的「只观察」和门槛在所有路径上都不丢，回退能完整还原。

  **BREAKING（已批准的 minor）与迁移路径**

  - `EngagementJudgment.source` 由字符串改为对象 `{ kind, profile, model, fallbackFrom? }`：读显示文字改用 `sourceLabel`，判断模型类型改用 `source.kind`，按模型分组改用 `source.profile` / `source.model`。无法在不破坏类型的前提下同时保留字符串；`ref`（与 `source` 同一对象）和字符串 `fallbackFrom` 保留到废弃期结束。`EngagementJudgeCall` / `EngagementJudgeFailure` 的字符串 `source` 不变。
  - `DecisionPurpose`、`InferencePurpose` 的 `decision:ambient`、`DecisionTask` / `DECISION_TASKS` 去掉 `ambient`：改用 `PurposePolicy.ambient`（插话判断）。存储里的旧 `decisions.ambient` 仍会读取并自动迁移。
  - 联合类型新增成员：`PurposeIgnoredReason`（`ambient-not-configured` / `no-conversations` / `mode-off`）、`ProviderErrorKind` 与 `ModelFallbackReason`（`invalid_response`）。对这些类型做穷举（`switch`、`Record<…>`）的代码需要补上分支。

  **行为变更**

  - 判断结果没有 `gate`（自定义判断器）时，`AmbientEngagement` 回退读已废弃的 `ai.trigger.ambient.minConfidence` / `mode`，不会比以前多插话；直接构造 `DecisionEngagementJudge({ policy: { minConfidence } })` 时仍在判断器内按它把关（判断器链不设，门槛只判一次）。
  - 迁移完成后再写 `ai.trigger.ambient.mode` / `minConfidence`（旧版 Console、手工编辑、导入的配置）会在下次加载时转到 `purposes.ambient`，记 info 日志 `ambient_trigger_write_converted`，不再静默失效。
  - 空库首次启动从 `ai.plan.yml` seed 的 `purposes.ambient`，以及旧键仍生效时（未迁移、迁移失败、已回退）写入的 `purposes.ambient`，都会补上 yml 里仍生效的 `mode` / `minConfidence`；管理视图、`purposeEffects`、导出和插话状态按实际生效的值显示。
  - 废弃期内的旧写法：`purposes.decisions.ambient` 的 `off` / `null` 撤销决策模型与原「仅评估」的对照模型，恢复原来的旁听语言模型；字符串写法 `purposes.ambient: <profile>` 只替换语言模型，保留 `mode`、`compare`、`minConfidence`。
  - `zhin doctor`：只有运行中实例的迁移记录为 `migrated`、键已被迁移读入且值未再改动时，才提示 `ai.trigger.ambient.minConfidence` / `mode` 不再生效并允许 `--fix` 删除；实例未运行、未迁移、迁移失败或已回退时只给警告，拒绝 `--fix`。启动日志 `ambient_trigger_keys_retired` 只在已迁移时出现。
  - `zhin ai purposes revert ambient-judge`：先经配置写锁把迁移读入、之后被删掉的 yml 旧键写回，写不回则不回退并给出手工步骤，回退被拒时撤销写回；旧形状已不成立时拒绝并给出路径。
  - 迁移记录的 `noticedAt` 用 CAS 写入，与回退并发时回退优先。`FallbackEngagementJudge`（已废弃）恢复原有退避：成功清除退避，取消不记退避。插话状态的判断器链读请求所在 generation 的模型配置。判断器链和对照模型使用合并了 generation 停止信号的 `signal`。
  - `@zhin.js/service-typesafe`：失败请求只保留 `Retry-After` 响应头。`@zhin.js/scaffold-wizard`：决策用途检查改为五个，`purposes.decisions.ambient` 提示已废弃。
  - 复审修复：yml 里写回迁移时读入的原值（或已处理过的值）不再被当成新写入，`purposes.ambient` 不变、回退仍可成功；回退命令执行期间在迁移记录上标记 `revertPending`（CAS 写入，10 分钟后失效），期间暂停转换，结束时无论成败都清除。迁移前 seed 过的 `purposes.ambient` 回退时按 D5 表反向换成旧字段，门槛和模式写入 yml；旧版本表达不了的部分逐条列出，此时 CLI 不再提示「可以降级」并以非零状态退出。`zhin doctor` 比较 yml 值时两边都按运行时规则规范化，并按 `triggerSeen` 判断是否已处理。新增路由 `POST {base}/agent/inference/cli/purposes/revert-ambient-judge/pending`（本机 CLI）。
  - 第三次复审修复：旧 Console 先关「只观察」再打开时，写回的原值按新写入转换，最终仍是 shadow（只有存储的插话判断该键仍是迁移写下的值时，原值才不算新写入；`zhin doctor` 同样判断）。回退顺序改为：取得 `revertPending` 标记 → 干跑（`dryRun`，返回 yml 应有的值和旧版本表达不了的项）→ 写 yml（与现有值不同时以当前实际运行的值为准覆盖，并列出覆盖项；写不了就不回退）→ 提交回退（被拒时撤销 yml 写入）→ 清除标记；取不到标记时中止。回退相关路由写审计。
  - 第四次复审修复：回退时如果配置文件里有实例还没转换的旧键写入，拒绝回退（`pending-trigger-writes`，列出键），提示先重新加载实例，避免用迁移原值覆盖新写入；CLI 写入前再按同一规则检查一次文件。已从 yml 转换的门槛 / 模式不阻止回退，回退后按当前值运行。回退请求没有回应时先重读迁移状态再决定保留还是撤销 yml，读不到时不动 yml 并给出手工步骤；提交返回的 yml 与干跑不一致时撤销；撤销失败时列出原值和恢复步骤。回退进行中 `zhin doctor --fix` 不删旧键。
  - 第五次复审修复：回退已提交但返回的 yml 与干跑不一致时，按最终结果更新配置文件并报告已回退（写不进去时列出手工修改的值）；提交无回应时两次查询都仍是已迁移才撤销 yml；因配置文件里缺少已生效的门槛 / 模式而拒绝回退时，提示把哪一项改回什么值后就可以回退。

- 4bd5b64: 入站消息里的本机路径不再绕过文件策略被 Agent 读盘（#1250 第 44 批）。

  - Agent 只读一种入站本机路径（`MediaRef kind: 'path'`，包括平台引用物化出的路径）：产出这条消息的端点在 specification 里声明了入站媒体目录（新增可选钩子 `inboundMedia: { roots() }`，`@zhin.js/adapter` 导出 `EndpointInboundMediaPort`、`endpointInboundMediaOf`、`endpointInboundMediaRoots`，`AdapterIndex.inboundMediaRoots`，`ImRuntime.inboundMediaRoots`），且解析符号链接和 `..` 后的真实路径落在目录内；即使在目录内，仍要通过文件策略的敏感检查（`.zhin/`、`.env*`、密钥、数据库等）。可信入口把目录写进 `TurnInput.inboundMediaRoots`。
  - 其他路径一律不读：记录 `op=inbound_media_rejected`（`reason=inbound_path_not_owned` 或 `inbound_path_sensitive`，不含路径），模型看到「这条消息里有个文件无法读取」的占位，回合照常进行。
  - weixin-ilink 声明 `<dataDir>/<端点>/media/inbound`，email 在开启附件时声明 `attachments.downloadPath`，它们原有的入站媒体照常可读。其他适配器入站不产出本机路径。
  - core 的旧字段兼容不再把 `data.file` 以 `/`、`./`、`~/` 开头的值猜成本机路径，统一视为平台不透明引用（`kind: 'file'`）；`data.path`、`data.file_path` 和 `media.kind: 'path'` 不变。可信插件代码若用 `data.file` 写本地文件，请改用 `data.path`。icqq 的 CQ 文本解析（如频道消息里用户写的 `[image:/root/.env]`）同样不再产出本机路径。Sandbox 端点继续拒绝形如本机路径的 `data.file`（`sandbox_media_rejected`），它本身不会签发这种标识。
  - `normalizeMediaRefsToPayloads()`、`publishOutboundElements()`、`authorizeOutboundMediaPath()` 不传 authority 时改为不读任何本地路径（与 `NO_MEDIA_AUTHORITY` 相同，URL 抓取规则不变）；仓内调用点都已显式传入。第三方插件直接调用它们读工作区文件时，需要显式传 `{ filesystem: { workspaceRoot }, fileRole }`。
  - 行为变化：NapCat / OneBot 实现给出的 `data.path`（实现端本机路径）不再被读取，没有 URL 的语音、文件在 Agent 里显示为无法读取的占位。

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

- 14d752e: 群聊插话判断看得出用的是哪个模型、有没有切到备用、用了多少 token（#1250 第 47 批 `ambient-llm-judge-invisible`）。

  - 聊天模型做插话判断时，判断结果带 `source: 'language:<服务显示名>/<模型>'`（服务没有可读名称时退回驱动名或只写模型，不显示 `services:<uuid>` 这类内部 id）；另带 `ref: { kind, profile, model, fallbackFrom? }`，按 Profile id 标识模型，统计按它分组（ADR 0066 P0 结构化 `source` 的形状）；切到备用模型时 `source` 是实际作答的备用模型，并带 `fallbackFrom`（原来配置的模型）。备用信息来自用途备用层的切换观察器（`ModelFallbackLog`），切换同时记 `model_fallback` / `fallback_skipped` 日志。`ambient_engagement` 日志与 `ambient_decision` 决策审计照常带 `judge`，并新增 `fallbackFrom`；审计 payload 另带 `judgeFallbackFrom`、`judgeKind` / `judgeProfile` / `judgeModel` / `judgeFallbackFromProfile` / `judgeFallbackFromModel`、`judgeMs`、`judgeUsage`（只有模型、类别和用量，不含判断理由原文；对照判断留给 ADR 0066 P2 的 `compare` 前缀）。
  - 每次插话判断调用（聊天模型和决策模型，成功或失败）写一行 `[ai.usage] judge`，`scene: ambient`，带模型、`fallback_from`、input / output / cache token 与耗时；决策模型没有回传用量时只写次数和耗时。`calls` 是判断次数，不是模型请求次数：请求阶段切到备用时，`ms` 是两次请求的合计。
  - 判断失败（`judge_failed`）时，`ambient_engagement` 日志、`ambient_decision` 审计与 `ambient_silent` 结局写明是哪个模型、什么错误类别（如 `timeout`、`aborted`、`auth`、`safety_block`、`length`、`invalid_response`），不写原始错误全文；被调用方的超时或取消中止时，聊天模型和决策模型都只记一次，类别一致。
  - Console 群聊插话状态（`plugin.root.ambient`）新增 `judgeDaily`：最近 7 天每天的判断调用次数、失败与备用次数、按模型类型的次数、平均耗时和 token 合计（进程内存，重启后当天重新计；写入和读取时都去掉 7 天以前的数据），以及 `judgeTimeZone`。

### Patch Changes

- 9ce43fe: 出站段策略按会话类型生效，GitHub 评论保留 Markdown 格式（ADR 0064 P0）。

  - F1：适配器画像里按会话类型（`private` / `group` / `channel`，有 `threadId` 时再加 `thread`）声明的 `messaging.segments` 现在会生效：类型段写了 `segments` 就整段替换 `default` 的那份。之前出站投影只读 `default`。`resolveOutboundHtmlPolicy`、`resolveOutboundMediaPolicy`、`resolveOutboundInteractivePolicy`、`resolveOutboundMarkdownPolicy`、`resolveOutboundSupportedSegments` 新增可选参数 `conversation`；`resolveAiOutboundSegments` 的第三个参数也可以直接传会话。不传会话时行为不变。`projectOutboundPayload`、指令菜单翻页和 Agent 的回复段解析都按当前会话解析。
  - 受影响的官方适配器只有 QQ 官方：频道会话不再接受图文卡片（`card` / `share`），模型在频道里也看不到这两种段；手写的图文卡片在发送前就以 `unsupported_operation` 拒绝。私聊、群聊和其他适配器不变。
  - F2：GitHub 适配器声明 `markdown: 'native'`。`markdown` 段在 Issue / PR 评论里原样发送并保留格式，不再先被转成纯文本；它作为单独的块写进评论，和相邻文字之间空一行。

- 5889197: `pnpm eval:agent` 的 Vitest 配置改为继承根配置的 `exclude`，并只去掉把 `packages/im/agent/evals/**` 挡在 PR 门禁之外的那一条，不再手写一份排除列表。
- 000bec6: `zhin packages status` 读取运行中实例的当前 generation，不再一律报「待重启」；trace 的 `tool_result` 记模型实际拿到的大小（#1250 第 39 批）。

  - `plugin-status-always-pending-restart`：CLI 不带 `--live` 时只检查本地文件，没有运行中实例的 snapshot，`published` 永远是 `false`、`restartRequired` 永远是 `true`，于是整套服务刚重启完所有插件也显示 `pending-restart`。现在 `zhin packages status` / `verification-plan` / `apply` / `verify` 省略 `--live` 时经本项目网关的本地套接字转给受监管的实例（与 Console 相同的 `plugin:*` RPC），由持有当前 snapshot 的实例计算状态与 generation；`apply` / `verify` 的 `--live` 因此变为可选，没有连上实例时直接拒绝且不执行任何操作。
  - 拿不到 snapshot 时（网关未运行、实例没有应答、实例尚未上报 generation），声明且启用的插件 `status` 为新的 `unknown`，`restartRequired: false`，并在新增的可选字段 `statusReason`（`PluginManagementState`，`@zhin.js/host-http`）说明原因（「没有连上运行中的实例……」「实例尚未上报 generation……」，CLI 离线时再附上网关未运行等具体原因），不再说 `pending-restart`。`install` / `declare` / 启用停用与 `apply` 判断「这次改动是否需要重启」时，对 `unknown` 仍按需要启动处理，行为不变。
  - `verification-plan-empty-unexplained`（同一原因）：经网关读取时计划来自运行中的实例，输出标明「经本项目网关读取运行中的实例」，给出的 `zhin packages verify` 命令不再需要 `--live`；离线时额外说明没有连上实例的原因。
  - `trace-tool-result-size-pre-strip`：trace 中工具调用的 `result_size` 与时间线 `tool_result` 改为模型实际收到的字符数（拆出媒体、省略内嵌二进制、追加提示之后），与工具原始输出大小不同时另记 `raw_result_size`（时间线写成 `… 240 chars (raw 11559 chars)`，`formatTurnTrace` 写成「240 字符（工具原始输出 11559 字符）」）。

- cccf20f: 网络错误和 5xx 在同模型重试用完后换备用模型；模型失败的定时任务记为失败并自动重试，接收人收到能看懂的说明（#1250 第 40 批）。

  - `fallback-skips-network-and-5xx`：用途备用层原先规定网络错误和 5xx 永远不切换，主模型（中转站账号）临时连不上时三次请求都打在它上面。现在 `provider-resilience` 通过新增的可选 `StreamOptions.willRetry` 告诉下层「这次失败还会不会在同一模型上重试」；网络错误和 5xx 在同模型重试用完（原先记 `provider_give_up` 的那一次）时换到下一个备用模型，备用模型用它自己的重试策略，也失败就再换下一个。切换只在本次操作内生效；2 分钟内至少 2 个不同操作都这样放弃同一模型，才全局跳过 5 分钟（与超时分开计数，`ModelFallbackReason` 新增 `network` / `server`）。没有切换的失败经 `FallbackCompletionOptions.onFallbackSkipped` 记入日志 `fallback_skipped` 与回合 trace（`model_fallback_skips`，时间线 `fallback_skipped`），原因为 `no_fallbacks`、`not_switching`、`exhausted`、`streamed` 或 `retry_forbidden`；切换仍记 `model_fallback`（含原因与换到的模型）。
  - `schedule-failed-run-marked-ok`：回合因模型请求失败结束时，`turn_end` 新增可选的 `modelFailure`（错误类型、原文、账号显示名），回合 trace 结束状态记为 `failed`（`model_error:<类型>`）。定时任务把这样的运行记为失败：`lastStatus: 'error'`，`lastError` 写明错误类型与 `zhin trace <回合>`，失败文案不再当作任务结果发出。网络错误、5xx、超时、无响应时由调度器约 5 分钟、10 分钟后各重试一次（不占执行队列，只在没有已生效或结果不明的工具操作时重试；暂停、删除或下次到点会取消），执行队列不再对模型失败立即重跑。
  - `empty-reply-fallback-misleading`：定时任务的接收人不再收到「连接模型服务失败，请检查网络后再试」，而是在重试全部失败（或这类错误不重试）后收到「『工作日天气早报』这次没生成：模型服务（<账号名>）暂时连不上，已自动重试 2 次，不再重试。排查：zhin trace <回合>」；开启 `notifyOnFailure` 的任务每次失败都收到，未重试完时写「N 分钟后会自动重试」。中英文两版，普通聊天的提示不变。

- a8377d4: 已连接却没有任何 Agent 绑定的 MCP 服务器会被明确提示（zhinjs/zhin#1250 第 41 批 `mcp-connected-but-unbound`）：

  - 原因：每一轮的 MCP 工具只取当前 Agent 在 `ai.agents.<name>.mcpServers` 里点名的服务器，`ai.mcpServers` 只负责连接。项目配了 `ai.mcpServers` 的 GitHub MCP、`zhin status` 显示「已连接，49 个工具」，但 `ai.agents.zhin: {}` 没写 `mcpServers`，Agent 一个 GitHub 工具都拿不到，只能默默改走网页搜索；文档和配置说明却写成「连接成功后进入工具池」。
  - 文档与配置说明：中英文 `ai/index`、`configuration/index`、`ai/agent` 写清「`ai.mcpServers` 只负责连接，在 `ai.agents.<name>.mcpServers` 里绑定才能用」，并给出连接 + 绑定的完整示例；`ai.mcpServers` 与 `ai.agents.<key>.mcpServers` 的配置说明（Host 配置 Schema 与 `AgentStartupConfig` / `AgentBindingConfig` 注释）同步改写，`docs/configuration/generated.md` 由 `pnpm docs:config` 重新生成。
  - `GET /introspection/mcp` 的每一行新增 `boundAgents`（`ConsoleMcpServerRow.boundAgents`，绑定该服务器的 Agent；运行中的 Agent 优先，没有时读配置文件；绑定项写成服务器名或 `{ name, … }` 对象都算绑定，ADR 0065 的对象写法落地后不会误报未绑定）。
  - Console「需要你处理」新增 `mcp.unbound`（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`）：已连接但没有任何 Agent 绑定的服务器列为「MCP 服务 github 已连接但没有 Agent 能用」，说明在 `ai.agents.<name>.mcpServers` 里绑定（例如 `ai.agents.zhin.mcpServers: [github]`）；实例运行时 `zhin doctor` 经同一个列表列出它。
  - `zhin status` 的 MCP 行对这种服务器标 `!` 并注明「已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定」，已绑定的服务器列出绑定它的 Agent。
  - Agent 就绪日志的 `mcp:` 段只列这个 Agent 真正绑定的服务器，没绑定的另起一段写成 `未绑定: github(待连接)`（如 `ready | zhin | mcp: - | 未绑定: github(待连接) | …`），不再像是已经绑给了它；调试日志相应写成 `mcp configured:`。
  - MCP 工具本身的权限过滤不变。

- 4760a96: Sandbox 支持上传本地文件（ADR 0064 增补 I1，#1250 第 43 批）：图片、语音、任意文件可以拖放、粘贴或用按钮选择，上传后以签名地址发进会话，入站段与其他平台一致（`media.kind: 'url'`）。

  - **存储**：文件存于项目的 `.zhin/sandbox/media/<端点目录键>/`，只按 128 位随机 id 命名，上传者给的文件名只进元数据，读取只认 id，不接受任何路径。元数据记录上传时的会话（端点 + 会话）、上传者、按内容嗅探的 MIME、大小与过期时间。重启后历史里的文件在有效期内仍可用。
  - **上传**：`POST /api/sandbox/media/<endpoint>?type=&id=`，原始字节，必须带 `Content-Length`，需要 `endpoint.operate`。按类型限制大小（默认图片 10 MiB、语音 20 MiB、视频与其他文件 32 MiB，单文件硬顶 64 MiB，即网关的请求体上限，要更大需要同时调大网关），配额按上传者计（默认 200 MiB）并另有端点总配额（默认 500 MiB），超额直接拒绝，不删别人的文件；另限对象个数（每个上传者 1000 个、每个端点 10000 个）。
  - **签名地址**：`/pub/sandbox-media/<dir>/<id>?exp=&sig=`，HMAC-SHA256、常量时间比较；密钥在 `.zhin/sandbox/media/secret`（0600），保留 current / previous 两把，签发只用 current。有效期默认 24 小时，最长 168 小时；删除文件立即作废它的所有链接，所有者可轮换密钥或「全部作废」。
  - **下载**：Console 页面经 `GET /api/sandbox/media/<endpoint>/<id>`（`endpoint.view`，且必须是文件所属的会话）显示文件；`/pub/sandbox-media` 默认关闭（`media.publicDownload: false`），开启后仍需有效、未过期的签名，来源地址从不作为授权依据。SVG、HTML 等非图片 / 音视频文件一律以附件下载，带 `X-Content-Type-Options: nosniff`。
  - **会话绑定**：带着其他会话或他人上传的托管地址发消息会被拒绝（错误帧 `sandbox_media_rejected`）并记日志；地址只认签发时的原样（`?exp=&sig=`、规范的签名拼写）。指向本机路径的入站媒体（`media.kind: 'path'` 或 `path` / `file_path` 等旧字段）同样整条拒绝。
  - `@zhin.js/console-protocol`：`CONSOLE_HTTP_PERMISSIONS` 登记 `POST` / `DELETE /sandbox/media/*` 为 `endpoint.operate`、`GET /sandbox/media/*` 为 `endpoint.view`（只在已有常量里加条目）。
  - `@zhin.js/agent`：文件策略与 Shell 命令检查显式拒绝 `.zhin/sandbox/`（托管文件与签名密钥；`.zhin/` 原本已整体拒绝）；敏感目录名改为不区分大小写比较（macOS / Windows 上 `.ZHIN/…` 是同一目录）。
  - 本阶段插件与 Agent 还不能在进程内读取上传的文件，要等 I2（`LocalMediaSource`）；在此之前插件按网络地址下载时仍受它自己的域名白名单约束，Agent 暂时看不到上传的图片。

- 14bf59c: 语音转写和内容审核不再替远端用户请求内网地址（#1250 第 45 批 `speech-url-ssrf`）。

  - Speech Host 下载语音（入站语音段的地址、`metadata.audio_url`、Sandbox 手写的 `[audio:URL]`）和 `voice_stt` 的 `audio_url` 改走新增的 `fetchPublicMediaBytes()`（`@zhin.js/agent/security`）：只下载公网 HTTPS 地址；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝，连接时只连已校验的地址（防 DNS 重绑定）；重定向逐跳重新校验；单个语音最大 25 MB、整次下载 30 秒。原先任意 `http(s)` 地址都会被直接 `fetch`。
  - 被拒的地址不发出任何请求，这一轮照常继续：`transcribeUrl` 返回 `{ status: 'refused', code: 'speech_url_blocked' }`，模型看到「[语音地址不可用，未转写（speech_url_blocked）]」，`voice_stt` 返回同样原因的 `{ error }`。日志记 `op: speech_url_blocked`（下载失败为 `speech_url_fetch_failed`）和主机名，不记完整地址。转写器抛错时回合也不再中断。没有内网主机白名单配置。
  - 内容审核 HTTP 源在 `forceUpload` 时下载聊天图片，改为只连公网地址（私网、回环、链路本地、元数据地址及解析到这些地址的域名、重定向的每一跳都拒绝），单张最大 20 MB、超时用该源的 `timeoutMs`；被拒时按该源的 `onError` 处理。
  - 共用的私网地址判定（`isBlockedIpAddress`，`TurnNetworkClient`、`fetchPublicMediaBytes` 和入站媒体下载都用它）把 IPv6 改为白名单：只认全局单播 `2000::/3`，并排除 Teredo、6to4、文档和基准测试段；NAT64（`64:ff9b::/96`、`64:ff9b:1::/48`）、IPv4 兼容地址 `::/96`、站点本地 `fec0::/10`、丢弃段 `100::/64` 这类能映射到内网 IPv4 的地址此前会被放行，现在一律拒绝。IPv4 另外拒绝 Azure WireServer `168.63.129.16`、6to4 中继段和文档段。
  - 内容审核、RSS、短链接、链接海报共用的 `public-fetch` 以前校验时解析一次域名，`fetch` 连接时再解析一次，DNS 重绑定可以在两次之间换成内网地址；现在连接直接连校验过的那个地址（TLS 的 SNI 与 `Host` 仍是原主机名，不经环境代理），压缩的响应在本机解压后再按上限计数；重定向到其他源时不再带上 `Authorization` / `Cookie` / `Proxy-Authorization`。
  - 平台自带的语音地址允许 HTTP（所有者决定）：适配器根据平台数据产出的语音段（`media.value`、`data.url` / `src` / `file`、`metadata.audio_url`，例如 QQ 的语音 CDN 链接）也可以是公网 `http`，地址校验、只连已校验的 IP、逐跳重定向校验、大小和超时限制都不变，且从 https 重定向到 http 一律拒绝。消息里手写的 `[audio:URL]`、`voice_stt` 的 `audio_url`，以及声明 `runtime.sandbox` 的端点（Sandbox 的客户端自己拼语音段）或读不到能力画像的端点上的语音段，都按用户提供的地址处理，仍只认 https。`fetchPublicMediaBytes()` 新增选项 `allowHttp`（默认关闭），`InboundAudioUrlTranscriber` 新增可选第二个参数 `{ origin: 'platform' | 'user' }`（新增导出类型 `InboundAudioUrlOrigin`），`preprocessInboundTurn()` 新增可选第 4 个参数 `{ platformSegments }`。

- b944f80: 修复 nightly 真模型评测找不到 `nightly.run.ts`：nightly 的 Vitest 配置继承了根配置里用于把 `packages/im/agent/evals/**` 挡在 PR 门禁之外的 `exclude`，而 Vitest 里 exclude 优先于 include。nightly 配置现在去掉这一条，其余排除项保持不变。
- Updated dependencies [9ce43fe]
- Updated dependencies [661cc7c]
- Updated dependencies [49a1136]
- Updated dependencies [f5bf768]
- Updated dependencies [5cfb5d7]
- Updated dependencies [8c0d262]
- Updated dependencies [c2cc4ba]
- Updated dependencies [4ff83f3]
- Updated dependencies [1dc5324]
- Updated dependencies [cccf20f]
- Updated dependencies [5027ab1]
- Updated dependencies [4bd5b64]
- Updated dependencies [2534b1d]
  - @zhin.js/core@1.12.0
  - @zhin.js/adapter@1.4.0
  - @zhin.js/mcp-feature@1.2.0
  - @zhin.js/ai@1.8.0
  - @zhin.js/plugin-runtime@1.4.1
  - @zhin.js/feature-kit@1.1.20
  - @zhin.js/harness@1.1.1
  - @zhin.js/kernel@1.4.0
  - @zhin.js/agent-feature@1.1.21
  - @zhin.js/permission@1.2.4
  - @zhin.js/prompt-section@1.1.20
  - @zhin.js/skill@1.1.21
  - @zhin.js/tool@1.1.24

## 1.7.0

### Minor Changes

- a460a46: 委派相关修复（#1250 第 21 批）：
  - `agent-purpose-binding-ignored`（根因）：消息被路由给专家 Agent（`@planner`、Endpoint 首选 Agent、平台 Agent）时，主回合只按绑定（`zhin` → 聊天）取模型，`purposes.agents.<key>` 没被查；它这次协作里的汇总回合也一样，于是用上了 `purposes.adapters.<adapter>.chat`。现在主回合按专家的 `agent:<key>` 用途选模型（`ModelTurnAcquireInput` 新增可选 `agent`，新增 `specialistModelKey()`），汇总回合沿用；没有生效的键时沿用绑定的用途。回合 trace 也记 `model_selection`，并新增 `source_key` / `agent` 字段（`traceModelSelection()`），能看出模型是哪一层选的。
  - 同条的其他修改：给子 Agent 显式绑定的模型优先于适配器 / Endpoint / 场景的聊天覆盖。项目自己的 `agents/<name>/` 与同名 `ai.agents.<name>` 绑定是同一个 Agent，`purposes.agents.<name>` 现在对这个子 Agent 生效（此前被当成「属于绑定」而回退到聊天用途，于是用了 `purposes.adapters.<adapter>.chat`）；插件里同名的子 Agent 仍不拿绑定的键。`purposeKeyEffects()` / `purposeEffects` 对这类键返回 `target: 'binding'` 并在 `agents` 里列出同名的项目子 Agent，`readAgentPurposeTargets()` 把项目子 Agent 标为 `bare`，并改用与运行时相同的绑定名口径（`AgentHostProtocolPort` 新增可选 `listConfiguredBindingNames()`，只算 `ai.agents` 里配置的名字），只靠 `agents/<name>/` 发现的名字不再被误报成 `target: 'binding'`。
  - `trace-subagent-calls-doubled`：子 Agent 与 `actor:zhin` 回合的每次模型调用在 trace 里只记一次（之前子回合 trace 与根 journal 各记一次；请求本身没有重复，`agent_usage_calls` 用量行也只记一次）。
  - `delegate-budget-self-sabotage`：模型在 `ask` / `delegate` / `follow_up` 里设的预算有下限（`modelCalls` 4、`tokens` 32000、`wallMs` 60000，不超过剩余额度的一半），抬高时在工具结果里说明并记日志；对还没出结果的委派对象再 `ask` 会被拒绝（`delegation_in_progress`），提示等结果或用 `follow_up`；子 Agent 提示要求能直接回答就直接回答，按需工具目录里连续 3 次搜不到（`discover` / `load_tool` / `load_skill`）会提示换办法。
- d216b84: CLI 与聊天身份（zhinjs/zhin#1250 第 22 批）：

  - `ai.personalPrincipals`（ADR 0060 P3）：首次导入时因键不是 `user:<id>` 而跳过（`not-a-user`）的条目不再算作已迁移。在首次导入后 30 天内改正键，`adapterId` 与 `subjectId` 相同的条目在下次启动按首次导入处理，不进入「等待 Console 确认」；每个身份只能改正一次，首次导入之后被确认、忽略或导入过的身份不再适用，改键时新加的身份、首次导入之后才出现的无效键仍需确认，持有授予的人仍不会被自动链接，改正导入写审计并重新显示在「需要你处理」里。首次导入之后新增、适配器当时未加载的条目，加载后也改为等待确认（此前会被自动链接；1.4.0 记录里晚于首次导入的这类条目同样）。1.4.0 写下的记录里已在等待确认或已被忽略的条目保持原状。
  - 键无效时，实例警告说明改正后会怎样；网关在实例启动后把建议的键写进网关自己的日志（前台运行时的终端、后台运行时的 `.zhin/logs/gateway.log`；不写进 Console 可读的实例日志，实例日志只提示运行 `zhin console user list`）：键正好是某个用户名时给出该用户的 `user:<id>`，只有一个所有者时给出「当前唯一的所有者是 …，可改为 `user:<id>`」。不接受用户名作键：用户删除后同名可被别人重新注册。`@zhin.js/gateway/iam` 新增 `personalPrincipalKeyHints()`、`personalPrincipalKeysOf()`。
  - `zhin console user list` 显示用户 id，新增 `--json`（`{ users: [{ id, username, displayName, disabled, roles }] }`）；状态改为「启用 / 已禁用」并加表头。
  - 导入日志带账号：同一 openid 挂在同一适配器的两个账号上时写成 `qq:<openid>（账号 <endpoint id>）`。
  - `zhin agent info` 按来源统计：项目根目录的约定目录（`tools/`、`skills/`、`agents/*/tools` …）、本地插件（`plugins/`）与已安装的插件（`node_modules` 中带 `package.json#zhin` 清单的包，不再计入没有清单的包），报告新增 `source` 与 `bySource`；帮助为中英双语，输出按项目 `locale`（新增 `--locale`）显示中文或英文。`@zhin.js/agent` 的 `formatAgentSurfaceInfoReport()` 新增可选参数 `locale`，新增导出类型 `AgentSurfaceSource`、`AgentSurfaceCounts`。
  - CLI 日期时间统一为本地时区的 `2026-11-15 00:15:56`（24 小时制），中英文相同：`zhin trace -l` / `--sessions` / 回合详情、`zhin schedule list`（下次运行与 `at`）、`zhin watch`（`at` 此前显示的是 UTC 时间）、`zhin doctor` 的「上次运行」、`zhin search` / `info` 的日期，以及 `zhin usage report` 的日期。`@zhin.js/plugin-runtime` 新增 `formatDateTime()` 与 `FormatDateTimeOptions`。
  - `zhin trace -l` 的会话列显示与 `zhin usage report` 相同的可读名称加短键（如 `sandbox · 私聊 Developer（personal-session:ab12cd34）`）；`--json` 保留完整 `session_key` 并加上 `session_display_name`。`@zhin.js/agent/trace` 的 `formatTurnTraceList()` 新增可选参数 `{ sessionLabel }`（类型 `FormatTurnTraceListOptions`）；`@zhin.js/gateway/usage` 新增 `shortSessionKey()`、`sessionLabelOf()`。

- 81d5fda: 技能与知识库的可发现性（#1250 第 27 批）：

  - `skill-catalog-drops-triggers`：系统提示的 `## Available skills` 目录不再每条只留描述第一句的前 40 个字符。每条保留第一句、`Use when …` 句、`Triggers:` 触发词和 SKILL.md frontmatter 的 `keywords`（格式 `- name: 说明 | Use when … | Triggers: …`；单个触发词 / 关键词超过 32 字符丢弃）；截断改为整个目录共用约 4000 字符预算（单条最多 320 字符），超出时先截说明，再截 `Use when`，触发词最后截。toolSearch 编排层的技能目录（`skillsSummaryXML` / 技能注册表）用同一格式和预算，XML 里可选的 `<keywords>` 也会列出。脚手架的 `github` 技能此前在目录里只剩 `Prepare GitHub issues, pull requests,…`，「帮我写一个 PR 描述」现在能在目录里对上 `PR 描述`。
  - 公开技能的 `keywords` 命中当前消息时，在本条消息的运行时尾部加一句「建议加载技能 X」（`## Suggested skill`），只是提示，不自动激活：按关键词自动激活仍只用于 Agent 私有技能，因为公开技能是第三方说明，激活会注入正文并解锁它的工具。缓存前缀不变。为防关键词堆砌，只看每个技能前 12 个关键词、按命中的最长一个计分，忽略单字、不足 3 个字符的英文词、常见寒暄与虚词。新增 `suggestPublicSkillsForIntent()`，`buildCapabilityContext()` 新增可选参数 `intent`。
  - `knowledge-search-not-advertised`：配置了 `ai.knowledge.baseDir`、且本回合的 `knowledge_search` 对所有发送者都可用（没有权限或机器人角色限制）时，系统提示附一段知识库索引（`## Knowledge base`：文件名与一、二级标题，约 1500 字符以内，先舍二级标题再舍文件），并写明关于本机器人、本项目的问题先查知识库。索引排在稳定段末尾、scene 之前（知识库变化只让它之后的缓存失效），段上限 2000 字符；只放标题和路径，去掉 Markdown 与尖括号、逐项截断，放在 `<knowledge_index>` 里标注为数据；与检索共用缓存，目录文件变化时失效。上下文预算新增 `knowledge_index` 段（`zhin trace` 显示为「知识库索引」，网关用量统计计入固定段）。`KnowledgeIndex` 新增可选 `outline()`。
  - `knowledge_search` 的工具描述与 `query` 参数说明改写；不带空格的中文问题按字的二元组部分匹配，计分前去掉「怎么、可以、这个、一下、知道、我想……」等虚词，不会靠虚词命中无关文档。标题抽取按 CommonMark 处理围栏（闭合围栏后面只能有空白）。
  - 知识库目录视为 owner 可信内容：与 `skills/` 一样列入受保护目录，Agent 的文件写入工具写到这里每次都要真人批准。
  - 脚手架模板（`create-zhin-app`）：技能的中文触发词同时写进 `keywords`，`skill-creator` 说明了目录保留哪些部分。

- a7f3a7c: MCP 状态口径与安装预览（zhinjs/zhin#1250 第 28 批）：

  - `mcp-status-not-loaded-contradicts-agent`（根因）：Plugin Runtime 下 `ai.mcpServers` 的服务作为本代（generation）的 MCP 特性运行，在代激活时连接；Agent 的内省却只读自己的 `resourceHub.mcps` 注册表，而这些服务从不进入该表，于是 Console「运行时能力 → MCP 服务」、`zhin status` 都把已连接的 github 显示成「未加载」（`not_loaded`），「需要你处理」也报「未连接」。现在由 `HostMcpStatusBoard` 记录每个配置服务客户端的实际连接结果（跨代保留：被沿用的代仍算已连接，候选代连接失败不影响旧代），内省按它报告：已连接（含工具数）/ 连接失败（附分类原因）/ 尚未连接（`idle`，显示为「待连接」：配置的服务在代激活时就连接，这是激活前的短暂状态）。发布新的一代时清掉已从配置删除的服务的失败记录，删掉再加回来不会显示旧原因。
  - 「需要你处理」只列连接失败的 MCP 服务并附失败原因，标题改为「MCP 服务 … 连接失败」；尚未连接、未加载的服务只在 MCP 页显示。`zhin status` 中 `idle` 显示为「待连接」。
  - 启动日志 `ready | … | mcp:` 改为与状态一致的写法（如 `github(待连接)`；日志写出时客户端尚未连接），连接结果另记 `mcp_connected`（工具数）/ `mcp_connect_failed`（分类与原因）。
  - 新增 MCP 连接测试：`POST {base}/introspection/mcp/test`（body `{ name }`，权限 `agent.configure`，已登记到 `CONSOLE_HTTP_PERMISSIONS`）用一次性客户端连接、列工具后断开，不改变 Agent 自己的连接与行状态；未配置的名字返回 404，同一服务测试进行中返回 409，Agent 未运行返回 503；全局最多同时 2 个测试，同一服务每次测试后冷却 5 秒，超出返回 429 并带 `Retry-After`；每次测试写入 Console 审计日志（`mcp.test`：操作者、服务名、结果与失败分类，不含失败消息）。注意：对 `stdio` 服务，测试会在 Agent 已有进程之外再启动一个同名命令，独占资源（锁文件、固定端口）的服务测试时可能冲突。新增导出：`@zhin.js/console-protocol` 的 `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`；`@zhin.js/host-http` 的 `ConsoleAgentIntrospection.testMcp()`（Agent 不可用时返回 `'agent-unavailable'`）与 `ConsoleRestPagesOptions.mcpTestMaxConcurrent` / `mcpTestCooldownMs`；`@zhin.js/agent/runtime` 的 `HostMcpStatusBoard`（`probe()`）及相关类型，`AgentHostIntrospectionPort.testMcpServer()`。
  - `install-dry-run-dumps-whole-config`：`zhin install … --dry-run` 的配置预览改为 unified diff，只含改动的行和上下 3 行，由真正写入时（逐键补丁、保留注释与顺序）会产生的文本计算，不再重新序列化打印整份配置（此前注释几乎全部丢失，看起来像安装会抹掉注释）。
  - 安装插件时跟随项目的精确版本写法：项目 `dependencies` / `devDependencies` / `optionalDependencies` 里的 `zhin.js` / `@zhin.js/*` 注册表依赖全部是不带 `^` / `~` 等范围的精确版本（`=1.5.0` 也算精确）（`workspace:`、`link:`、`file:`、`catalog:`、`npm:` 别名、git / 路径来源与 `latest` 这类标签不参与判断；至少要有一条注册表依赖）时，`pnpm add` 加 `--save-exact`（npm `--save-exact`，yarn / bun `--exact`）。只对 npm 注册表包生效，请求本身写了范围（如 `foo@^1.2.0`）时按原样安装、不加；`--dry-run` 显示的命令同样带上。`@zhin.js/gateway/plugin-management` 新增 `projectPinsExactZhinVersions()`、`isRegistryPackageRequest()`、`installSavesExact()`。
  - 预览的 diff 也显示行尾差异：文件末尾无换行输出 `\ No newline at end of file`；只有行尾不同的单行标出 ` (CRLF)` / ` (LF)`；整个文件换了行尾时在文件头后用一行 `# line endings: CRLF -> LF` 说明。

- f145963: 语音能力的可用性检查与 `voice_tts` 音频不再进入模型上下文（zhinjs/zhin#1250 第 29 批）：

  - `voice-tts-base64-in-model-context`（根因）：`voice_tts` 合成成功后把整段 mp3 的 base64 放进工具结果，Agent 把工具结果原样交给模型，于是模型看到约 2.5 万字符的 base64，并在回复里又抄写一遍（结果出现一段正常、一段残缺的两段语音，整轮将近 6 分钟）。现在 Agent 在工具结果进入模型之前把 `voice_tts` 的音频（以及没有对象存储时 `generate_image` 的内嵌图片）拆出来，作为媒体随本轮回复经正常发送链（`Message.$reply` → OutboundRenderer → Endpoint）只发一次；模型只看到 `{ format, size, sent: true, note }` 和「语音已发送给用户……不要重复输出音频内容」的提示。
  - 兜底：任何工具结果（成功、报告失败、抛错、PostToolUse 改写后的结果）进入模型前，base64 载荷 2048 字符以上的 data URL 与连续 base64 串替换为一行「[已省略 … 数据（N 字符），未提供给模型]」。读文件 / 搜索 / shell 类工具（`read_file`、`grep`、`glob`、`list_dir`、`web_fetch`、`bash` 等）的结果可能被原样写回文件，只截断 64 KB 以上的串并标明「已截断」，CSS / SVG 里的内嵌图标原样保留；`write_file` / `edit_file` 拒绝写入含这类占位的内容并给出明确报错。实现为一次线性扫描，构造输入不会退化为平方复杂度。
  - 会话历史：已发送的工具语音带 `fallbackText`（如「[语音 mp3 18.6KB 已发送]」），内嵌图片带 `alt`；写入历史（`encodeConfirmedOutput`，流式平台的已确认输出）与文本投影（`renderAgentOutput`）时，所有 data URL / base64 媒体元素与媒体段统一只写占位，下一轮模型看不到载荷。非流式回复只带 messageId 写历史（没有已确认输出，保存的是模型原文）时，助手文本同样经过上面的内嵌二进制兜底，模型自己写的内嵌音频 / data URL 段在历史里只剩「[已省略 … 数据（N 字符），未提供给模型]」。助手原文重新交给模型时也一样：格式修复（schema repair）提示里的「Rejected reply」、Agent 循环每次迭代的消息投影（本轮与历史中的助手文本）、迭代耗尽 / 进度摘要的补全，以及压缩摘要请求，都先省略内嵌二进制再发送，模型看不到被拒回复或先前回复里抄写 / 编造的 base64。修复提示要求删掉占位；模型照抄进回复的框架占位（「[已省略 / 已截断 … 数据（N 字符）…]」「[语音 mp3 18.6KB 已发送]」「[语音（内嵌数据，已省略）]」等固定形态）在出站前统一剔除（结算去重与流式快照都覆盖，流式中未写完、可能成为占位的尾部先不提交），普通方括号文字不受影响。取舍：超过 2048 字符、连续由 base64 字符集组成的文本（包括长十六进制串）会以占位提供给模型并存入历史；用户要求模型输出或改写超长 base64 时，原文不会保留到下一轮。
  - 本轮工具已经产出某类媒体（如语音）时，模型回复里同类的内嵌媒体（`kind: base64` 或 `data:` URL，结构化回复的媒体段和文本回复的 `[audio](data:…)` 都算）视为抄写的副本，不再作为第二段媒体发出——结算阶段与流式结构化回复都去重，并在 turn trace 记一条 `copied_inline_media_dropped`（`@zhin.js/agent/trace` 的 `TurnTraceNote` 新增该变体）；模型引用的 URL / 文件不受影响，没有工具媒体时行为不变。
  - `voice_stt` 只接收 URL / 本地路径并返回文字，入站语音按多模态配置转写或作为媒体块交给模型，不会以 base64 文本进入上下文，未改动。
  - `speech-ready-without-tts-binary`：`speech.tts.provider: edge` 时，Speech Host 启动会检查 `speech.tts.edgeTtsCommand`（默认 `edge-tts`）能否执行——只在 `PATH`（Windows 含 `PATHEXT`）/ 文件系统里查找，不运行命令，最多 3 秒。不能执行时：记 warn（`speech_dependency_unavailable`），启动行写成 `degraded | … | tts: edge (unavailable: not-found edge-tts)`，不再写 `ready`；Console「需要你处理」新增 `speech.unavailable` 条目（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`，指向 `speech.tts.edgeTtsCommand`，配置中的家目录路径只显示最后一段）；实例运行时 `zhin doctor` 通过同一个「需要你处理」列表列出它。检查超时只作为提示（`info`），不阻止调用。
  - `edgeTtsCommand` 填了带参数的命令行（如 `uvx edge-tts`）时单独提示「只能填可执行文件路径，不支持带参数」（新增原因 `has-arguments`；路径本身含空格时仍按找不到处理）。Windows 上只接受 `.exe` / `.com`（Node ≥ 22 不经 shell 运行 `.cmd` / `.bat` 会报 `EINVAL`），只有 `.cmd` / `.bat` 时报「不能直接执行」；`@zhin.js/speech` 把 `EINVAL` 翻译为可读提示。
  - 返回给模型的报错与 warn 日志里，命令路径只保留最后一段（`…/edge-tts`），不暴露家目录。
  - `voice_tts` 在 TTS 被标为不可用时先重新检查（装好 edge-tts 后无需重启），仍不可用则直接返回原因（「未找到 edge-tts（命令「…」不在运行环境的 PATH 中）……配置为可执行文件的绝对路径……」），模型据此准确告诉用户；单次调用改用其他 provider 不受影响。合成失败的 `{ error }` 按失败记录、模型看到完整原因（第 26 批）已核实，并在 eval 中断言原因到达模型。
  - `@zhin.js/speech` 的 edge-tts 缺失提示补充命令名、无执行权限（`EACCES`）的情况，以及 launchd / systemd 托管时必须写绝对路径（`PATH` 通常不含 `~/.local/bin`，也不展开 `~`）。其他 provider（openai / azure / custom TTS、openai / ollama STT）都是 HTTP 服务，没有本机命令依赖，不做启动探测。
  - 文档（中英文 `ai/speech`、`@zhin.js/speech` README）说明托管环境中 `edgeTtsCommand` 要写绝对路径、启动检查的表现，以及语音不进模型上下文。

- fd06037: 定时任务可靠性（zhinjs/zhin#1250 第 33 批；工作日 9:00 天气早报没发出来）：

  - `schedule-empty-plan-no-tools`：执行计划里 `tools` / `skills` 都为空时（`schedule_add` 只带了 `execution_plan.prompt` 或 `refined_prompt`），到点不再拿到空工具列表，而是和没有计划的任务一样按提示词自动挑选工具；trace 的 `capability_resolution` 记 `resolvedBy: affinity` 并带 `warnings: ["empty_execution_plan"]`，一个工具都没选到时带 `no_tools` 并写一条 warn 日志。`schedule_add` 仍接受空计划（不破坏已有任务和调用方），但在结果里提示先用 `schedule_preview` 预演。
  - `schedule-tools-blocked-unattended`（所有者已批准纳入本批）：`execApprovalMode: auto` 时，无人值守回合（定时任务）的审批请求交给已有的自动审核 Agent，只有批准才执行；审核拒绝、要求转问人、超时或出错一律拒绝（fail closed），不会去问任何人，结果写进 trace（`unattended_review`）。`ask` / `bypass` 下行为不变，仍直接拒绝；`requiresApproval: 'human'`、危险工具硬闸和「读取外部内容后的高危动作」确认在无人值守时仍一律拒绝。插件工具声明 `readOnly: true` 后，在默认 `on-risk` 下不再要求审批；只读只放宽这一项，不绕过角色 / 信任过滤、ExecPolicy、FilePolicy、网络白名单和硬闸；显式写的 `requiresApproval: always | once | human` 优先；写文件、执行命令、发消息、写记忆、改配置的内置工具（含插件里同名的工具）、带 `shell` / `outbound` / `config` / `schedule` 类别或 `risk: 'dangerous'` 的工具声明只读也不生效。`schedule_preview` 的结果新增 `unattended_approval`，列出到点会被拒的工具和要交给自动审核的工具。
  - `schedule-failed-run-marked-ok`：一次运行用了兜底文案、没有任何工具结果且回复为空、或有工具被拒时，任务状态记为 `degraded`（未完成），`last_error` 写明原因、相关工具和 `zhin trace <回合 id>`；不重试（回复已送达）。开启 `notifyOnFailure` 时发「[任务未完成]」提醒；送达的回复本身就是兜底说明时不重复提醒。`zhin watch` 显示 `last:degraded` 和原因，`zhin schedule list` 新增「上次」一行。
  - `empty-reply-fallback-misleading`：模型没有给出回复时，兜底文案按实际原因区分：没有可用工具 / 哪个工具被拒（不再把给模型的拒绝原文发给用户）/ 模型空回复。定时任务的兜底文案带任务名、任务 id 和 `zhin trace <回合 id>`，不再建议 `/reset`；普通对话的空回复文案不变。
  - `unexecuted-tool-notice-name-mangled`：给模型的「未执行」工具结果里，工具名改用行内代码（`` `api60s__skill__60s-life__weather` ``），模型照抄时 Markdown 不会再吃掉 `__`。

### Patch Changes

- f370ec5: 认领码（ADR 0060 §3.3，zhinjs/zhin#1250 第 23 批）：

  - 在私聊中直接发送「认领 <码>」/「claim <码>」即可认领，不再需要适配器的命令前缀（带前缀的 `#认领 <码>` 仍然有效）。此前配了 `commandPrefix` 的账号上，按提示发送的消息没有匹配到命令，被当作普通聊天交给了 AI。
  - 认领开启期间（尚无全局 owner），含有当前认领码的消息（不论写法）在入站最早处由认领处理器接手：不交给 AI，不写入会话历史、trace、日志与诊断（日志与消息事件里只显示 `认领 ***`）；群聊里的码立即作废；被丢弃的带码消息（其他机器人贴出、会话未就绪）也作废码；含码的原生 `platform.receive` 事件不派发给原生 Handler。只有整条文本恰好代表一个码时才授予（`认领 <码>`、`认领:码`、`認領 码`、全角、码被空格或 `-` 拆开、末尾标点都算）；含码但还带了别的文字（`认领 码 谢谢`、码藏在长单词里）只作废码并提示，不授予，这样一条消息只比较一个候选，错误次数限制仍然有效。私聊里「认领 <一个词>」但码不对时回复错误并计次。不含当前码的消息（如群聊「claim it」）照常进 AI；已有 owner 后完全不拦截。
  - 会话记录（`conversation_events`、Agent 会话消息）与 trace 的写入端加了兜底：只把当前开启的认领码写成 `***`，没有开启的认领时不做替换。
  - `zhin status`、启动日志、「需要你处理」与自助提示的用法改为「在私聊中直接发送」。
  - 新增公开导出：`@zhin.js/kernel` 的 `matchChatOwnerClaimText()` / `containsChatOwnerClaimCode()` / `registerChatOwnerClaimCode()` / `redactChatOwnerClaimText()`；`@zhin.js/core/runtime` 的 `InboundSecretGuard`（`match` / `inspectNative`）/ `InboundSecretMatch`（`handle` / `discard`）与 `ImRuntimeOptions.inboundSecret`。

- e929d34: #1250 第 26 批：一条请求只给一条结论，工具返回的错误按失败记录。

  - 协作守卫的上限（如「Actors … above the limit」）不再发到聊天，也不再说「需要你来决定」（被停止的协作无法恢复，没有可决定的入口）：原因只写日志和协作 journal。主 Agent 自己的协作调用被拒绝时，由它在回复里用一句话交代；主 Agent 没察觉的停止（例如两个子 Agent 之间触发）在没有主 Agent 回合运行时补发一句本地化说明（「后台任务已停止：这次请求的协作次数到了上限。」）。模型主动调用 `escalate` 时，提问末尾说明直接回复即可，提问也记入本会话的「已告知」记录，下一轮能看到。
  - 委派结果全是内部结局（失败、预算用完、取消、拒绝）时：同一委派之后的 `follow_up` 已完成的，只留在 trace（对同一 Agent 另做的 ask / delegate 不算）；协作已被守卫停止的，只留在 trace；本次请求的第一项失败仍唤醒主 Agent 交代，之后其他委派的失败不再唤醒主 Agent，只发一句「另有 N 项后台任务没有完成。」消息确实投递后才算已告知。
  - 工具返回 `{ error: '…' }`（非空字符串、Error 或带 message 的对象）或 MCP `isError: true` 时，`TurnToolRuntime` 与旧文本流水线的 `ToolRuntime` 统一按失败处理：journal 记 `tool_failed`（trace、协作工具统计随之为失败），实例日志写一条脱敏后的 warn。模型读到脱敏后的完整返回值（经过 `toModelOutput`），措辞是「报告了失败，是否已部分生效不确定」，不再断言没有生效；抛错的失败措辞不变。`error: null` / `''` / `false`、数组、字符串和带 `ok: true` / `success: true` 的结果不受影响。
  - 未执行操作提示不再显示内部工具名：语音工具归为「语音」，`change_draft` 等归为「配置」，没有归类的工具（如 MCP 工具）写作「部分操作」；工具自己报告的失败写作「…操作报告失败，是否已部分生效不确定」。

- 3c6fc08: 知识库标题提取（`markdownHeadings`）改为逐字符扫描，不再使用会在大量连续制表符上回溯的正则（CodeQL js/polynomial-redos）。另外按 CommonMark 处理单独的 `\r` 换行（以前只用 `\r` 换行的文件提取不到标题），只有空白、没有文字的 `#` 行不再被当成标题。
- 2ab7fb9: 协作 id 跨重启唯一，并修复 `zhin trace --engagements` 读错数据库（#1250 第 35 批）。

  - `engagement-id-reused-across-restarts`：Engagement、信件与预算授权 id 原先是每次启动从头计数的 `m1`、`m2`……（授权 `g1`……），重启后重复，一个 `engagement_events` id 下混进几次重启里互不相干的协作（Workroom `?engagementId=m17`、`zhin trace --engagements` 都会混在一起）。现在 id 形如 `m-<运行 id>-<序号>` / `g-<运行 id>-<序号>`：运行 id 在每次实例启动时由启动时间（base36）加随机字符生成，Agent 的 Harness 与预算账本共用同一个运行 id。id 对 Console 协议、Workroom 与 CLI 仍是不透明字符串，格式没有对外约定。`@zhin.js/harness` 新增 `createRunId`、`createRunScopedIdFactory`、`isLegacyCounterId`，`createHarness` / `InMemoryBudgetLedger` 未传 `newId` / `idFactory` 时也改用运行 id。
  - 一次性数据迁移：新增 `migrateEngagementEventIds`（标记表 `engagement_event_migrations`），只由实例在启动后于后台执行，把同一个旧 id 下的记录按 `seq` 顺序、在每条 `engagement_opened` 处拆成各自的 Engagement，换上新 id，并改写记录里的信件 id（`mailId`、`rootMailId`、`causationId`、`mails` 等）、授权 id（`grantId`、`rootGrantId`、`parentId`）以及协作之间的 `carriedBy` 引用。分批执行，每批一个事务、按主键读写：读者看到的每个旧 id 要么完整未拆、要么已全部拆完；每批核对行数，不丢行；中途停止或崩溃时已提交的批次保留，下次启动接着做；全部完成后写标记，之后再运行是空操作。迁移不阻塞实例启动（大表在远程数据库上可能超过网关的就绪超时），进行中协作日志照常读写。只含一次协作的旧 id 不变。支持 SQLite、MySQL、PostgreSQL（与协作事件日志相同）；失败只记日志，下次启动重试。`zhin trace` 等 CLI 只读：不执行迁移、不建也不写标记表；库里还有未拆分的旧 id 时照常展示，并在标准错误输出提示「旧版协作记录尚未拆分，重启实例后会自动整理」（先查标记，有标记就不再检测）。Console SQL 不能写这张标记表。
  - `trace-engagements-crash` 复测：1.5.0（2cf215e0）里 CLI 仍把数据库 Host 直接交给日志，修复在第 21 批（a460a46f0）才合入、晚于 1.5.0，当前版本已不再报 `this[#db].select is not a function`。另外修复 `zhin trace --engagements --cwd <dir>`（以及 `zhin usage report` 的服务名查找）把相对的 SQLite 路径按当前目录解析、打开一个新的空库的问题：现在按项目根目录解析，与网关一致（绝对路径、`:memory:` 与 `file:` URI 原样使用）；数据库文件不存在时（拼错的 `filename`、从未启动过的项目）CLI 不再新建空库，而是报告无法打开。`zhin trace --engagements <id>` 与 `zhin trace <id>` 都优先精确匹配，再按前缀匹配。
  - 文档（第 33 批的无人值守自动审核）：`execApprovalMode` 默认就是 `auto`，所以定时任务等无人值守回合里需要审批的工具默认交给审核 Agent 判断；不想要时设 `ai.agent.execApprovalMode: ask`（人工审批），无人值守时这些调用直接拒绝（没有只关掉无人值守审核的单独开关）。只要 `confirmHighRisk` 保持默认的 `external_content`，任何模式下读取外部内容之后的高危动作在无人值守时一律拒绝，审核 Agent 也不能放行。`docs/ai/index.md` 示例里把默认值误写成 `ask`，已改正。

- Updated dependencies [a460a46]
- Updated dependencies [d216b84]
- Updated dependencies [f370ec5]
- Updated dependencies [48dc650]
- Updated dependencies [e929d34]
- Updated dependencies [7288cd1]
- Updated dependencies [19526a6]
- Updated dependencies [f1affdd]
- Updated dependencies [2ab7fb9]
  - @zhin.js/harness@1.1.0
  - @zhin.js/plugin-runtime@1.4.0
  - @zhin.js/kernel@1.3.0
  - @zhin.js/core@1.11.0
  - @zhin.js/ai@1.7.2
  - @zhin.js/adapter@1.3.3
  - @zhin.js/agent-feature@1.1.20
  - @zhin.js/feature-kit@1.1.19
  - @zhin.js/mcp-feature@1.1.20
  - @zhin.js/permission@1.2.3
  - @zhin.js/prompt-section@1.1.19
  - @zhin.js/skill@1.1.20
  - @zhin.js/tool@1.1.23

## 1.6.0

### Minor Changes

- efa87bf: 失败原因看得见（#1270 第 14 批）：账号准备失败与模型调用失败通过新的 `failureJournal` 端口（`InferenceFailureJournal`）写入实例的运行时失败记录，重启后在凭据版本一致时恢复显示（`preparationFailure.restored`）；新增纯函数 `subAgentPurposeEffect()` / `purposeKeyEffects()` 与 `inferencePurposeEffects()`，管理视图新增 `purposeEffects`（`agents.<key>` 是否生效及原因 `binding-name` / `ambiguous` / `no-target`），目标列表新增 `subAgents`（`readAgentPurposeTargets()`）；`HostInference` 新增 `accountAttention()`、`purposeEffects()` 与 `pruneFailureJournal()`；新增 `pruneInferenceFailures()`：账号被删、断开或凭据版本变化时清掉对应的旧记录。
- 816c3f3: #1250 第 18 批：入站消息结局与群聊插话（ADR 0061 P1/P2/P5、ADR 0062 §23）。

  - 每条入站消息在处理结束时恰好得到一个结局（`InboundOutcomeLedger`，`finally` 提交）：命令、中间件、处理器、交互态、准入、去重、近似指令、发送失败与 Agent 入口都上报候选，按优先级取主结局，其余记为 facets；抛错记为 `internal_error` 并带错误号（`err_` + 12 位十六进制，`createErrorId` 移入 `@zhin.js/logger`），原样重新抛出。结局不存消息正文，管理员补充 ≤ 200 字并按决策审计同一套规则脱敏（`redactDecisionPayload` 下移到 `@zhin.js/kernel`，Agent 原名再导出）。
  - 结局保存在进程内（2000 条 / 24 小时，静默结局每会话每分钟超过 30 条时聚合），附在消息诊断记录上（`RuntimeMessageDiagnostic.outcome`），并写一行实例日志 `op=inbound_outcome`。
  - 没被 @、不是指令、本群又没开插话的群消息记 `not_addressed`（`unaddressed-message-no-record`）；旁听判定不插话记 `ambient_silent`；控制面 / 禁言记 `filtered_by_policy`。
  - 群插话纳入功能开关：`ai.trigger.ambient.conversations` 是全局默认值，适配器 / 账号 / 会话层开关存进 `feature_overrides`；群管理员可在群里发「功能 关闭 / 开启 / 重置 插话」（`ambient-allowlist-only`）。
  - 交互态：提问可声明 `answeredBy: 'target' | 'anyone'`（默认 `target`）；回答无效时提示最多重发一次。提醒插件的确认步骤只接受「确认」/「取消」，期间的闲聊不再让整段确认提示反复出现（`reminder-confirm-captures-chat`）。
  - group-suite：`mypoints` 增加中文别名「积分」「我的积分」，`rank` 增加「排行」「积分排行」（`group-suite-zh-alias-partial`）。

### Patch Changes

- d21754f: 日志写法统一（zhinjs/zhin#1250 第 19b 批）：Agent 的存储与清理失败日志由 `op=usage_persist status=failed; 说明` 改为与其余日志相同的 `usage_persist | status: failed | detail: 说明`，备用模型切换日志改为 `model_fallback | purpose: … | from: … | to: … | reason: … | phase: …`。实例的 Console 系统日志改用 `@zhin.js/logger` 的 `parseLogLine`，带日期的新格式与旧格式的行都能落库。
- Updated dependencies [efa87bf]
- Updated dependencies [816c3f3]
- Updated dependencies [d21754f]
  - @zhin.js/ai@1.7.1
  - @zhin.js/core@1.10.0
  - @zhin.js/kernel@1.2.0
  - @zhin.js/logger@1.3.0
  - @zhin.js/im-contract@1.3.0
  - @zhin.js/database@1.2.2
  - @zhin.js/adapter@1.3.2
  - @zhin.js/tool@1.1.22
  - @zhin.js/harness@1.0.1

## 1.5.0

### Minor Changes

- 8bf8dfa: #1250 第 10 批（试用反馈、关键修复与 AI 账号）的公开 API 新增按 minor 发布：Console 协议的功能未启用状态、功能矩阵分类与传输状态文字；Host 端口校验与 owner 判定导出；网关项目标识与插件候选；Agent 运行时的连接测试与 Host 环境变量引用授权；模型请求首响应时限；`zhin ai` 命令与 `--allow-unverified-host`；日志单行转义导出；Host 根配置新增 `firstResponseTimeoutMs`，icqq 新增 `logLevel` 配置（按 commandSuggestion 先例为 minor）。
- 07f9d01: 所有用途支持备用模型（#1250 chat-purpose-no-fallback）：聊天、摘要、旁听、Agent 角色（`purposes.agents`）以及 Adapter / Endpoint / 场景的聊天覆盖都可以写 `{ profile, fallbacks }`。额度用完、余额不足或密钥被拒（单纯的 403 不算）时按顺序换下一个备用模型；同一模型连续 2 次超时后下一次尝试也换（#1270）。只换到能接得住这次请求的模型（输入媒体、上下文窗口、工具循环协议），从当前对话继续、不重放已执行的工具；失败的模型在恢复前跳过（有供应商提示按提示，日配额到太平洋时间午夜，其他固定冷却）。用了备用模型的回合在 trace 中标记「本轮由备用模型回答」，Console 管理视图可读取跳过中的模型与最近切换；配置校验错误指明出错的链路径（如 `purposes.adapters.qq.chat.fallbacks[1]`）。
- 5d90159: 聊天身份 P3（ADR 0060）：Sandbox 以我发言、`ai.personalPrincipals` 改读链接。

  - **Sandbox 安全修复**：Console Sandbox 客户端自填的发送者 ID 一律是模拟身份——服务端写成保留 id `~sim:<id>`，不解析任何 zhin 角色，信任档位最低；填 owner 的 id 不再能冒充 owner。以 `~` 开头的发送者 id 不是聊天身份（`isChatIdentity` 为 false），不能持有、被授予或解析角色，也不记入最近发言人。
  - Sandbox 新增「以我的聊天身份发言」（默认开启）：已登录的 Console 用户按其链接的人在 Sandbox 上的身份发言，角色按该人的授予解析；未登录（引导令牌）与 `--standalone` 一律按模拟身份。新 RPC `chat-identities.simulated.ensure`（`self.chat-identity`）为调用者的人（没有则新建并链接）在模拟适配器上建立身份，不触及真实平台。`ChatRoleReader` 新增可选方法 `consoleSpeaker`。
  - `ai.personalPrincipals` 首次启动导入为「人 ↔ Console 账号」链接（不授予角色）；`rootId` 与当前目录不一致不再导致启动失败（按别名 + subjectId 导入并告警）；之后个人推理主体只读链接表。`@zhin.js/agent`：`HostInferenceOptions.personalOwners` 可为函数（每次管理租约读取），`resolveInferenceManagementPrincipal` 的 `bindings` 可为函数，且 `full` 范围允许切换到调用者自己的个人推理主体；新增 `personalOwnersOfIdentities` / `chatIdentityOfPersonalOwner`。
  - 「需要你处理」`chat-roles.imported` 列出 `ai.personalPrincipals` 导入的链接；若被链接的 Console 用户就是当前查看者且尚无全局 owner，提示「是否同时设为全局 owner」。确认已读同时标记该导入。
  - 聊天 `角色 授予 / 撤销` 可用 `#<人 id 前缀>` 引用一个人（前缀唯一时）。

### Patch Changes

- 39db402: AI 账号与 Host 环境变量（#1250）：Console 账号可以引用 Host 环境变量（账号来源 `env://NAME`，或在设置密钥中填写 `${NAME}` / `${NAME:-}`），规则为：仅全局 owner（owner 本就能读写 `.env`），且变量名以 `_API_KEY` 结尾（避免把无关机密发往任意地址）；服务地址不限，自定义中转地址可用（其他 Console 用户与不合规的变量名返回明确中文原因 `reason`）；新增本机命令 `zhin ai account add / rename-env / test`（只经网关控制套接字，写审计，不回显值）及对应实例路由 `POST {base}/agent/inference/cli/account/add`、`/cli/account/rename-env`；新增 `POST /agent/inference/probe` 与 `/account/test` 连通性探测（带 tools 的最小请求，成功时激活凭据）。账号状态新增 `environment`（`env://` 账号无凭据时的环境变量就绪情况）与 `lastCall`（本进程最近一次真实调用结果）。`@zhin.js/host-http` 导出 `isLocalSocketPrincipal`、`isGlobalOwnerPrincipal`、`LOCAL_SOCKET_USER_ID`、`LOCAL_SOCKET_CREDENTIAL_ID`。
- da9dc8a: 聊天角色引导文案（ADR 0060 P0）：需要 zhin 角色的命令被拒绝时，回复说明去哪里获得角色（联系主人 / Console「聊天角色」页），不点名缺哪个角色或谁持有；发言者是群主 / 群管理员时另说明平台身份不等于 zhin 角色。`功能` / `角色` 的拒绝回复同样指向 Console，尚无全局 owner 时提示认领码；Agent 信任档位的限制说明改为「联系主人授予 trusted 角色」。Sandbox 页把模拟的「Master」改称「群主（平台身份）」，并显示服务端解析的 zhin 角色与 Agent 信任档位（入站回显帧新增 `senderChatRole` / `senderTrustLevel`）。ICQQ README 去掉已不读取的 `master`「必填」写法。
- 48fdf0d: 模型请求首个响应超时（#1250 model-request-hangs-no-timeout）：`ai.agent.providerResilience` 新增 `firstResponseTimeoutMs`（默认 30000，0 关闭），`requestTimeoutMs` 默认值由 180000 降为 120000。在时限内收不到响应头或首个流事件即判定模型服务无响应（新增 `ProviderErrorKind` `no_response`）：不在同一模型上重试，回合经正常出站链回复「模型服务无响应」；写 `provider_timeout` warn 日志（会话、回合 id、用途、Provider 别名、模型、阶段、时限，不含内容与密钥），回合 trace 时间线记录 `model_timeout`。`StreamOptions` 新增 `onResponseStart`，SDK 传输在收到响应头时调用。
- Updated dependencies [8bf8dfa]
- Updated dependencies [603b892]
- Updated dependencies [07f9d01]
- Updated dependencies [da9dc8a]
- Updated dependencies [bc31cd3]
- Updated dependencies [760e9f5]
- Updated dependencies [5d90159]
- Updated dependencies [73475bd]
- Updated dependencies [35e5d89]
- Updated dependencies [48fdf0d]
- Updated dependencies [809c6ee]
  - @zhin.js/ai@1.7.0
  - @zhin.js/logger@1.2.0
  - @zhin.js/core@1.9.0
  - @zhin.js/database@1.2.1
  - @zhin.js/adapter@1.3.1
  - @zhin.js/harness@1.0.1

## 1.4.0

### Minor Changes

- 19fe076: 后台委派结果不再丢失（#1250 `delegate-result-lost-after-turn`）：子 Agent 的回合与汇总回合不再借用主回合的模型操作（主回合结束即关闭，导致 `AI provider: operation-closed`），而是各自从主回合保留的委派授权（`ModelDelegationAuthority`，可多次 `acquire`，随协作结束、Mailbox 关闭或代际退役释放）打开独立的模型操作；汇总结果改用主动消息经 Runtime 出站端口（IM 回合新增的 `delivery` 端口，走统一发送链）发到原会话，不再依赖已关闭的回复作用域；发给用户的只有 Agent 自己的回答（新增 `ActorTurnOutcome.reply`），不再带给模型看的英文说明（预算停止 / 空回答）；汇总回合因预算用完停下时发出已有的部分回答并附一句本地化的「预算用完」说明；失败提示按原因区分（汇总失败 / 发送失败 / 预算用完且没有结果 / 没有结果），用户停止或热重载中止后不再提示，发送被出站控制抑制（`suppressed`）或已部分送达时也不追加失败提示（只写日志）。委派授权另有 30 分钟的绝对时限（不可配置），到期释放并关闭仍打开的子操作。子回合 trace 现在记录模型调用（`model_calls`）与实际使用的用途 / profile / 模型（新增 `model_selection`），主回合结束后才跑完的子回合单独保存 trace（`trace-subagent-model-calls-missing`）。新增导出 `captureSubTurnTracing`、`SubTurnTrace`、`SubTurnTracing`、`TurnTraceSave`、`TurnTraceModelSelection`。
- f560972: Agent 行为改进（#1250）：被拒或失败的工具结果以「未执行」开头并写明原因；回合结束时只要有未声明 `readOnly` 的写操作被拒 / 失败，框架一定补一行按操作类别写的固定说明（如「（提醒、记忆等操作未执行）」，不再按关键词猜测回复是否已说明）：回复未发出时追加在末尾，已流式发出时经正常出站链单独补发一条；追加 / 补发 / 补发失败记入回合追踪 `unexecuted_tool_notice`。`memory_upsert` 获得独立审批等级：实时回合写发起人自己的 `user` 记忆不再审批，`global` / `platform` / `session` 与无人值守回合仍需审批（策略 `memory-scope`）。拒绝记录带上当时的审批策略指纹，策略变更后会话下一回合注入 `approval-policy-change` 说明，避免模型依据旧拒绝直接放弃。`discover` 的排序器返回空或部分结果时不再丢掉关键词命中（排序结果在前、合并去重）。全局 owner 读过外部内容后的高危动作在 `ask` / `bypass` 下改为向主人本人一次性确认（不记住、超时算拒绝，主人不在场时拒绝），`auto` 仍由审核 Agent 决定。新增 API：`createBypassApprovalPort` 的 `confirmIntent` 选项、`createRuntimeApprovalPort` 的 `masterPresent` 选项、`MEMORY_SCOPE_POLICY`。
- 0e998fd: Agent 性能与 trace 改进（#1250）：

  - 按需加载的工具在会话内只增不减：常驻工具按名称排在最前，已加载工具按首次加载顺序追加；本回合策略较窄、看不到的已加载工具仍保留在会话快照里，下一回合原样回到列表，相邻请求的 `tools` 前缀不变。超出 `maxLoadedPerSession` 时按最早加载淘汰并写日志（`touchToolInSnapshot` / `touchToolsInSnapshot` 新增可选 `onEvict`）。
  - 子 Agent（`ask` / `follow_up`）回合里工具产出的图片、音频、视频、文件作为结构化附件随回复交回提问方，并入提问方的回复经正常出站链发送，不再依赖子 Agent 正文复述 URL。只收工具产出的媒体（子 Agent 正文里的链接不算），并先用子 Agent 自己收窄后的权限判定每个附件（本地路径须通过它的文件权限）。
  - `zhin trace` 记录子 Agent 的模型调用与用量（之前显示 0 次），父回合汇总写成「合计（自身 N，子 agent M）」，新增 `subagent_usage` 字段；`ai.usage` 与用量记录同样计入且不重复计。
  - 同一次模型请求在时间线、`requests`、`model_calls` 与 `ai.usage` 里记录同一个 provider（实际解析出的服务 ID），`zhin trace` 显示服务名。
  - 每次模型调用记录请求前缀哈希（system + 工具定义，`prefix_hash`）；某服务长期没有缓存命中而相邻请求前缀相同时，Console 用量统计（`promptCacheHints`）、`zhin usage report` 与 `zhin doctor` 提示「该服务可能不支持或未透传 prompt 缓存」并给出前缀相同的比例。

- 2e35f72: 子 Agent 用途绑定生效（#1250 `agent-purpose-binding-ignored`）：`ask` / `delegate` 拉起的子回合按 `purposes.agents` 选模型：先查插件限定名（`<plugin>__<agent>`，推荐的键），再查裸名——裸名只在没有其他子 Agent 同名、也不是 Agent 绑定名（`ai.agents.<name>`，与绑定共用同一键空间）时才用；子 Agent 永远不会用到绑定的用途，有歧义时写 warn 并回退聊天用途；汇总回合（入口 Agent）沿用主回合的用途（包括非 zhin 绑定的 `agent:<binding>`）和候选模型链。「绑定名」只算 `ai.agents` 里配置的绑定，仅从 agent 文件发现的名字不算。走聊天用途的子回合保留主回合的候选模型链。子回合 trace 的 `model_selection` 写出实际用的用途、profile、账号与模型。`ModelDelegationAuthority.acquire` 与 `ModelContextAcquireInput` 新增可选 `agent` 字段（`SubAgentModelKey`），`ModelRuntimeServiceOptions` 新增可选 `bindingNames`（类型 `SubAgentModelKey` 由 `@zhin.js/agent/model-runtime` 导出）。
- 5232fd8: IM 审批安全修订（#1250 安全审查）：管理员本人审批改为开关 `ai.agent.approval.adminSelfApprove`，**默认关闭**——关闭时这类回合与之前一样只能由主人批准（或说明无人能批），`execApprovalMode: ask` 默认仍只有主人能批；开启后管理员本人确认只限策略明确标为管理员可批的操作——声明 `tags: ['admin_approvable']`（`ADMIN_APPROVABLE_TOOL_TAG`）的工具（Host 的 `schedule_add` 已声明）与写 `session` 记忆；敏感文件 / 受保护路径（如 `.git/config`）、Shell 命令、写 `global` / `platform` 记忆、未声明的插件工具审批与自动审核 Agent 的升级审批都需要主人，管理员的确认渠道直接返回「需要主人」而不弹提示（`ApprovalRequestInput.requiresOwner` / `adminMayApprove`）。管理员审批人要求端点层或以上的 `admin`（`holdsEndpointAdmin`；会话层 admin、被降级的会话层 owner 不算），且只在管理员自己的私聊里；群聊 / 频道未配置主人时不再退回管理员自批。读过外部内容、合流或旁听回合里写发起人自己的 `user` 记忆也先请发起人确认意图（防记忆投毒）。审批提示的「风险」行与危险工具硬闸提示同样打码，新增识别 `FOO_TOKEN=…` / `export API_KEY=…`、`Authorization: token …`、`X-Api-Key: …`、`--password=…` / `--token …`、URL 中的密码、JWT、AWS / Google 密钥；执行、指纹与授权范围仍用原参数。审批端口按用途报告可用性（`ApprovalPort.intentAvailable`、`isApprovalPortAvailable(port, purpose)`），只能确认意图的端口对硬闸与普通审批直接报不可用。「审批策略已变更」说明只认框架写入的拒绝记录（`ToolResultMessage.deniedUnderPolicy`），工具输出里伪造的策略戳不再触发。
- 0e998fd: 机器人专用引导文件 `BOT.md`（#1250）：项目根目录有非空的 `BOT.md` 时（只认根目录，`data/BOT.md` 不读），机器人只读 `BOT.md`（与 `SOUL.md`、`TOOLS.md`），不再读任何 `AGENTS.md`，`AGENTS.md` 留给开发者与编码代理；没有 `BOT.md` 时行为不变。新项目生成 `BOT.md`（机器人指令与记忆）和面向开发者的 `AGENTS.md`；`zhin setup --bootstrap` / `zhin doctor --fix` 在已有 `AGENTS.md` 且无 `BOT.md` 时继续用 `AGENTS.md`。修改 `BOT.md` 与修改根 `AGENTS.md` 一样需要审批。新增导出 `BOT_BOOTSTRAP_FILENAME`、`BOT_BOOTSTRAP_FILENAMES`、`botBootstrapFilenames()`、`hasBotBootstrapFile()`。

  `BOT.md` 列入 `DEFAULT_SELF_FILES`：`self` 硬闸、未注入项目根时的按名匹配与隔离 shell 的只读挂载都覆盖它，与 `AGENTS.md` 相同。只读挂载只覆盖已存在的文件；隔离 shell（`workspace-write`）运行后，项目根下新出现的自我文件（`BOT.md`、`AGENTS.md`、根配置等）会被改名为 `<文件名>.quarantined-<时间戳>`，记警告日志并在工具结果里报告。Agent 宿主、`hasBotBootstrapFile()` 与 CLI 都只认项目根目录的非空 `BOT.md`。修改根目录 `BOT.md` 与修改 `SOUL.md` / `AGENTS.md` 一样触发 Root 重建并重新读取。

- 7126d03: CLI 输出与实例错误说明（#1250）：

  - CLI 的命令结果（`zhin packages info`、`zhin search`、`zhin schedule list/add/…` 等）写到 stdout，不再带 `[时间][INFO] [CLI]` 前缀；诊断日志写到 stderr，前缀只在全局 `--verbose` 时出现。**行为变更**：CLI 的日志输出（`logger.info` / `success` / `warn` 等，包括成功与提示行）从 stdout 移到了 stderr——只捕获 stdout 的脚本不会再看到这些成功 / 提示行，需要时请同时捕获 stderr（`2>&1`），或改为解析命令结果本身。`zhin packages info` 正确读取字符串形式的 `author` 与 `maintainers`，并列出已安装包的命令、Agent 工具与配置项（静态读取约定目录与 `schema.json`）。
  - 实例 HTTP API（`/message/send`、`/assistant/jobs`）区分预期失败与意外异常：预期失败返回 `code`（`delivery_failed`、`delivery_unknown`、`endpoint_not_found`、`notify_target_missing`、`invalid_argument`、`not_found`、`unavailable`）和中文说明，发送失败的 `data` 为 `ConsoleSendFailure`；意外异常仍只返回 `Internal error`，但带日志关联 `errorId`。`zhin send` / `zhin schedule` 显示具体原因，`--debug` 显示 `errorId` 并从实例日志找出对应行。
    - **行为变更**：这些预期失败的 `error` 文本改为中文说明，且今后可能调整措辞——程序请按 `code`（以及 `data.reason`）判断，不要匹配 `error` 文本。
    - **新错误码 `delivery_unknown`**（HTTP 502）：`/message/send` 的投递结果未知（平台可能已经收到）时不再归入 `delivery_failed`，而是返回独立的顶层 `code: 'delivery_unknown'`（`data.reason: 'delivery_unknown'`、`data.status: 'unknown'`）。`delivery_failed` 表示确定未发送、可以重试；`delivery_unknown` 不应自动重试，否则可能重复发送。
    - **行为变更**：`/assistant/jobs` 收到 `notify.channel: im` 时直接以 HTTP 400（`code: 'notify_target_missing'`）拒绝——这个接口无法指定目标会话，以前会接受后在调度时才失败；请在聊天中让机器人创建需要 IM 投递的任务，或改用 `log` / `silent`。CLI 的 `--notify-channel im` 同样被拒绝。
  - 网关终端区分 node-pty「未安装」与「已安装但原生模块未构建」，后者提示在 `allowBuilds` 放行后 `pnpm rebuild node-pty`（或 `zhin migrate`）。
  - 脚手架 `knowledge/faq.md` 写明换模型的两个入口（Console「AI 与模型 → 用途」与 `ai.plan.yml`）及实际优先级；`ai.agents.zhin.model` 已不再决定模型。
  - Introspection 的命令、中间件、组件、工具、Prompt Section 条目带 `owner`、`pluginInstance`、`pluginPackage`（`ConsoleIntrospectionOwner`）。
  - 决策审计：gate 写出的 `model_skip` 在 payload 中带 `parent`（如 `ambient_decision`），回放可折叠为一条。

- ccab2c1: Console Host 侧诊断数据修正（#1250），新字段均为可选、旧客户端不受影响：

  - `endpoint.friends` / `groups` / `channels` / `group_members`：适配器不提供该读取时不再返回 `{ error }`，而是空列表加 `status: 'unsupported'`、`capability`、`message`（协议类型 `ConsoleEndpointCapabilityUnsupported` / `ConsoleEndpointListReply`，判定函数 `isConsoleEndpointCapabilityUnsupported`）。
  - `endpoint.send_message` 失败时在 `data` 中带出 `{ code, reason, status, retryable? }`（`ConsoleSendFailure`；`reason` 为 `no_live_client` / `endpoint_offline` / `endpoint_not_found` / `target_not_found` / `policy_rejected` / `platform_rejected` / `unsupported` / `invalid_content` / `delivery_unknown` / `failed`），`error` 改为对应中文原因；Core 失败回执的消息带上失败码（`Outbound delivery failed (<code>).`）。
  - MCP 客户端记录最近一次连接失败（`auth` / `network` / `timeout` / `config` / `process_exit` / `sdk_missing` / `unknown` + 脱敏短消息 + 退出码），写入 warn 日志（`op=mcp_connect_failed`），并经 Agent introspection 与 `GET /api/introspection/mcp` 返回 `status`（`connected` / `failed` / `idle` / `not_loaded`）与 `lastError`。
  - 进程资源：`GET /api/system/status` 新增 `process`（`role: 'instance'`，与 `memory` 同一次采样）；`gateway.instance.status` 新增 `gateway`（`role: 'gateway'`，网关进程自身）。协议类型 `ConsoleProcessSample`。
  - `gateway.packages.list` 每个已安装依赖带 `kind`（`plugin` / `feature` / `library`，取自 `package.json#zhin.type`），Console 只应把 `plugin` 当插件。
  - `chat-roles.*` 条目新增 `grantedByDisplayName`：调用者本人授予的记录显示其显示名，聊天内授予、配置迁移、初始化令牌给出可读标签；其他 Console 账号不解析（实例不读取网关账号库）。

- cca4427: IM 渠道审批（#1250）：回合内审批提示按会话决定谁能确认——全局 owner 本人、群聊里的 Bot 主人（与之前相同），开启 `ai.agent.approval.adminSelfApprove`（默认关闭）后，管理员自己的私聊里主人无法作答时，由在场的端点层 zhin `admin` 发起人本人确认标为管理员可批的操作（仅「允许一次 / 拒绝」，不记住；其余仍需主人，见安全修订）；其他用户只能对「读取外部内容后的高危动作」确认自己的意图，这一确认（`scope: 'intent'`）不能代替普通审批。确认消息走原出站链，只认同一平台用户 ID 在同一会话（端点 / 会话 / 话题）里的「确认 / 取消 / yes / no」或按钮回调，他人回复、跨会话、过期按钮无效，超时按拒绝。私聊里非主人且无管理员身份的审批不再空等超时，直接说明原因。给模型的拒绝原因区分无人值守、此会话没有确认渠道、被拒 / 超时，并提示可在 Console 操作（定时任务：「运维 → 定时任务」），不再让模型把工具名当聊天命令推荐。审批提示里的密钥字段与令牌打码（执行仍用原参数）。每次回合内确认写 `tool_approval` 决策审计（`channel: turn_prompt`、`purpose`；新增原因码 `tool_approval_unavailable`）。`ApprovalRequestInput.purpose`、`ApprovalOutcome.scope`、`formatApprovalDenial` 的可选上下文参数、`formatApprovalBlocked`、`resolveImApprover`、`describeApprovalChannelConflicts` 为新增 API。`execApprovalMode: ask`，或 `confirmHighRisk` 未关闭且启用了定时任务 / 助理提醒时，启动日志提示一次配置冲突；`zhin doctor` 新增「审批渠道」检查。`UserInteractionRequest` 新增可选字段 `purpose?: 'approval'`（`UserInteractionPurpose`），审批确认消息带上它。
- 0228fb2: 标出「说查了却没调用工具」的回答（#1250 `tool-capability-unverified` 第 ② 部分）：最终回答里出现「查了 / 查到 / 根据最新 / I checked / I looked up」这类说法、但本轮工具调用为 0 时，trace 记 `claim_without_tool_call: { phrase }`（时间线也有一条），决策回放的 `model_run` 事件 payload 记 `claimWithoutToolCall: true`、`claimPhrase` 与 `toolCalls`。只做标记，用户看到的回答不变。「根据目前 / 当前」必须后接数据类名词，否定说法（没查到 / 未查过 / didn't check / haven't checked）与「搜了一下记忆 / searched my memory」不算；子 Agent 回合的最终回答同样检查（新增 trace 注记 `final_reply`）。中英文说法列表集中在 `LOOKUP_CLAIM_PATTERNS`（新增导出 `findLookupClaim`、`claimWithoutToolCall`）。
- 4922472: AI 订阅账号接入（#1250）：Antigravity「完成准备」按官方开源客户端的方式向 `loadCodeAssist` 发送客户端 `metadata`，账号还没有 Code Assist 项目时用默认档位调用 `onboardUser` 开通并轮询长任务（有次数上限），失败时 `ProviderPreparationError` 带上游 HTTP 状态、原因码与步骤（不含响应正文与令牌）。账号没有默认档位时与官方客户端一致改用 `legacy-tier`；上游要求账号验证（`VALIDATION_REQUIRED`）时以原因 `validation-required` 结束、不尝试开通（不返回验证链接）；长任务名只接受单段 `operations/<id>`。整个准备过程有 90 秒总时限、每个上游请求有 15 秒时限，超时以原因 `preparation-timeout` / `request-timeout` 报告。准备失败不再被吞掉：日志写出代码与上游状态；`/login/complete` 仍返回 200，但账号状态视图新增 `preparationFailure`（`code` / `reason` / `upstreamStatus` / `step`，仅当前凭据修订、进程内保存），Console 无需再次调用准备即可显示原因。**客户端可见的变化**：准备失败原先一律是 503 `unavailable`，现在 `/login/prepare` 返回 424，`code` 固定为 `preparation-failed`，驱动给出的代码放在 `preparationCode`，另带 `reason` / `upstreamStatus` / `step`；机密 OAuth 客户端缺少 client secret 时 `/login/begin` 由 503 改为 428 `client-secret-required`；模型目录请求被限流（上游 429）时 `/discover` 由 503 改为 429 `discovery-rate-limited`，带 `upstreamStatus` 与解析后的 `retryAfterMs`（401/403 仍按拒绝处理）。驱动元数据新增 `requiresClientSecret` 与 `modelSuggestions`（仅为建议）；Codex 订阅支持「从服务读取模型」（Codex CLI 使用的 `/models` 目录），Claude 订阅给出带「suggestion」标记的模型 ID 建议。

  审查跟进：Antigravity 账号 `loadCodeAssist` 返回了 `currentTier` 却没有项目时，先按当前档位再调用一次 `onboardUser`（同样的长任务轮询与时限）读取项目；仍没有项目时使用模型服务配置的新可选项 `projectId`（Google Cloud 项目 ID，字符串形式，与 gemini-cli 的 `GOOGLE_CLOUD_PROJECT` 一样以 `cloudaicompanionProject` 和 `metadata.duetProject` 发给 `loadCodeAssist` / 非免费档位的 `onboardUser`），都没有才以原因 `project-required` 结束，424 文案说明如何填写项目 ID。Codex 订阅的模型目录请求不再上报 `@zhin.js/ai` 自己的版本号：`client_version` 改用模型服务配置的新可选项 `codexClientVersion`，默认 `0.167.0`（已知可用的 Codex CLI 版本，导出为 `CODEX_DEFAULT_CLIENT_VERSION`）；目录为空时 `/discover` 的结果带 `emptyHint`（`code: 'discovery-empty'` 与提示文案），Console 可提示用户手动填写模型 ID。`@zhin.js/ai/providers` 新增导出 `CODEX_DEFAULT_CLIENT_VERSION`、`CodexServiceOptions`、`AntigravityServiceOptions`。

- 9026329: `zhin trace` 记录并显示触发消息（脱敏、截断到 120 字的文本、发送者、会话、消息 id）以及「收到 → 回合开始」的等待时间、合流消息数和排队时长；时间线首行显示回合开始前收到消息的时刻（#1250）。trace 因此包含用户发言摘录与发送者 / 会话标识，Console 读取（`/api/agent/traces`、`/api/agent/trace-archive/*`）需要 `agent.view`，见 CLI 文档「触发消息」。修复同一回合内在工具变更后的再补全里调用 `load_tool` 时，下一次模型请求仍未声明该工具、模型只能再调 `discover` 的问题：Agent 循环在下一次请求前刷新工具列表；`load_tool` 成功但本回合策略不允许该工具时返回明确错误。

### Patch Changes

- 9026329: 未命中的消息首词与已注册指令名 / 别名高度相似时（私聊、@机器人或带指令前缀；忽略大小写与 `-` / `_` / 空格，默认 1 次编辑且名称至少 5 个字符或 3 个汉字），经正常回复链直接回复「没有这个指令，你是不是想用：X、Y」，不再交给 AI 编造指令名（#1250）。只列出发送者有权使用的指令；根配置 `commandSuggestion: false` 关闭，`{ maxDistance, limit }` 调整。Agent 提示在有指令菜单时引导模型不确定就让用户发送菜单，而不是猜指令名。

  只有带指令前缀的消息才按首词命名空间匹配（`/rss foo` → `rss-list`）；私聊与 @机器人 但未带前缀时，只匹配与指令名本身相近、且简短像指令的消息（不含「是什么 / 怎么 / 吗 / 啥 / ？」等疑问词或问号，名称后只跟指令声明的参数），所以「rss 是什么」「process 太慢了」之类的问题仍交给 AI。

- 7cc703a: 热重载重建范围按受影响的子树分别计算（#1250 `hmr-multi-change-full-rebuild`、`hmr-stale-cross-package-import`）：同一批里改了几个插件（入口、子树内的辅助模块、能力文件混在一起）时，只重建这些插件子树并替换子树外受影响的能力，其他插件 Scope、适配器投影与 Endpoint 原样保留（不重连、不重登）；适配器只在自身源码或配置变化时重建。Root 安装器可以用新的 `watchProjectFiles({ patterns, onChange })`（`RootResourceContext`）声明自己读取的项目文件，只改了这些文件（例如 `SOUL.md` / `AGENTS.md` / `TOOLS.md`、`ai.knowledge` 目录）时不再重建 Root，改为通知声明方重读（Agent Host 已声明，turn 读取最新 bootstrap；`hmr_reload | rebuilt: resource`），未声明的根目录文件仍整棵重建并记 `hmr_full_rebuild` 原因。根插件 tool 等通过包名引用挂载的本地插件模块时，被引用文件变化会让引用方一起重新加载（新代码，所有重载的引用方共享同一个新实例）；未变化的插件包保持原有的共享实例，引用方重载不会重复执行其顶层副作用；依赖索引只沿包名导入进入被监视的目录，不再遍历 workspace 链接的框架源码（启动不再变慢）；引用了普通 workspace 库等无法刷新的依赖方，在 `hmr_reload` 的 `unrefreshed_dependents` 和 warn `hmr_unrefreshed_dependents` 中列出。子树重载因拓扑变化退回整棵重建时也记 `hmr_full_rebuild` 原因；没有归属记录的文件（例如 Feature 包内的文件）仍整棵重建并说明原因；批次中其余部分重载失败时，已声明的项目文件仍会通知声明方。
- 704c7a4: Sandbox 会话页与功能自助反馈（#1250）：

  - 审批标记：`UserInteractionRequest` 新增可选 `purpose: 'approval'`，Core 渲染为 keyboard 段 `data.purpose`（经正常出站链）；IM 审批端口（`createRuntimeApprovalPort`）发出的「操作确认」带此标记。Sandbox 页面只给带 `data.purpose === 'approval'` 的收到消息标「需要你的确认」，游戏卡片的「放弃」、菜单分页等普通按钮消息不再被误标。
  - Sandbox 输入区：顶栏只保留状态、停止 / 重试、对话与轨迹，其余（模拟发送者、运行环境、运行检查器、清空会话）收进「更多」菜单；底部快捷键提示改为可折叠；快捷命令不再写死 `/help`、`ping`、`/status`，改由新接口 `GET /api/conversations/workspaces/commands`（权限 `endpoint.view`）按该会话的命令索引与 endpoint 实际 `commandPrefix` 生成（菜单的真实命令名优先，无前缀不带 `/`，未注册的命令不出现）。
  - 功能覆盖记录操作者：`feature_overrides.updated_by` 在同一文本列内记录结构化写入者（来源 `chat` / `console` / `cli`、聊天身份 adapter + 平台用户 ID + 显示名，或 Console 用户 principal id + 显示名），旧记录照常读取（`chat:…` / `user:…` 推出身份）。`feature.get` 与 `feature.conversations` 返回可选 `operator`：只有对该层级有 `feature.configure` 的调用方看到完整写入者（Console 用户 id 与显示名、聊天身份与名字），仅有 `feature.view` 的只看到来源（`{ source }`）。能解析时返回会话显示名（Sandbox 会话名），只按该会话所属的 Sandbox Endpoint（适配器 + Endpoint）及其当前 owner 匹配，且只返回给同时有 `endpoint.view` 的调用方（与工作区目录同一权限）。**降级注意**：写入过结构化写入者的行，在旧版本里 `updatedBy` 会原样显示为 JSON 字符串（`{"f":1,"by":…,"op":…}`），不影响读取与覆盖生效。
  - Sandbox 输入区新增「@ 机器人」按钮：插入对当前机器人（ready 帧的 endpoint id）的 mention，文本形式为 `[@<机器人 id>]`，与入站 `[@机器人名]` 解析一致；@ 候选列表里的机器人条目改为真实 id；快捷操作帮助同步说明。
  - 页面兜底渲染：不认识的段不再只显示 `[type]`——`markdown` 显示原文，keyboard 与未渲染的 JSX（`{"$jsx":…}`）读出文本、按钮降级为 `[按钮标签]`，不再出现原始 JSX 对象。

  已知限制：Sandbox 页面的「需要你的确认」标记只用于展示，依据收到消息里 keyboard 段的 `data.purpose`；能自行构造该段的插件可以让普通按钮也显示这个标记（不影响审批本身的鉴权）。

- f3910f1: 定时任务（#1250）：持久任务现在记录并显示下次运行时间（`state.nextRunAtMs`）——启动时为已启用的任务重新计算（修复升级后为空的旧数据并记 info），每次运行、`resume` 后都会重新计算，`pause` 清空；已启用却算不出下次运行时间的任务记 warn，并作为「需要你处理」的 `schedule.unschedulable` 条目出现。重启时 assistant profile 同步不再清空任务的运行记录（`state`）与创建时间；`routines.heartbeat.enabled: false`（或 profile 不再声明心跳）会把已持久化的 `assistant-profile-heartbeat` 停用，profile 改变任务启用状态时记 info。`zhin schedule list`、`GET /assistant/jobs` 与 Console `schedule:list` 的持久任务返回 `target: { resolved, display?, reason? }`（账号显示名 + 会话；账号已不存在时 `resolved: false`），CLI 以「⚠ 无效」标出，并显示已启用任务的下次运行时间。`zhin schedule add` 新增 `--target <adapter>:<endpoint>:<kind>:<id>`（省略时沿用 `assistant.defaults.notify` / profile `defaults.notify`）；`--notify-channel im` 缺目标或目标账号不存在时，Host 返回 400 与错误码 `schedule_target_required` / `schedule_target_not_found` / `schedule_target_invalid` 和中文说明，不再是 Internal error。数据库迁移完成后 `data/schedule-jobs.json` 改名为 `schedule-jobs.json.migrated`（记 info）；`schedule_list` 工具描述改为真实存储位置。
- f3910f1: `schedule_preview` 不再因 `AI provider: forbidden` 失败（#1250）：预演在聊天回合的工具调用里启动自己的回合，却沿用了外层聊天回合捕获的推理快照，而该快照只属于外层回合的操作与会话，于是被拒绝、模型都没选出（`ai.usage` 记录 `model: ?`）。现在回合只复用属于自己的快照，预演、正式执行与聊天走同一套模型解析。定时任务执行失败的日志改为 `op=schedule_execute_failed`，带 `jobId`、`purpose`（preview / scheduled）与 Agent 绑定名。
- b5884b3: 服务地址可以改了（#1250 `service-baseurl-immutable`）：没有账号引用的服务可以任意修改地址；已被账号引用的服务只允许改 URL 路径（协议、主机、端口不变，例如把 `https://byesu.com` 改成 `https://byesu.com/v1`），换主机仍然拒绝——账号的密钥只能发往原来的主机。只有 `baseUrl` 跨源修改才返回新的 `ProviderError` 代码 `service-origin-change`（HTTP 409），其他身份字段（issuer、tenant、product、headers、鉴权方式等）的修改仍是 `plan-conflict`；同源比较前按 URL 规范化（默认端口、IDN、IPv6 写法、大小写、主机名末尾的点），Console 拿到的错误文案说明原因并建议「复制为新服务」。另外，模型请求拿到 2xx 却不是 JSON / 事件流（例如少了 `/v1` 时返回站点首页 HTML）时，改为明确的 `non_json_response` 失败类型（「服务返回的不是 JSON（可能少了 /v1）」），不再是看不懂的 SDK 解析错误，也不会重试；连接测试与聊天失败提示都会用到它。
- b3ba941: Token 用量（#1250）：`plugin.root.usage-stats` 与 `zhin usage report` 按（服务, 模型）合并行，`services:<id>` 与 `accounts:<id>` 两条记录路径不再拆成两行，并给出「服务名 · 模型」显示名（RPC 行新增可选 `displayName` / `providerLabel` / `providerIds`，顶层新增 `modelLabels`）；读不到服务名时只显示模型名。两个输入总数分别标注口径（`totals.inputBasis: 'reported-all-calls'`，新增 `inputBreakdown`：首次请求估算含 `other` 与对应的真实输入）。日期 / 小时分桶按请求 `timeZone` 或实例时区（`TZ`，否则系统时区）计算，CLI 新增 `--tz`。会话显示 trace 里记录的会话名（`bySession[].displayName`、CLI `display_name`）。`zhin trace` 的模型列不再显示 `services:<uuid>/`。
- Updated dependencies [0e998fd]
- Updated dependencies [5232fd8]
- Updated dependencies [7cd299e]
- Updated dependencies [7cd299e]
- Updated dependencies [9026329]
- Updated dependencies [e6d7cc1]
- Updated dependencies [ccab2c1]
- Updated dependencies [c6b5563]
- Updated dependencies [f1a9745]
- Updated dependencies [e0b4e51]
- Updated dependencies [7cc703a]
- Updated dependencies [cca4427]
- Updated dependencies [4922472]
- Updated dependencies [70ddaf4]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
- Updated dependencies [b5884b3]
- Updated dependencies [9026329]
- Updated dependencies [07bd3dc]
  - @zhin.js/ai@1.6.0
  - @zhin.js/core@1.8.0
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/adapter@1.3.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/agent-feature@1.1.19
  - @zhin.js/feature-kit@1.1.18
  - @zhin.js/mcp-feature@1.1.19
  - @zhin.js/permission@1.2.2
  - @zhin.js/prompt-section@1.1.18
  - @zhin.js/skill@1.1.19
  - @zhin.js/tool@1.1.21

## 1.3.1

### Patch Changes

- ce8edf5: 网关存储隔离（ADR 0059）：

  - Console 的用户、角色、绑定、会话、API 令牌与审计从项目数据库移到网关自己的 `.zhin/gateway.db`（SQLite，`0600`），与项目库方言无关；redis / memory 项目也能建 Console 账号（删除 `IAM_DIALECTS`）。网关不再常驻连接项目库。
  - 升级后网关在连接阶段自动迁移旧表：备份为 `.zhin/backups/gateway-db-<时间>/console-tables.json`，在 gateway.db 事务内复制并按行数与校验和核对，再从项目库删除；完成前 `/auth/*` 回 503 `iam_unavailable`，初始化令牌被拒。`zhin console migrate [--revert]` 手动迁移与降级前回退。
  - `@zhin.js/database`：SQLite 方言 `denyAttach`（事务内发现 `ATTACH` 回滚并作废事务、再 `DETACH`）与 `backupTo`；`console-credential`：受限账号的建号语句、`planConsoleRole` / `provisionConsoleRole` / `probeConsoleCredential` / `refreshConsoleGrants`；MongoDB `listCollections` 操作。
  - `@zhin.js/core`：实例 SQLite 连接强制 `denyAttach`；PostgreSQL / MySQL 的 Console 原始 SQL 只在 `database.console` 受限账号的独立连接池上执行（启动探针、PostgreSQL 补授权、失败后最多每 5 分钟重试），没有可用账号时 `capabilities.sql = false` 并给出 `sqlReason`；新增 `capabilities.sqlIsolation`；删除 `gatewayTableHost()`。
  - `@zhin.js/cli`：新增 `zhin db console-role [--print-sql] [--role]`、`zhin console migrate [--revert]`；`zhin console …` 网关未运行时打开 gateway.db；`zhin doctor` 检查 gateway.db 权限、迁移状态、项目库里重新出现的旧表与受限账号（`--fix` 建号）。
  - `zhin.js/instance`：`--standalone` 的 Console 访问控制改用 gateway.db（不经 DatabaseHost）。
  - `@zhin.js/plugin-runtime`：`DatabaseHostConsoleCapabilities` 新增 `sqlReason`、`sqlIsolation`。`@zhin.js/runtime`：主机配置 Schema 新增 `database.console`（`password` 标为密钥）。`@zhin.js/agent`：补测试固定 Agent 文件 / bash 工具拒绝 `.zhin/gateway.db*` 与 `.zhin/keys/`。
  - `@zhin.js/host-http`：Console 数据库 RPC 的驱动错误回复带上 SQLSTATE（`data.sqlState`，如受限账号的 42501），Console 据此提示改用结构编辑器。
  - 评审加固：项目库标记表 `zhin_gateway_store` 记录 gateway.db 的 id，gateway.db 丢失 / 被替换时 Console 保持关闭，`zhin console init --reset-store` 显式重置；需要运维处理的迁移失败不再自动重试（`zhin doctor` 报告），暂时性失败指数退避，同一快照只备份一次；受限连接由 `consoleConnectionOptions` 构造（去掉连接串 / URI 中的主账号凭据与查询开关）并在归还前重置会话；PostgreSQL 探针检查 CVE-2018-1058 前提、对象所有权、角色设置与网关表授权，60 秒过期并在出错后重探；MySQL 探针检查角色、PROXY 与表 / 列权限；建号用 SCRAM 校验值，错误信息擦除口令；匿名响应只给类别码；插件原始句柄为冻结视图；Agent `bash` 按命令文本拒绝间接读取 `.zhin`。
  - PostgreSQL 探针拒绝受限账号可执行的、其他角色拥有的 SECURITY DEFINER 函数（函数名只写日志；不替用户撤销 PUBLIC 的 EXECUTE，`--print-sql` 附检查与撤销提示）。
  - 第三轮评审：SQLite 首次运行即写标记（网关创建项目库文件，建所有者 / 实例就绪后再补写）；插件原始句柄改为显式门面、`denyAttach` 构造时捕获；Agent `bash` 拒绝通配 / 引号拆分 / `find` 模式触及 `.zhin` 与网关表名，Docker 沙箱隐藏 `.zhin/`；PG 标记表撤销 PUBLIC 与被授予者权限，探针补文件 / 远程函数、列级权限、大对象、其他模式；驱动错误一律按暂时性重试。
  - 第四轮评审：Docker 沙箱的只读回合也隐藏 `.zhin/`，`useDocker: 'auto'` 回退宿主时记警告；插件原始句柄与事务句柄的每个方法、每个字符串类参数都做网关表名检查（`trx.queryStatement` 等）；网关运行中发现 `store_mismatch` 时关闭 Console；Agent `bash` 文本检查解码 `$'…'` 并展开花括号；PostgreSQL / MySQL live 测试各用独立数据库，可并行运行。
  - 第五轮评审：Agent `bash` 文本检查覆盖反斜杠、续行、参数默认值与扩展通配；插件原始句柄参数总是以检查过的副本交给驱动；运行中因 store 不匹配关闭 Console 时一并结束用户连接与终端；ADR 写明动态 SQL 与文本检查的限度。

- Updated dependencies [f74b4a5]
- Updated dependencies [f28d8b9]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
- Updated dependencies [f2fa3d7]
- Updated dependencies [eba2566]
- Updated dependencies [ac72706]
- Updated dependencies [8f237bd]
- Updated dependencies [b2aae3c]
- Updated dependencies [3c14aeb]
- Updated dependencies [cdf04b2]
  - @zhin.js/core@1.7.0
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/database@1.2.0
  - @zhin.js/adapter@1.1.34
  - @zhin.js/agent-feature@1.1.18
  - @zhin.js/ai@1.1.56
  - @zhin.js/feature-kit@1.1.17
  - @zhin.js/mcp-feature@1.1.18
  - @zhin.js/permission@1.2.1
  - @zhin.js/prompt-section@1.1.17
  - @zhin.js/skill@1.1.18
  - @zhin.js/tool@1.1.20
  - @zhin.js/harness@1.0.1

## 1.3.0

### Minor Changes

- d80964d: 修复 1.2 发版撞号：`@zhin.js/core` 与 `@zhin.js/agent` 按 minor 升到 1.2.0 时，npm 上早已有同号的旧架构版本（core 1.2.0–1.5.16、agent 1.2.0–1.2.1），`changeset publish` 只提示 already published 就跳过，导致 `zhin.js@1.1.26` 等已发布的包依赖了旧 core / agent，启动时缺少 `CHAT_ROLES`。

  本次把 core 发为 1.6.0、agent 发为 1.3.0（npm 上第一个空闲的 minor），并重新发布所有直接依赖它们的包，让依赖版本与 peer 范围指向新版本（`^1.6.0` / `^1.3.0`，不再落进旧架构版本）。

### Patch Changes

- Updated dependencies [d80964d]
  - @zhin.js/core@1.6.0
  - @zhin.js/adapter@1.1.33

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

- 571f5c6: 工具结果里的图片块与嵌入图片资源不再只在 MCP 工具上捕获：插件工具、Seam 工具和内置工具的结果同样在写入工具日志前保存为私有图片，模型上下文里只留下 `asset_id`，需要时用 `get_local_assets` 查看。纯文本与其他结构的工具结果保持原样。
- c2bbdcf: Console 访问控制（ADR 0049）：用户、角色、会话、API 令牌与审计日志存入项目数据库，每个 Console RPC、`/api` 路由与 Host 鉴权的 WebSocket 都按 `@zhin.js/console-protocol` 的权限表放行，未登记的一律拒绝。

  **破坏性变更**

  - `http.tokens` 与演示模式（`scope: demo` / `user`）删除；配置里仍有 `http.tokens` 时 Host 拒绝启动。Host 配置 Schema 同步删除该字段。
  - `http.token` 变为初始化令牌：只在创建第一个所有者之前有效，之后在所有接口上被拒绝。
  - 未在 `CONSOLE_WS_PERMISSIONS` 登记、又使用 Host 鉴权的插件 WebSocket 不再接受 Console 账号；插件自己的 WebSocket 应改用 `ws(path, { auth: 'protocol' })` 并自行校验凭据（新增 `verifyProtocolAccessToken`、`isLoopbackAddress`）。
  - OneBot 11 / 12、NapCat、Milky 的反向 WebSocket 改为只认适配器自己的 `access_token`；未配置 `access_token` 时只接受本机回环连接。
  - `zhin doctor --live` 等改从 `ZHIN_CONSOLE_TOKEN` 读取 API 令牌（仍兼容 `ZHIN_HTTP_TOKEN`）。

  **迁移步骤**（详见文档「升级到 Console 访问控制」）

  1. 升级后用 `http.token` 打开 Console 初始化向导创建第一个所有者，或运行 `zhin console init`（脚本：`zhin console init --yes --owner <名> --password-stdin`）。
  2. 删除配置里的 `http.tokens`，在 Console「访问控制」里为原来的令牌持有人创建用户并绑定角色（`viewer` / `operator` / `admin`）；演示环境改用 `viewer` 账号。
  3. 自动化在 Console 签发 API 令牌，放进 `ZHIN_CONSOLE_TOKEN`。
  4. 从其他机器或容器连接的反向 WebSocket endpoint 补上 `access_token`。
  5. 忘记密码或所有者被锁时，停下 Host，用 `zhin console user passwd|enable|create` 离线恢复。

  MCP / A2A 的 Bearer 访问同样接受用户 API 令牌（分别需要 `mcp.access`、`a2a.access`）。适配器与插件文档同步改为账号与角色的说法。

- 63595fc: 功能配置新增第四级「会话」（ADR 0055），并引入聊天角色（ADR 0056）。

  - `@zhin.js/plugin-runtime`：会话解析键与转义、会话覆盖读取令牌，门禁与缓存按会话判断；锁定可来自账号层。
  - `@zhin.js/runtime`：`x-zhin-config.levels` 支持 `conversation`，新增 `conversationFields` / `selfServiceFields` / `chatAdminFields` 声明与会话覆盖校验；`configFor` / `isEnabledFor` 解析到会话层；Host 配置新增 `features.selfService`。
  - `@zhin.js/console-protocol`：`feature.*` 支持 `level: 'conversation'`，新增 `feature.conversations`、`chat-roles.list|grant|revoke` 与 `featureScopeTarget`；被上级锁定的写入返回 409 `locked`；`iam.manage` 可按作用域绑定（仅 `chat-roles.*`）。
  - `@zhin.js/core`：命令、中间件、处理器的门禁按消息所在会话判断。
  - `@zhin.js/agent`：Agent 工具与技能披露按会话层功能开关判断。
  - `@zhin.js/schema`：新增 `Schema.object(...).featureLevels(...)`，声明插件根的分层级别与会话字段。
  - `zhin.js`：实例新增会话级功能覆盖存储、聊天角色、`chat-roles.*` RPC 与群内「功能」「角色」命令（默认关闭）；所有层级的启停按「上级停用则下级锁定」执行。
  - `@zhin.js/plugin-repeater`：支持按群覆盖复读阈值与冷却，群管理员可在聊天中调整阈值。
  - `@zhin.js/plugin-rss`：支持按群关闭 RSS，被关闭的会话不再收到推送。

- fd055d2: 修复依赖安全告警：传递依赖 zod 升到 4.6.7 以上、@hono/node-server 升到 2.1.7 以上、qs 升到 6.16.1 以上（经 MCP SDK 引入），rimraf 升到 6.1.4（随之使用已修复的 glob），开发工具链的 minimatch 升到 11.x；新建插件模板的 rimraf 范围同步更新。
- fd22375: 修复功能分层配置（ADR 0050 / 0055）审查发现的问题：

  - 覆盖校验：值为 `null` 的键（显式清空）不再绕过字段白名单，下级层不能借此清掉仅全局字段，嵌套清空也必须指向 Schema 中存在的字段。
  - 环境变量引用：聊天自助在任何层级都拒绝写入 `${…}` / `env://`；Console 的 `feature.set-override` 只允许具备 `ops.env.write` 的用户写入，防止借 `feature.configure` 读取密钥。
  - 会话覆盖存储：数据库写入检查影响行数，0 行或并发插入同一键时重新加载并返回冲突；删除保留墓碑行，修订号单调递增（无 ABA）；Console 读取时节流重新加载以看到其他进程的写入；`feature.get` / `feature.conversations` 新增 `persistent`，非持久数据库在回复中提示重启后丢失。
  - Console：嵌套插件的开关沿祖先链计算锁定（409 `locked`）；会话键按各部分校验，不再限制总长 512；最近会话按事件 id 倒序扫描最近窗口并去重。
  - 推送门禁：管理员 RSS 任务按目标会话开关跳过并记录 `featureDisabled`；记账私信推送检查私聊会话开关；彩票推送目标先按 `AdapterIndex.resolve` 解析为账号再判断（`isEnabledFor` 新增 `{ endpoint: { adapter, endpointKey } }` 目标），无法解析时按原方式投递；活动反馈按事件携带的 `conversationRef`（Endpoint CapabilityId 与原始会话）判断。

- e0bc008: 管理网关审查修复：

  - `zhin migrate`：旧的 `"start": "zhin start"`（或 `--daemon`）会改写为前台的 `zhin start --foreground --mode production --no-watch`——`zhin start` 现在默认后台，容器 / PM2 / systemd 会立即退出；迁移校验要求 `start` 带 `--foreground` 或使用 `zhin runtime start`。新增的 `@zhin.js/gateway` 版本按项目 CLI 的发布线推导（CLI 锁在旧发布线时用 `~主.次.0`），`^0.0.0` 占位不再被说成「dependencies 已声明」。
  - 本地控制套接字：`gateway.http.request` 走与 HTTP 相同的路由表（网关自有路由可达，`http.base: /` 正常），只取路径与查询，拒绝含 `\` 的路径与带 body 的 GET，事件流返回「改用 HTTP」；设置了 `ZHIN_CONSOLE_TOKEN` 时由网关按该令牌认证并以其主体执行与审计，`http.token` 不再经套接字发送。大小上限按 JSON 编码后的 UTF-8 字节计（中文不再触发协议错误），超限提示改用 HTTP。Windows 命名管道每次启动带随机名，CLI 校验 `.zhin/gateway.json` 中密钥的握手 HMAC。网关把实际端点（含 `os.tmpdir()` 回退路径）通过 `ZHIN_GATEWAY_SOCKET` 告诉实例，Agent 文件工具与 `bash` 拒绝触及它。
  - 开放 Host：地址未知的请求不再算本机（进程内调用需显式 `inProcess`）；`http.host` 非回环且既无 `http.token` 也无所有者时，网关拒绝启动并提示设置 `HTTP_TOKEN` 或 `zhin console init`。
  - `zhin doctor`：`HTTP_TOKEN` 按行读取（空值不再吞掉下一行），`change-me`、`zhin-local-token` 等弱值告警并可 `--fix` 替换，写入后 `.env` 为 `0600`。
  - `zhin console init`：先校验所有者用户名与密码，再切换数据库、写 `.env`。
  - 前台网关只在自己是终端前台作业时把标准输入交给实例，实例退出 / 崩溃后恢复终端设置；登录辅助提示改为整行输出，不再卡在按行转发里。
  - `gateway.readyTimeout` 在每次启动、重启实例与每笔依赖事务前重新读取，修改后无需重启网关。
  - Console 客户端：依赖事务回滚（`ok: false`）时安装 / 卸载 / 更新 hook 设置 `error`；事务请求的超时随 `gateway.packages.progress` 事件续期，实例启动阶段放宽到最长就绪等待，仍超时则报「结果未知，请核对」。

- 5cd9d3d: 实例监管改为 IPC 控制通道，删除退出码 75 重启路径（ADR 0054 §3，B1.1）

  - host-http：新增 `@zhin.js/host-http/bridge`，定义控制通道协议（`ready`、`restart-request`、`shutdown`，带协议版本）与实例侧 `openInstanceControlChannel`；只有网关启动的子进程（带 `ZHIN_RUNTIME_CHILD` 标记）才打开控制通道，测试框架或进程管理器建立的 IPC 通道不会被误当作网关。
  - gateway：`InstanceSupervisor` 取代 `NativeTypeScriptSupervisor`——advanced 序列化 IPC、`ready` 握手与版本校验、先优雅停止再 SIGTERM / SIGKILL、按请求重启、崩溃退避与重启风暴保护；`InstanceLogCollector` 采集实例日志（内存环形缓冲 + 按大小轮转的 `.zhin/logs/instance.log`）；`zhin runtime start` 经 `runSupervisedInstance` 启动。删除 `planRespawn`、`processRestartExitCode`、`ZHIN_SUPERVISOR_PID` 与孤儿看门狗（网关包尚未发布，删除不算破坏性变更）。
  - zhin.js：实例启动完成后发 `ready`，收到 `shutdown` 时停止，重启（Console、聊天、依赖变更、自我变更）改为向网关发 `restart-request`；网关断开时实例自行停止，不再残留进程；未受监管时的重启请求只停止实例、不强制退出进程（嵌入方可通过 `exit` 选项接管退出）。
  - cli / runtime / agent：相应更新启动参数、自我变更生效与文档说明。

- c2bbdcf: 三级功能配置（ADR 0050）：插件配置按「全局 ← 适配器 ← 账号」合并，覆盖写在插件配置块的 `overrides.adapters.<别名>` / `overrides.endpoints.<别名>/<账号>` 里；上级禁用锁定下级，`null` 清空、数组整体替换。消息分发、中间件与 Agent 工具按目标账号的启用状态门禁；Console 新增 `feature.*` RPC 读写各层配置。

  **破坏性变更**

  - `overrides` 成为插件配置的保留键（与 `commandNamespace`、`disabledCommands` 一样由框架注入 Schema）；原来把 `overrides` 当普通字段的插件需要改名。
  - `PluginSetupContext` 新增必需成员 `configFor(target)` 与 `isEnabledFor(target)`；自行构造或实现该接口的代码（测试替身等）需要补齐。

  **迁移步骤**

  1. 检查插件 Schema 里是否有名为 `overrides` 的字段，有则改名并迁移配置。
  2. 自建的 `PluginSetupContext` 替身补上 `configFor` / `isEnabledFor`（可直接返回全局配置与 `true`）。
  3. 需要按账号区分配置时，在插件 Schema 字段上声明 `x-zhin-config.levels`，再在 Console 功能页或配置文件 `overrides` 里填写。

- 663473b: Agent 模型输出不能再借出站媒体段发送宿主文件（ADR 0056 §2）：

  - 此前模型可以在回复里写 `{"kind":"file","value":"file:///etc/passwd"}`（或 `/etc/passwd`）这样的「平台文件引用」，Agent 发布层原样放行，OneBot / NapCat 会把它当作本地文件读取上传；模型以 `path` 引用工作区文件时也只做了工作区与敏感文件名检查，没有按发起人角色做 `read_file` 的读取判定（普通成员可发出 `.git/config`、`package.json`）。
  - Core 新增不可信来源的出站媒体策略：`untrustedContent(content, trust)` 包装的内容在渲染器里（出站中间件与 Endpoint 之前，出站链仍唯一）只允许 http(s) 链接、有上限的内联数据（默认 25 MiB）与裸平台文件标识；本地路径（含 `file://`）只在 `trust.authorizePath` 认可或由可信代码 `trustedMediaRef()` 构造时放行；嵌套的本地来源拒绝，`html` 只保留文字，不做 `${…}` 模板替换。被拒的段替换为可见提示（「[图片未发送：媒体来源不被允许]」）并记录 `op=outbound_media_refused`。
  - Agent 的回复、流式回复（`OpenReplyStreamOptions.mediaTrust`）、场景事件回复、主动发送与 QQ / ICQQ / Telegram / Discord / NapCat / 企业微信的 Agent 工具发送都按不可信来源投递；模型引用的本地路径按发起人文件角色（只有全局 `owner` 是 `owner`）做与 `read_file` 相同的判定，需要确认的敏感读取直接拒绝。插件代码自己构造的内容不受影响；工作区内工具生成的截图、图表与 Agent 落盘的大附件照常发送。

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- de0f08c: `ai.imageStorage`（Cloudflare R2）的上传改由 `@zhin.js/agent-media/core` 的 S3 存储实现，不再直接依赖 `aws4fetch`。配置格式、对象命名、公开 URL、25 MiB 上限、只允许 PNG / JPEG / GIF / WebP 的规则，以及只把精确的自有地址视为已发布图片的判断，都保持不变。
- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
- Updated dependencies [53932e5]
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [cc7a5f9]
- Updated dependencies [518cd79]
- Updated dependencies [c2bbdcf]
- Updated dependencies [663473b]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
- Updated dependencies [d655ef0]
- Updated dependencies [1e54b1e]
  - @zhin.js/adapter@1.1.33
  - @zhin.js/core@1.2.0
  - @zhin.js/kernel@1.1.7
  - @zhin.js/ai@1.1.55
  - @zhin.js/logger@1.1.3
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/agent-feature@1.1.17
  - @zhin.js/database@1.1.8
  - @zhin.js/mcp-feature@1.1.17
  - @zhin.js/permission@1.2.0
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/prompt-section@1.1.16
  - @zhin.js/skill@1.1.17
  - @zhin.js/tool@1.1.19
  - @zhin.js/im-contract@1.1.14
  - @zhin.js/harness@1.0.1

## 1.1.51

### Patch Changes

- Updated dependencies [0d76a7c]
  - @zhin.js/adapter@1.1.32
  - @zhin.js/core@1.1.60

## 1.1.50

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
  - @zhin.js/ai@1.1.54
  - @zhin.js/core@1.1.59
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/adapter@1.1.31
  - @zhin.js/agent-feature@1.1.16
  - @zhin.js/feature-kit@1.1.15
  - @zhin.js/mcp-feature@1.1.16
  - @zhin.js/permission@1.1.15
  - @zhin.js/prompt-section@1.1.15
  - @zhin.js/skill@1.1.16
  - @zhin.js/tool@1.1.18

## 1.1.49

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- a1f1028: Sink runtime, HTTP, IM, database, inference, and agent host installers from `@zhin.js/cli` into their owning runtime packages (`@zhin.js/runtime`, `@zhin.js/host-http`, `@zhin.js/core/runtime`, `@zhin.js/agent/runtime`), extract the canonical `executeInboundTurnSpine` with `InboundTurnRecord` in `@zhin.js/core/runtime`, and unify `ZhinAgent.hostMailbox`, `AgentTurnIngressRoute`, and `EngagementJournal` onto a single Actor/Mailbox runtime spine.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/ai@1.1.53
  - @zhin.js/core@1.1.58
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/adapter@1.1.30
  - @zhin.js/tool@1.1.17
  - @zhin.js/agent-feature@1.1.15
  - @zhin.js/feature-kit@1.1.14
  - @zhin.js/mcp-feature@1.1.15
  - @zhin.js/permission@1.1.14
  - @zhin.js/prompt-section@1.1.14
  - @zhin.js/skill@1.1.15

## 1.1.48

### Patch Changes

- 3a8504b: ADR 0048 Agent Harness (H1–H2): new `@zhin.js/harness` package (attenuated authority, conserved budgets, guard kernel, engagement journal, mailbox). Live turns now collaborate with other agents through the `agents` / `ask` / `delegate` / `tell` / `cancel_delegation` / `escalate` tools instead of `spawn_task`; `agent.json` gains `collaboration: { contacts, accepts_from }`. The sub-agent runtime, deferred workers, detached tasks and their config fields are removed.
- 6347b19: ADR 0048 H2: delete the sub-agent runtime, `spawn_task`, deferred workers, detached tasks, the standalone `AIService.createAgent` / `runAgent` / `createAgentSession` loop and the `ai.subagent.*` / `subagent_*` events. `ai.agent.subagentTurnMode`, `maxParallelSubagents`, `subagentAutoContinue`, `subagentDirectImDelivery`, `subagentTools`, `subagentTurnWaitMs`, `subagentExecApprovalMode`, `workerExecApprovalMode`, `workerBaseTools`, `deferredAutoContinue`, `deferredAutoContinueMaxDepth` and `ai.agents.<name>.permission.task` now fail startup with a migration hint; declare collaboration in `agents/<name>/agent.json` instead.
- c563f3b: ADR 0048 H3 PR-2: every IM / ZhinAgent turn is a Mail turn of a long-lived host Mailbox. Same-session admission (#725), the ADR 0038 merge / danmaku windows, stale-reply checks and supersede are now the harness inbox policy; scene-event wakes post one event Mail on the scene lane. The mid-turn delivery API is `harness.deliver` (`open` is the same call). `TurnAdmissionGate`, `InboundTurnQueue` and `harness.attach` are removed.

  **Breaking config rename:** `ai.agent.inboundQueue` is now `ai.agent.mailbox` (same `groupMode` / `ttlMs` / `maxQueuedTurns` / `merge` / `live` fields; `coalesceWindowMs` is dropped). A config that still sets `ai.agent.inboundQueue` fails startup validation with a migration message.

- bf00459: ADR 0048 H3 PR-3 (closes #1179): due timers become `timer` Mail on the host Mailbox (lane `timer:<jobId>`). `TimerScheduler` + `createTimerMailDueHandler` replace `ScheduleJobEngine` / `JobWorker` / `job-scheduler` / `job-utils`. Kernel `ScheduleEngine` remains the clock; N retries / dead-letter stay a projection over `ScheduleExecutionQueue`. Event ingress triggers timer / event Mail. Eval Gap A `deliverTimerMailInbound` is real; harness-timer-\*×4 unskipped.

  **Breaking removals:** `ScheduleJobEngine`, `JobWorker`, and the `assistant.queue` config key. A config that still sets `assistant.queue` fails startup with a migration hint (retries are internal to `TimerScheduler`; Mailbox policy stays under `ai.agent.mailbox`).

- 4e646a2: ADR 0048 H3 eval gate: ten skipped `harness-mailbox-*` / `harness-timer-*` cases covering Mailbox admission, inbound queueing, merge window, danmaku window, interrupt/stale and `timer` Mail turns. Eval-only; no runtime behavior change.
- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
- 8de6080: Preserve the supported Cloudflare accountId field when reviewing legacy provider migrations instead of blocking it as an unmapped setting.
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

- 5ebef1a: Eval framework only (ADR 0048 H3 Gap A): `EvalInbound` is now a discriminated union with a `kind: 'timer'` inbound (`timerId`, `content`, required `owner`, optional `target`), validated by `validateEvalCase`. The driver throws a stable "timer Mail inbound not supported" error for timer inbound until timer Mail delivery is wired; H3 cases stay skipped.
- 3c3c1ee: Eval-only (ADR 0048 H3): rewrite the four still-skipped `harness-timer-*` cases onto the Gap A `kind: 'timer'` inbound shape (`timerId`, `content`, required `owner`). They stay skipped until PR-3 wires timer Mail delivery; no runtime change.
- 8de6080: Restore MiniMax and Gemini empty-reply retry presets through the supported Anthropic and OpenCode Drivers, and default DeepSeek to one same-model extra attempt. Service defaults and exact-model overrides can still disable these presets with `emptyReplyRetries: 0`. The existing precedence over global resilience settings, Driver identity checks, exploration budgets and tool execution remain unchanged.

  Preserve the model's declared thinking capability in SDK execution metadata, separately from its internal replay protocol. DeepSeek-compatible tool-call histories retain their required placeholder when a gateway omits reasoning; Google, Ollama, Anthropic and OpenAI native protocols do not acquire fabricated thinking. Real reasoning and signed/encrypted state are preserved; model capabilities are not inferred from names and no new user configuration is added.

- 8de6080: Resolve summary and perception models only when they are used. Plain chat no longer validates unused auxiliary Drivers, and a successful perception primary does not validate its backups. Compaction resolves its summary model only after finding a prefix to summarize, while retaining the current operation's graph, deployment summary source, failure handling and cancellation.

  `ModelExecutionScope.summary`, `perception` and `perceptionFallbacks` now expose declared candidates: call `resolve()` to obtain an executable model bundle. Consumers of this API must update both `@zhin.js/ai` and `@zhin.js/agent` to versions containing this changeset; older paired releases do not provide the deferred compaction execution contract.

- aa41889: Upgrade official business plugins with declarative Console pages & AI skills/tools, decompose core monolith modules, and polish scaffolding DX:

  - **Official Plugin Ecosystem Upgrade**: Add declarative Console pages (`pages/index/index.ts`), `definePluginConsoleRpc` handlers (`src/console.ts`), and progressive-disclosure AI skills/tools (`skills/<name>/tools/`) across `@zhin.js/plugin-ledger`, `@zhin.js/plugin-reminder`, `@zhin.js/plugin-rss`, `@zhin.js/plugin-calendar`, `@zhin.js/plugin-group-suite`, `@zhin.js/plugin-content-moderation`, `@zhin.js/process-monitor`, and `@zhin.js/plugin-game-hub`.
  - **Core Monolith Decomposition**: Decompose 9 core monolith modules (`agent-core-run.ts`, `full-agent-turn-engine.ts`, `ingress-route.ts`, `request.ts`, `root-runtime.ts`, `account-runtime.ts`, `page-renderer.ts`, `console-rpc.ts`, and `console-rest-pages.ts`) into cohesive, acyclic submodules (`< 620` lines each) while preserving 100% of public exports.
  - **Scaffolding & First-Screen DX**: Upgrade `create-zhin-app` and `@zhin.js/scaffold-wizard` to generate declarative `ConsolePageBlueprint` homepages and `definePluginConsoleRpc` status/ping endpoints in both `zh-CN` and `en`; upgrade `zhin new` (`@zhin.js/cli`) to include `pages/` and compile progressive-disclosure tools under `skills/**/tools/` and `agents/**/tools/`.

- 8de6080: Preserve complete environment-default API key expressions as private encrypted sources during migration and explicit credential repair. Resolve them through the Host environment store only at authorization, keep fallback values out of public metadata, and preserve account identity checks when resolved credentials change.
- Updated dependencies [3a8504b]
- Updated dependencies [d3a297d]
- Updated dependencies [c563f3b]
- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
  - @zhin.js/harness@1.0.1
  - @zhin.js/agent-feature@1.1.14
  - @zhin.js/ai@1.1.52
  - @zhin.js/core@1.1.57
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/feature-kit@1.1.13
  - @zhin.js/mcp-feature@1.1.14
  - @zhin.js/tool@1.1.16
  - @zhin.js/ai-provider@1.0.2
  - @zhin.js/permission@1.1.13
  - @zhin.js/prompt-section@1.1.13
  - @zhin.js/skill@1.1.14
  - @zhin.js/kernel@1.1.6

## 1.1.47

### Patch Changes

- ebfdafb: Generate the `platform` prompt segment from the turn's adapter capabilities (ADR 0044 C2): fixed zh/en templates for the stable part, delivery state in `scene`, adapter `profile.prompt.text` (capped at 600 chars, `external_content` for third-party adapters) and `prompt.auto: false`.
- 57661f6: core 转出 ADR 0044 能力类型（`TurnCapabilities` 等）与 `adapterFeatureId` / `isAdapterIndex`，agent 层经 core 读取，遵守依赖分层（agent 不直接依赖 adapter）。
- cbd3f14: ADR 0044 integration and C6 guard. `delivery.spool` now reproduces the pre-0044 media rule (icqq `false`, every other official adapter `true`). icqq narrows `actions.recall.others` unless the Bot is admin or owner, and declares recall for groups. Endpoint kind capabilities merge the Endpoint's `operations` (Discord reactions keep working; Discord declares reaction feedback). Adapters in the `@zhin.js/` scope are trusted: their custom prompt text is not labelled `external_content`. Core no longer keeps a telegram/discord interactive-policy table (adapters declare `segments.interactive`). New `pnpm check:no-platform-branches` blocks platform-name branches in runtime code.
- 299863a: ADR 0044 C3: runtime consumers read capabilities instead of platform names. Scene facts (group info, member profile) are queried where the profile declares `scene.groupInfo` / `scene.memberProfile`; activity feedback (reaction, typing, status message, refresh interval, quote-only delivery) follows `feedback`, `actions.reaction` and `delivery.proactive` and the per-platform table is gone; large inline media is spooled only where `delivery.spool` is declared; the sandbox ingress and its console shell follow a new additive `runtime.sandbox` capability. `defineAgentTool` and Skill frontmatter accept `requiresCapabilities` (for example `actions.mute`), evaluated against the per-turn `TurnCapabilities`, so moderation tools disappear when the Bot is not an administrator and return when it is; the icqq/qq keyword boost in tool selection is removed and the icqq group-admin tools are tagged. The `icqq` command-line special case in the exec policy is now a generic `registerSensitiveExecCommand` rule registered by the icqq plugin. `EndpointCapabilities` gains a serializable per-kind `kinds` view. Adapters without a profile keep their previous behaviour (their derived profile also reads the management ports they implement).
- aaa93d7: ADR 0044 C1: adapter capability profile spec. `defineAdapter({ profile, resolveCapabilities })` declares seven capability groups (messaging, scene, actions, events, feedback, delivery, prompt) per conversation kind with inheritance from `default`, validated at definition time. `resolveTurnCapabilities` merges the sections and narrows them (Bot role, mute state, passive window, and the adapter's narrow-only patch), and the IM ingress attaches the result to the turn input as `platformCapabilities` (`has` / `get`). A declared action without its management/control port fails at assembly. Adapters without a profile get a conservative one derived from `capabilities`, `operations` and `segments`; `segments` and `liveDanmaku` remain as aliases. No behaviour change for existing adapters.
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- 17272ec: Parse standard structured-reply prefixes incrementally within each answering attempt, reuse unchanged nodes and avoid materializing reaction-withheld bodies. Resume incremental parsing after completed signed, fractional or exponential numeric fields, while preserving SDK behavior for their partial prefixes. Preserve immediate first safe content, configured update pacing, retry/cancellation isolation and final decoder validation. Keep SDK-specific partial-JSON repair on the compatible parser path without introducing new limits or behavior defaults.
- b652db3: Keep default Database, Core and Agent declarations independent of unselected external database drivers. Memory and SQLite remain available from the root; native MySQL, PostgreSQL, MongoDB and Redis classes/configuration move to their precise `@zhin.js/database/dialects/*` entries. TypeScript `Registry.create()` callers select the corresponding dialect types, and third-party dialects augment the single `@zhin.js/database/registry` contract.

  This updates author imports: plugins using these new entries need `@zhin.js/database >=1.1.6` (pending this patch release). Built-in registration, synchronous creation, connection-time driver loading and existing Host database configuration remain unchanged. No drivers, type peers, data migration or version bump are added by this change.

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- e4d9538: Upgrade note for ADR 0044 C3 (activity feedback reads capabilities, not platform names): `@zhin.js/agent` no longer exports the per-platform `PLATFORM_FEATURES` table or the `PlatformFeatures` type. `buildTypingSendContent` now takes the conversation's capabilities instead of a platform name — `buildTypingSendContent(capabilities, options, text)`, where `capabilities` is `Pick<ActivityFeedbackKindCapabilities, 'needsReply'>` (quote the trigger message when `needsReply` is true, i.e. `delivery.proactive === false`). Code that read `PLATFORM_FEATURES[platform]` should read the adapter's capability profile (`feedback`, `actions.reaction`, `messaging.edit`, `messaging.recall`) through `TurnCapabilities` / `EndpointCapabilities.kinds` instead.
- be5c36e: 自变更跨 #1146 升级：旧版本遗留的 `applying` / `verifying` 记录若带配置补丁但缺少 `configRevision`，恢复时不再自动续作（无论是否存在配置快照或配置端口，回滚前即停止，不改动任何文件），记录转为 `failed` 并保留现场等待人工核验（补充回归测试）。配置回执出现 `restart-pending` 分组但保存结果 `restartRequired` 不为 true 时，按 `unconfirmed` 处理。文档说明 `change_config_unconfirmed` / `change_config_superseded` 下记录为 `failed`、决策事件 outcome 保持 `defer`。
- 5d12234: Self-change approval visibility follow-up (#1142): IM diff excerpts redact secret-like `key = value` / `key: value` assignments (`redactSecretAssignments`, `isSecretLikeKey`; prompt-like config paths use `isPromptPayloadKey`) and keep content lines that look like file headers; line-ending-only changes are marked; an unreadable rollback snapshot is reported instead of diffing the disk. `plugin.root.self-change-detail` returns every trial check (each redacted), redacts config values without hitting the depth limit, and no longer carries an unredacted `change.trial`.

  The Console detail diff (`files[].diff`) now goes through the same secret-assignment redaction as the IM excerpt; the scanner skips escaped quotes and redacts unquoted values past spaces (up to `,` `;` `)` `]` `}` or the line end). The nested `change.trial` is allow-listed to the documented trial fields, and `change.error` / trial check messages are redacted with the audit masking plus secret assignments.

- 44a6456: Self-change approval visibility (#1142, ADR 0040 F3): `buildSelfChangeDetailDiff` / `selfChangeDiffExcerpt` / `skippedTrialChecks` in `@zhin.js/agent`; self-change approval cards now carry a bounded diff excerpt (≤ 40 lines / 2 KB) and the skipped check names, also after `restore()`. The CLI host adds the `plugin.root.self-change-detail` Console RPC (`ops:approve` only: per-file unified diff ≤ 64 KB, redacted config values, full trial checks) and shows the excerpt plus a blind-approval warning on the IM card; `plugin.root.tool-approvals` drops the excerpt from its read-only list.
- 8be6c23: Preserve actual model error/aborted terminals, observed partial results and accumulated usage across standalone Agent tasks. Subagents and deferred workers now report those terminals as errors, and Workroom planning rejects failed responses before parsing JSON. Cancellation retains the caller's original rejection reason and exposes a copied interruption snapshot without retrying tools or changing continuation policies.

  Update synchronous subagent callers to read `spawnSync()`'s structured status/result/toolCalls/terminal outcome instead of a string. The built-in waiting tool reports the actual outcome without exposing routing metadata. A failed deferred re-completion now reaches existing main-agent failure gates, which can stop segment continuation that previously proceeded after the hidden error.

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [9e6d70d]
- Updated dependencies [4fe49b5]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
- Updated dependencies [d086ff3]
- Updated dependencies [00be764]
- Updated dependencies [8be6c23]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/tool@1.1.15
  - @zhin.js/skill@1.1.13
  - @zhin.js/ai@1.1.51
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/ai-provider@1.0.1
  - @zhin.js/agent-feature@1.1.13
  - @zhin.js/mcp-feature@1.1.13
  - @zhin.js/permission@1.1.12
  - @zhin.js/prompt-section@1.1.12

## 1.1.46

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

- af8f803: Consolidate prompt rules at the existing assembly seams: explicit authority and evidence boundaries,
  task-appropriate reply detail, conditional tool use, and memory as context rather than permission.
  Preserve the distinct delegated, scheduled, recovery and auxiliary-model contracts. Apply existing
  bootstrap scene scoping to scheduled requests using their actual turn context.

  Keep runtime permissions, approval, provider-cache mechanisms and retry configuration unchanged.
  Whole-job scheduled replay safety is documented separately and is not resolved by prompt wording.
  No existing workspace prompt files are automatically rewritten.

- 032dc96: Only replay a failed scheduled task when its actual tool calls can be proven safe to repeat. Preserve committed or unknown effects, original attempt results and canonical delivery receipts instead of retrying the whole task after an observation or notification failure.

  Add generation-owned execution history for run times, attempts, basic progress, final output and separate delivery outcomes. Use the configured file or SQL backend, retain a UTC calendar month, and expose full-scope Console read and expired-history cleanup endpoints. Deleted task definitions do not delete their execution history; unfinished records are shown as unsettled or interrupted without automatic recovery.

  Keep observation writes independent of business execution. Coalesce snapshots through one bounded owner, including audit and optional activity projections. At most 128 completed runs / 16 MiB of unpersisted terminal snapshots are retained, including an in-flight snapshot; oversized or overloaded records produce visible recording gaps and never replay work. Shutdown does not wait indefinitely for an unabortable observation write.

  The optional internal Tool effect reporter grants no authority and does not require a plugin API floor change. Existing tools continue to work without it; undeclared effect safety is not inferred from their names or returned text. The Console execution-history UI requires the corresponding new Host endpoints; this changeset does not publish or deploy either application.

- Updated dependencies [b88e988]
- Updated dependencies [c15cef9]
- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [3c1912f]
- Updated dependencies [032dc96]
  - @zhin.js/adapter@1.1.27
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/core@1.1.55
  - @zhin.js/tool@1.1.14
  - @zhin.js/ai@1.1.50
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/agent-feature@1.1.12
  - @zhin.js/mcp-feature@1.1.12
  - @zhin.js/permission@1.1.11
  - @zhin.js/prompt-section@1.1.11
  - @zhin.js/skill@1.1.12

## 1.1.45

### Patch Changes

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- 6749002: Keep interactive runtime turns and their synchronous children running without fixed iteration or total wall-clock caps. Share configured token quotas across the live turn, retain cancellation and authorization, compact child context independently, and report periodic progress without additional model calls or blocking final delivery. Scheduled, unattended, independent background and legacy API budgets remain unchanged.

  Stabilize prompt prefixes by keeping conversation identity in the session-stable system tail and fresh scene state after the current message. Shorten and escape the host-context boundary, preserve permission-filtered tool disclosure, and omit fixed iteration ceilings from continuous-run traces.

  Project repeated inspections of the same private image only once per model request, preserving resource access checks, transient lifetime, and the existing inspection limit.

- fc33495: master 私聊审批改为先问人：`masterShell: isolated` 不再把审批强制成 `auto`，新增 `ai.agent.masterShellApprovalMode`（默认 `ask`，可选 `auto` / `inherit` 沿用 `execApprovalMode`）；master 私聊中自动审核拒绝会转问 master；群管冷却不再作用于私聊；拒绝提示与安全提示词要求在 master 私聊里请求批准而不是放弃。
- 2c3610a: Add owner-scoped personal AI Sessions and a closed model policy hierarchy. Compile legacy providers and bindings into immutable, revision-leased connection/model/preset invocations while keeping Agent tool authority separate.

  Provide authenticated personal model management, encrypted Host-private credentials, public HTTPS transport with DNS pinning and same-origin redirects, and persistent per-Session model selection. Deployment tasks and summaries retain deployment model authority. Preserve legacy history and configured perception fallback chains. Keep every chat turn on its selected model, including legacy configuration, while retaining same-model retries.

  Extend trusted Host generation leases to resolve Root-private resources without publishing them in snapshots or child Plugin Scopes.

- 4949b90: Preserve participant text and media boundaries when appending runtime context, anchor Anthropic caching before transient media, escape quoted host markers, and keep specialist selection out of the stable capability prefix.
- 4c05a4e: 提高跨轮提示词缓存命中率：当前消息的运行时上下文（会话规则、记忆、技能、场景行、延迟工具索引、Turn context 等）移到正文之后，正文与日后的历史逐字节一致；系统稳定前缀不再随发送者角色变化；场景行 admins 排序稳定（ADR 0045）。
- 4042a72: 去除 discover 工具结果正文中重复的完整参数 schema，减少后续模型请求携带的重复历史。保留匹配工具的自动加载、权限、加载上限与稳定顺序，完整定义仍通过下一次请求的 tools 字段提供，无需增加 load_tool 调用。
- f8505b0: Recover completed Sandbox output from the existing journal with separate scoped delivery facts. Preserve confirmed, partial and unknown delivery, including interrupted final projection, without resending output or changing journal retention. Read results in pages of fifty; media recovery stores authorized URL references rather than bytes.
- f1d4d66: Record the authorized target of successful file writes and edits in their tool settlements. Project file links through the current Host's existing file-manager policy, so Console can open the actual file without inferring its identity from raw model arguments or tool output text.
- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [6749002]
- Updated dependencies [c7944a5]
- Updated dependencies [f8505b0]
- Updated dependencies [fc33495]
- Updated dependencies [2c3610a]
- Updated dependencies [4949b90]
- Updated dependencies [4c05a4e]
  - @zhin.js/adapter@1.1.26
  - @zhin.js/core@1.1.54
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/ai@1.1.49
  - @zhin.js/agent-feature@1.1.11
  - @zhin.js/mcp-feature@1.1.11
  - @zhin.js/prompt-section@1.1.10
  - @zhin.js/skill@1.1.11
  - @zhin.js/tool@1.1.13
  - @zhin.js/permission@1.1.10

## 1.1.44

### Patch Changes

- c58c589: Group deferred tools by their canonical plugin or MCP server instead of installation paths. Omit already represented delivered text and ledger facts only from the current model projection, preserving full history and restoring facts when their covering reply leaves the active context. Allow tools to declare a synchronous, read-only availability predicate before turn disclosure, with execution-time checks remaining authoritative.

  Preserve every confirmed platform message identity across Agent replies and ICQQ split sends. Give each bubble its own stable single-message alias while retaining the reply's ordered association; preserve confirmed prefixes on partial delivery without retrying or inventing unknown message IDs.

- Updated dependencies [6345a38]
- Updated dependencies [ff3efe7]
- Updated dependencies [c58c589]
  - @zhin.js/adapter@1.1.25
  - @zhin.js/ai@1.1.48
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/tool@1.1.12

## 1.1.43

### Patch Changes

- e0f991c: ADR 0039 slice A: add the `ai_group_rules` table and `AiGroupRules` store for dynamic group-ops rules — `draft → pending → active` with `rejected` / `expired` / `disabled` side states, optimistic `revision`, a canonical `content_hash` (any edit returns to draft), at most one active rule per group and trigger (approving a new one supersedes the old), and 24 h approval expiry. Adds audit kinds `group_rule` / `rule_enforcement` and the `rule_*` reason codes. Storage is bounded: per-field limits, at most 20 open drafts per group, terminal rows lose their summary immediately and are deleted after 30 days or beyond 50 per group (on startup and hourly). No behaviour change yet: drafting tools, approval cards and the executor land in later slices.
- 8846d5d: ADR 0039 slice B: group owners and admins can now set group moderation rules. A new `rule_draft` tool (`risk: safe`, group chats only) turns "remind advertisers first, then mute for 10 minutes" into a rule and submits it for approval; it refuses anyone who is not the group owner or an admin (by the live platform role on the message) and records `rule_draft_forbidden`. Each submitted rule posts a preview card to its group (trigger, ladder, durations, cool-down, exemptions and a short `content_hash` code), gated by the control plane. In the group, the owner/admins (plus `toolHardGate.imApproval.approverIds`) answer with `/rule approve <code>` / `/rule reject <code>` / `/rule disable <code|trigger>`, and anyone can list rules with `/rules`; the code changes whenever the rule changes, so an old card can't approve new content. The Console gets `plugin.root.group-rules` / `group-rule` (read, `control:read`), `group-rule-create` / `group-rule-disable` (`control:write`) and `group-rule-approve` / `group-rule-reject` (`ops:approve`). `AiGroupRules` gains `onTransition` listeners and `recordDraftForbidden`. No new disk state: rules use the existing bounded `ai_group_rules` table. Rules are not enforced yet; the executor lands in slice C.
- 8c85a2b: ADR 0039 slice C: approved group rules are now enforced. A new host-side `GroupRuleEnforcer` (reached through `AgentTurnIngressRoute.enforceGroupRule`) takes a reported violation and runs the current stage of the group's active rule for that trigger: `remind` / `warn` send a template reminder that @-mentions the member (control plane + session profile gated, optional recall of the original message); `mute` runs automatically with **no approval card**, using the rule's approval as the hard-gate approval (`ToolHardGate.checkPreApproved` now accepts `source: 'rule'`, reports `rule_hash_mismatch` for a tampered rule, and passes `ops_cooldown` when the gate has one), still stopped by `emergency_stop` / `read_only`; `suggest_kick` never kicks by itself — it raises a fresh `member` hard-gate card (deduplicated by `ops_cooldown`) and kicks only after a human approves. Owners/admins and whitelisted members are skipped (`rule_hit_exempt`); when the bot cannot moderate, it records `rule_hit_bot_not_admin` and tells the group once a day. Every hit writes one `kind=rule_enforcement` audit row that shares its `turn_id` with the hard-gate and outbound rows. Ladder progress is in memory only, capped and pruned after the quiet window; nothing new is written to disk. No detector calls the enforcer yet: `flood` (slice D) and the content-moderation migration (slice E) come next.
- 2cc80df: ADR 0040 slice A: self-change staging area `.zhin/changes/` — change object, forward-only state machine, `content_hash`, writable-target whitelist and forbidden config keys, `self_change` audit kind and `change_*` reason codes. Disk use is bounded (terminal states drop staged files, 14-day metadata retention, 24-hour idle expiry, 5 MB / 50 files per change, 50 MB total) with pruning at start-up and every 6 hours.
- 97bf337: ADR 0040 切片 B：`change_draft` 工具起草受控自我变更（只进暂存区，不生效），宿主生成预览——文件 diff 摘要、`InvalidationPlanner` 影响面、配置补丁重载级别（宿主段需重启、插件段热重载）。
- 43560d0: ADR 0040 切片 C1：`change_draft` 起草后宿主自动试跑静态检查（语法 / 约定默认导出 / harness 禁止导入 / SKILL.md 与 agent.json），通过进 `ready`，失败进 `trial_failed` 并把错误交回 Agent；`.tsx` 用 esbuild 检查，全程内存、不落临时文件。
- 1bf0253: ADR 0040 切片 C2：试跑沙箱加载（§3.3）——静态检查通过后把草稿所在插件根拷到系统临时目录、在一次性子进程的试跑运行时（只装 IM 运行时，无端点、无模型、无令牌，60 秒超时杀进程组）里装配，校验 `sandbox_load` 与 `capability_discovered`；拷贝用完即删，崩溃残留 1 小时后清理。同时补上 `stripComments` 的线性扫描（CodeQL js/polynomial-redos，#1064 合入时漏掉），指令目录里的非 `index.*` 辅助模块不再要求默认导出 `defineCommand`。
- ee9d38a: ADR 0040 slice C3: the self-change trial runs the drafted plugin's own tests in an isolated, offline container (read-only dependencies, writable throwaway copy) after the sandbox load; skipped without Docker, without tests, or when the tests fail even without the draft.
- eb306e1: ADR 0040 slice D: a self-change that passes its trial is submitted for approval as a `self` card in the hard-gate approval queue — always delivered to the owner's private chat (never settled in a business group), human-only, bound to the content hash, one pending change per conversation, 24-hour timeout, re-issued after restart; Console lists, approves and rejects changes.
- b76317d: ADR 0040 slice E1: add `SelfChangeApplier`, the apply / verify / rollback core for approved self-changes. It re-checks the approved `content_hash` (re-hashing every staged file) and the config `expectedRevision` before touching anything (mismatch → `failed`, no files written), writes the rollback snapshot and persists `applying` + report target before writing production files, then applies by impact — `none`, hot reload, or a controlled restart after persisting `verifying`. A 60 s health check decides `applied` ("已生效"); otherwise it rolls back once and reports "失败，已回滚", and if still unhealthy goes `failed` with `emergency_stop` and an owner-only report — at most two restarts per change. `recover()` resumes `applying` / `verifying` changes at start-up. `SelfChangeStore` gains `writeSnapshot` / `readSnapshot` / `setApplyState` / `audit`, and `SelfChangeApprovals` an `onApproved` hook. Host wiring (reload, exit 75, health, reporting, start-up recover) follows in slice E2.
- c9775fb: ADR 0041 slice D: system prompt assembly now runs on a `PromptSegmentRegistry`. Built-in sections map onto text segment kinds (`system` → `environment` → `role_rules` → `platform` → `scene`, descending weight within a kind), so the persona/style rules now follow the security rules instead of leading the prompt, and the volatile git status moves into `scene`. Plugins contribute segments through `promptSegmentToken` (released with their generation); `mergeMessageSegments` is the pure chronological merge for message segments (tie order, tool pairing, event relocation, append-only). `PromptAssemblyRegistry` is a deprecated adapter over text segments. `describePromptSectionsForDebug`, the context-budget report and `zhin trace` list each segment's id / kind / weight / chars / trimmed. `buildRichSystemPromptParts` exposes the stable prefix and `scene` split (cache breakpoint offset).
- 5efb4e9: ADR 0041 §6: two-level cache for group info and member profiles. Level 1 stays the in-memory 60 s cache; level 2 is the database. Facts are read L1 → L2 → platform and every platform result (and every side event) is written to both levels; the bot's own role is still read fresh each turn and only written through. A level-2 row older than 24 h is served and refreshed once in the background (de-duplicated, bounded concurrency, cancelled with the generation). Group facts extend `ai_session_profiles` with `owner_id`, `member_count` and `facts_updated_at` (additive migration); member facts live in the new `ai_scene_members` table. Storage is bounded: a member row is deleted on leave or kick, rows untouched for 90 days are pruned, each scene keeps at most 2000 rows (oldest `updated_at` evicted), pruning runs at startup and every 6 hours, and stored text is cleaned and capped at 128 characters.
- b5071e7: ADR 0041 slice A: participant headers. The trusted host stores the full `[id:…;user_id:…;name:…;role:…;group_nickname:…;group_title:…;mute_time:…;time:…;]` header in `UserMessage.name` / `AssistantMessage.name` (built from the conversation actor and the turn's bot facts, never from model output). At the LLM boundary `projectPromptContext` now sends the full header on a `user_id`'s first appearance in the visible window, the short `[id;user_id;time]` form afterwards, and synthesizes a `member_changed` event before a message whose sender facts changed without a recorded event; the header is the first line of the text and stored history is never mutated. Replaces the `[User]{…}` JSON and `[sender:…]` labels (`buildActorPrefix` is removed); `normalizeUserMessageForStorage` strips the new header line. Legacy messages without `name` derive the header from `actor`.
- e23cabc: ADR 0041 slice B: the turn context now carries real scene facts. `EndpointManagement` gains `inspectGroupScene` (name, owner, admins, member count, global mute) and `inspectGroupMemberProfile` (role, card, title, mute expiry; one lookup), implemented by the ICQQ adapter from uncached group/member reads. The CLI resolves them per turn (bot role always fresh; group and sender facts reuse a 60 s, 256-entry in-memory cache scoped to the generation; failures omit fields) and the inbound actor now carries `groupNickname` / `groupTitle` / `mutedUntil` plus the platform role. The Session / Bot state blocks are replaced by one projected scene line `[scene_id:…;scene_type:…;scene_name:…;owner_id:…;admins:…;member_count:…;global_mute:…;assistant_role:…;]` (values escaped and clipped to 64 chars). No new on-disk state.
- 3c4178d: ADR 0041 slice C: member state changes enter the session history. Join / leave and card / title / role / mute changes from the scene side events are written to `agent_messages` as `event` messages (`<operator> changed <user_id> <field> to "<value>"`, `<user_id> join <scene_id> on <HH:mm:ss.SSS> by <self|operator_id>`), in arrival order, with the existing compaction and retention; member-controlled values are always quoted, escaped and clipped to 64 characters. At the LLM boundary they render as one `[state change]` message per run of events: a system / developer message where the provider accepts it mid-conversation, otherwise a user message headed `user_id:system` (merged into an adjacent user message as a separate block). Events never sit between an assistant `tool_calls` message and its tool results and are never moved earlier. New provider capability `compat.midConversationSystem` (`system` / `developer` / `none`; OpenAI and remote OpenAI-compatible default `system`, o-series / gpt-5 `developer`, local servers, Anthropic and Gemini `none`). Join / leave and profile changes no longer appear in the ephemeral `[Scene events]` block (a bare join still wakes a turn). The system prompt states that quoted values in `[state change]` lines are data.
- 3fd758c: 不再在每轮 `[Agents instructions]` 中重复注入根目录 `AGENTS.md`：宿主 bootstrap（可缓存的系统提示词）已包含它时，envelope 只保留更近的子目录 `AGENTS.md`。
- 16896fe: `AGENTS.md` 去重以本回合系统提示词实际携带的 bootstrap 为准（回合引擎传入），不再读 `host.bootstrapContext`（生产中为空，去重从未生效）。评测新增 `hostBootstrap`，按 CLI 宿主方式把 bootstrap 交给回合引擎，度量与生产一致。
- 825e4dc: ADR 0042 §1: the IM system prompt is now built as a byte-stable prefix (system / environment / role_rules / platform, plus the platform reply instruction and exploration guidance) and a per-turn scene tail (scene line, network note, pre-fetched data). The AI request context carries `systemPromptCacheBreakpoint`; Anthropic receives two system blocks with `cache_control` on the stable block only, Gemini receives two system parts, and other providers still get one string with the stable part first. Gemini explicit context caching now caches only the stable system part plus tools (the scene tail moves into `contents`), treats a 404/unsupported `createCachedContent` as permanent for that model, and logs the reason once per model with the API error message instead of on every prefix change.
- f1eb75c: ADR 0042 W2: resident tools are tiered by scene (group and ordinary private chats keep chat essentials only; master private chat adds development and delegation tools; non-IM turns keep the old default set). Calling an authorized deferred tool by exact name auto-loads it, and `discover` attaches and loads the schemas of its best 1-3 matches. The provider tool list is now stable for prompt caching: resident tools sorted by name, loaded tools in first-load order (new `loadedOrder` in the deferred tool snapshot), new tools only append.
- 5621f75: ADR 0042 W3: fold the resident catalogs. The deferred tool index is one line per domain (MCP server, else owning plugin / builtin area) with up to 6 sorted tool names and the total count, e.g. `calendar: calendar_add, calendar_list (2)`; details come from `discover`. The skill catalog keeps the skill name plus one trigger sentence of at most 40 characters (full description at `load_skill` / `discover`) and is sorted by name so the block is byte-stable. Providers that use prompt-mode structured output (DeepSeek, `compat.structuredOutput: 'prompt'`) now get a compact shape (one example plus one data-shape line per offered segment type, derived from the schema) instead of the full JSON Schema text; native providers still receive the schema as an API parameter and `decodeStructuredReply` still validates with it. `@zhin.js/ai` exports `registerStructuredOutputPromptText`.
- 88c82d0: ADR 0042 W4: bootstrap section scopes. A section of `AGENTS.md` / `SOUL.md` / `TOOLS.md` can carry `<!-- scope: group -->` (also `private`, `channel`, `master`, `master-private`, comma lists) on the line under its heading; the host injects only the sections matching the turn's scene (conversation type + master or not), byte-stable per scene kind. Unannotated sections apply everywhere. `zhin trace` lists skipped section titles (`bootstrap_skipped`).
- e37f30f: ADR 0042 §7/§8 (fewer rounds, measurement). Default `maxIterations` now depends on the scene: group chat 6, private chat 10, master private chat 15 (a `modelHarness` override or a customised `ai.agent.maxIterations` still wins; built-in per-model limits are never raised). When one iteration remains, the tool result tells the model to reply with what it has. A one-time hint fires when the same tool family is called 3 times in a row without new information (identical results, searches that match nothing, the same file re-read), recorded as `spin_hint` / `last_iteration_nudge` entries on the turn trace. The orchestration rule merges "send independent queries as parallel tool calls in one message" into the existing parallel `spawn_task` bullet (net size unchanged). Adds `pnpm eval:budget`: a deterministic offline first-turn token measurement (group first turn, group 6th turn, master private tool turn) with a committed baseline.
- 2b8b408: ADR 0043 §1 (H1): history stores conversation only. Per-turn context blocks (`[Turn context]` with time, told ledger, recalled memory, tone hint, merged-turn and danmaku lines; `deferred-tools`, `workspace-rules`, `skill:*`, `file-memory:*`, `session-rules:*`, `session-guidance`, `session-identity`, `active-skills`, `deferred-catalog-summary`, `quote-guidance`) are now marked `perTurn` when built and dropped by `normalizeUserMessageForStorage`; the current message sent to the model is unchanged. `projectPromptContext` also strips them (identified by flag, contextRef key or legacy text prefix) from every earlier user message, so rows stored before this change stop replaying them; stored data is never rewritten.
- 4d728c0: ADR 0043 §4 + §5 (H4) and the ADR 0041 actor-only amendment. Participant headers are no longer stored: user messages keep only `actor`, assistant messages keep `assistantActor` (plus the delivered `messageId`), and the header is rendered at the LLM boundary; legacy rows that still carry `name` are read as before. Headers now use session message aliases `id:m<n>` (an ordinal over the stored active path, so already-sent prefixes never change), `time:HH:mm` shown only when a minute has passed since the last shown time (the first message and the first message of a day also carry `date`), and `reply_to:m<n>` when the message replies to one inside the visible window. A reply to a message outside the window gets one `[quote id:…;user_id:…;time:…;] <first 120 chars>` line (media as placeholders, a forward expanded one level) so the model no longer needs `inspect_conversation_reference` for ordinary quotes; the quote is resolved by the ingress through the reference port (3 s timeout) and stored as structured `UserMessage.quote`. Tool arguments named `message_id` / `message_ids` / `*_message_id` / `reference` and `reply` segments accept the alias as well as the platform id; `inspect_conversation_reference` also accepts the quoted message id.
- eb8feeb: Isolated shell (docker, workspace-write) now mounts host self-configuration paths (#1030 list A+B: AGENTS.md, skills, .git, package.json, lockfiles, node_modules, root config, ...) read-only on top of the writable workspace, so shell tricks cannot rewrite them. Protected paths are carried on the Tool invocation policy.
- f0e1df7: Group merge window (ADR 0038 slice A): with `ai.agent.inboundQueue.merge.enabled`, plain-text mentions from several group members within a short window (`quietMs` 1500 / `maxWaitMs` 6000, up to `maxSenders` 5) are answered by one turn instead of one reply each. Off by default until merged turns narrow permissions per sender. The master, private chats, commands, stop words and messages with media, quotes or forwards keep their own turns. New audit codes `merge_window_joined` / `merge_window_flushed` (plus the other ADR 0038 codes reserved for later slices).
- 7f34293: Merged turns narrow permissions to every sender (ADR 0038 slice B1): when a group merge window answers several members in one turn, the tools, skills and sub-agents the model sees are the intersection of what each member sees on their own, and the turn's roles and permissions are intersected as well. Merging can only narrow what a turn may do, never widen it. `ai.agent.inboundQueue.merge.enabled` stays off by default until slice B2 (`onBehalfOf` review and approval-card limits).
- d9672ec: ADR 0038 切片 B2：合并回合里有副作用的工具调用按 `onBehalfOf` 指向的发送者复核（缺省按权限最低者），不通过写 `merge_on_behalf_denied`；合并回合最多 1 张新审批卡；新增 `ai.agent.toolHardGate.maxPendingPerScene`（默认 3），每群待审卡超限 fail closed（`hard_gate_scene_pending_cap`）；群聊合流 `inboundQueue.merge.enabled` 默认改为开启。
- 42e630d: ADR 0038 slice C: a merged group turn now tells the model who it is answering. The turn context carries a `[Merged turn]` list (sender id, name, message ids, text) and asks for one reply that @-mentions each sender it answers and skips nobody by pretending; the outbound audit records how many senders were merged and how many the reply answered.
- 1096173: ADR 0038 slice D: before sending, a turn whose sender followed up into a merge window drops its stale reply (audit `merge_reply_stale_discarded`) and the next merged turn answers old and new messages together; replies of turns that called a tool or hit the hard gate, and a sender chain already dropped once, are sent anyway (`merge_reply_stale_sent`).
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- 119e9e6: ADR 0043 §2/§3: the history sent to the model is bounded by a token budget (`ai.context.historyTokens`: group 8000, ordinary private 12000, master private 24000, a number for all scenes or per-scene overrides, `0` = off; `ai.context.maxRecentMessages` stays as a message-count upper bound). The budget is measured after projection, the window starts on a turn boundary, and it only moves — in one block leaving 25% headroom — when the budget is exceeded, so the prompt-cache prefix stays stable. Tool results of finished turns (and very long call arguments) reach the model as their first 200 characters plus `…(已省略 N 字)`; the current turn and stored history are unchanged.
- 8ce6cd2: Project repeated file-memory snapshots through scoped context references while preserving full stored snapshots, neutral versions when no snapshot is supplied, and recovery after compaction or branch loads.
- f2bbab5: Stop the bot from reacting with an emoji on every turn. The structured-reply instruction now says reactions are occasional (`""` is the default), and the host paces reactions per session: at most one per `ai.agent.reactions.cooldownMs` (default 10 min) and only with `probability` (default 0.35; 0 disables). Paced-out reactions are not sent, count as handled, and are audited as `{ reaction: true, applied: false, paced: true }`. Memory only, bounded to 1024 sessions.
- 44eb3f8: Align the host self-configuration hard gate with the final #1030 P0 spec. `node_modules/**` (any depth), package-manager lockfiles and the plugin lifecycle file are now denied outright for every role, with no approval card. The `self` hard gate is anchored to the project root (symlink-, `..`- and case-safe) and covers the root config files, `package.json`, `schema.json`, the root plugin entry, `AGENTS.md`, the skills directories, `.git/`, `.pnpmfile.cjs` and `assistant.profile.yml`; nested files such as `plugins/x/package.json` are no longer gated, and `pnpm-workspace.yaml` / `tsconfig*.json` are not managed. The host provides the project root and extras per generation through `hostProtectedPathsToken` (carried on each Turn); without it the gate fails closed to name matching at any depth.
- ab2263a: Gate writes to the host's own configuration with the dangerous-tool hard gate (#1030 P0). A file-tool call that writes `zhin.config.*`, `.env*`, `package.json`, lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `assistant.profile.yml`, `node_modules/` or `.git/`, and a `bash` command that writes one of them or changes dependencies, is now a dangerous `self` call: it needs a fresh human approval every time, and bypass, the auto reviewer, owner exemption and remembered approvals never grant it.
- dfa14b5: 修复 CodeQL js/polynomial-redos：`ai.context.historyTokens` 字符串解析先去掉空白、限制长度，再用无重叠量词的正则匹配。
- b223a51: Record redacted model inputs per request for local conversation traces, with reported usage kept separate from context estimates. Preserve trusted conversation and source-message identity, expose details through full-scope read-only Console APIs, and enforce bounded trace retention. Request-body recording is enabled by default and can be disabled with `ai.agent.recordRequestBodies: false`.
- d0e1fac: Keep stable prompt instructions ahead of turn-specific capabilities, project unchanged context without placeholder text, and retain scoped state snapshots with readable updates and compaction recovery. Preserve native conversation/tool chronology and separate participant identity from runtime guidance.

  Resolve the ICQQ bot account and current-group role before capability discovery, and support explicitly declared current-conversation bot-role requirements without changing existing requester permissions or approvals. Keep role lookup failures unknown and preserve execution-time platform checks.

- 1ca669a: Read complete retained user-message text on demand through the existing session-tree runtime and `GET /api/agent/sessions/:key/message`. Bind each read to the tree's session ID, reject cross-session/non-user messages, and return text without image payloads. Keep tree previews unchanged and report older runtimes without message reading as unsupported.
- Updated dependencies [f67883e]
- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [945303c]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/ai@1.1.47
  - @zhin.js/adapter@1.1.24
  - @zhin.js/tool@1.1.11
  - @zhin.js/im-contract@1.1.8

## 1.1.42

### Patch Changes

- 5be6f3a: Add optional public R2 publishing for generated and outbound inline images, plus approval-gated workspace image uploads. Keep image bytes out of tool results and subsequent context when storage is enabled.

  Keep MCP image originals in a scoped local store with seven-day retention and bounded capacity. Expose on-demand inspection through `get_local_assets`, projecting images only into the next model request and sharing perception limits with authorized child turns.

- 334e92d: 公告：草稿 → 审批 → 发送（ADR 0037 第 1 期切片 B）。

  - 新表 `ai_announcements` 与 `AiAnnouncements`：状态只前进 `draft` → `pending` → `approved` → `sent`，旁路 `rejected` / `expired` / `failed`；`revision` 乐观并发；改正文回到 `draft` 并重算 `content_hash`；待审批默认 24 小时超时。
  - 新工具 `announcement_draft`（`risk: safe`）：模型只能建草稿，不能提交、审批或发送。
  - Console `plugin.root.announcements` / `announcement`（读）与 `announcement-create` / `-edit` / `-submit` / `-approve` / `-reject` / `-resend`（动作，暂用 `control:read` / `control:write`）。
  - 批准即发送：摘要复核 → 控制面 → 会话画像 → 硬闸以公告审批记录作批准（`ToolHardGate.checkPreApproved`，不弹第二张卡）→ `EndpointManagement.sendGroupNotice`（icqq / napcat）。被拦或失败置 `failed`，不自动重试；重发回到 `pending` 需再批一次；摘要不符拒绝（`announcement_hash_mismatch`）。
  - 审计追加 kind `announcement` 与码 `announcement_drafted` / `_submitted` / `_approved` / `_rejected` / `_expired` / `_sent` / `_send_failed` / `_resend` / `_hash_mismatch`。

- 0bdd5df: 冷场 → 会话临时 `mention_only`（ADR 0037 第 1 期切片 C，§1.3）。

  - 会话运营配置新增 `coldField.enabled`（默认关，只能按会话打开）/ `coldField.threshold`（默认 20）/ `coldField.durationMs`（默认 30 分钟）；读库失败时视为关闭。
  - 只统计群消息：未点名且旁听判定不参与计 1；点名、旁听参与、Bot 主动发言（scene event 唤醒、模板欢迎、公告）清零。命中阈值给该会话加控制面临时 `mention_only`（`actor=policy`、`expiresAt`），到期自动撤销。
  - 临时覆盖与运营者手动覆盖分存、只会更严、不进 `revision`，在 `control` 查询的 `temporary[]` 里可见；`control-set` 显式写 `mention_only: false` 时一并清除。计数与临时覆盖只在进程内存。
  - 审计复用 `control_change` / `control_gate`，追加码 `cold_field_mention_only_on` / `cold_field_mention_only_expired` / `cold_field_mention_only_cleared`；决策回放 `decisions` / `decisions-export` 新增可选 `reasonCode` 过滤（`DecisionEventQuery.reasonCode`）。

- 08e64de: Shorten operation confirmation prompts: display action descriptions and exact arguments, omit internal approval-policy boilerplate, and render choices once with their existing authorization scopes visible in the labels.
- 291cf6e: 控制面四开关（ADR 0036 切片 D）：`emergency_stop` / `muted` / `read_only` / `mention_only`。

  - 两级：实例默认 + 会话覆盖（`platform + scene_id`），会话覆盖只能更严；生效顺序 `emergency_stop → 实例 muted → 会话 muted → read_only → mention_only → 常规策略`，先命中先返回。
  - 接入 IM 入站、旁听、scene event 唤醒（位于 #995 会话画像发言判定之前，拦下时不调模型），回合中途变更时回复 / scene event / 主动出站在发送前再判一次止损类开关。
  - Console `plugin.root.control`（`control:read`）/ `plugin.root.control-set`（`control:write`，必须带 `expectedRevision`，不符返回 conflict）。拦截写 `control_gate`，变更写 `control_change`（`actor=operator`，前后值）。
  - 持久化到新表 `ai_control_state`；读不出时 fail closed（按 `emergency_stop` 处理）并拒绝写入，直到重新读成功。模型没有任何工具能读写这些开关。

- ff87195: 决策审计 Console 回放（ADR 0036 切片 C）：

  - Host 新增只读查询 `plugin.root.decisions`（倒序列表，按平台 / 会话 / kind / outcome / 时间过滤，`nextBefore` 翻页）、`plugin.root.decision-turn`（按 `turn_id` 展开时间线）、`plugin.root.decisions-export`（时间窗导出 JSON，字段与表结构一致，`nextSince` 分页），都需要 `decisions:read`；入口在「机器人状态」页。
  - `DecisionEventLog` 增加 `query` / `turn` / `prune` 读取与保留期清理；新增配置 `ai.audit.retentionDays`（默认 14 天），启动时与之后每小时清理过期行，并为 `ts`、`turn_id` 建索引（SQLite / MySQL / PostgreSQL）。
  - 不含控制面开关（切片 D）与危险工具硬闸（切片 E）。

- d6158d5: 新增决策审计表 `ai_decision_events`（ADR 0036 切片 A，只有表结构与码表，尚无写入）：

  - 字段与 ADR 一一对应：`id`、`ts`、`turn_id`、`instance_id`、`platform`、`scene_id`（与会话画像 `scene_key` 同口径）、`user_id`、`kind`、`outcome`、`reason_code`、`reason_detail`、`payload`、`actor`、`actor_id`；随 AI 持久化表一起注册，append-only。
  - `kind` / `outcome` / `actor` 枚举与 `reason_code` 码表集中定义；码表外的值一律记为 `unknown`，原值写进 `reason_detail`。
  - 序列化时 `reason_detail` 截到 200 字，`payload` 去掉密钥、Cookie、token 与完整提示词；`actor=operator` 必须带 `actor_id`。

- d507e5f: 决策审计开始写入 `ai_decision_events`（ADR 0036 切片 B，写路径埋点）：

  - 每条 IM 入站与每次 scene event 唤醒按回合写 append-only 记录，同一回合共享 `turn_id`：入站唤醒（`inbound_wake`）、会话画像不能发言（`speak_gate` + `model_skip`，码 `cannot_speak_muted` / `cannot_speak_muted_all` / `cannot_speak_restricted`，scene event 唤醒同码）、旁听判定（`ambient_decision`）、scene event 无新内容（`scene_event_nothing_new`）、模型调用摘要（`model_run`：模型、耗时、状态、是否发言，不记提示词）、出站（`outbound`：已发 / 抑制 / 失败）。
  - 码表追加写路径用码（只增不改）。
  - 审计写失败只记日志，不阻断、不拖慢回合；现有日志不变。

- cffaa8f: 危险工具硬闸与群管工具对齐（ADR 0036 §2/§3、ADR 0037 §3，#1011 G1–G3）：

  - 改他人群名片归 `member`：新增 `set_group_card`；场景管理通用工具 `{prefix}_set_nickname`（`setMemberNickname`）改归 `member`。Bot 自身改昵称请用 `set_self_nickname` / `set_bot_nickname`（`identity`）或声明 `riskCategory`。
  - 核心名单按 `{prefix}_{suffix}` 后缀匹配（至少两段），补齐场景管理通用工具 `remove_member` / `ban_member` / `unban_member` / `set_moderator` / `rename_scene` / `set_scene_muted`，以及 `set_group_name` / `set_anonymous`。
  - 硬闸接入控制面（#1008）：会话处于 `emergency_stop` / `read_only`（含状态不可用）时危险工具在弹审批之前直接拒绝，审计 `tool_hard_gate` + `control_emergency_stop` / `control_read_only`；`muted` 不拦硬闸管理工具。

- a3b636d: 危险工具硬闸 IM 审批通道（G6，#1013）：`ai.agent.toolHardGate.imApproval`，默认关闭。

  - 配置：`enabled`、`approverIds`（扁平列表或 `platform → userIds`）、`delivery: dm | approver_group`、`approverGroupId`（审批群模式必填，且不能是业务会话）。
  - 新审批卡片经触发调用的 Endpoint 私聊投递给 allowlist 审批人（或发到专用审批群），内容含工具、类别、会话、脱敏参数摘要、卡片 id、过期时间；投递失败不重试，卡片照常留给 Console、超时拒绝。
  - 审批人私聊 `/approve <id>` / `/deny <id>` 结算同一个 `ToolApprovalQueue`，与 Console 先到先得；群 / 频道消息与触发会话一律不能结算；仍是 humanOnly、一次一批，不提供本会话 / 永久授权，`bypass` 与审核 Agent 不能放行。
  - 审计：`tool_approval` 结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group` / `turn_prompt`），IM 操作者记 `actor_id = im:<platform>:<userId>`；Console 审批卡片 RPC 返回 `channel`。

- 08e64de: Expose current ICQQ conversation and bot-role inspection through a private Agent skill. Add conversation-scoped quote, merged-forward, own/member recall, and owner-approved leave-group tools with live platform checks and documented guild-channel limitations.

  Include real message IDs in the existing turn and conversation context so message operations can target actual messages without guessing.

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- 7595136: Upgrade `nodemailer` to 10.1.4+ and `js-yaml` to 5.4.1+ to clear security advisories.
- e7b72a4: 群管冷却与 `ops:approve` 审批权限（ADR 0037 第 1 期切片 E，§3）。

  - 会话运营配置新增 `ops.cooldownMs`（实例默认 60 秒 + 会话覆盖，`0` 关闭）；同一 `platform + scene_id + 工具名` 在冷却期内只能发起一张硬闸审批卡。冷却记录为进程内，重启清空。
  - 冷却判定在控制面之后、生成新审批卡之前：命中不入队、不弹卡，本回合同类危险工具 latch，模型收到"冷却中、勿重试/换工具"说明。冷却表自身出错时不拦（冷却是节流不是授权）。
  - 审计新增 kind `ops_cooldown` 与码 `ops_cooldown_passed` / `ops_cooldown_hit`；命中同时写一条 `tool_hard_gate` 拒绝，回放串成一条链。
  - Console 新权限点 `ops:approve`：结算硬闸审批卡（与旧的 `tool_approvals:resolve` 任一即可）、读审批卡（与 `tool_approvals:read` 任一即可），以及公告 approve / reject / resend（不再接受只有 `control:write` 的令牌）。
  - `PluginConsoleRpcMethod` 新增可选 `anyOfPermissions`：持有其中任一权限即满足，对动作算作方法自身的要求。

- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

- dcd4982: Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
- 69f9ef6: Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
- 9dfdaf4: 会话日程 `ai_session_events` 与到点提醒（ADR 0037 第 1 期切片 D，§2）。

  - 新表 `ai_session_events`（`revision` 乐观并发）与存储 `AiSessionEvents`：`at` 本身总会提醒，`remind_before` 追加提前量；已触发的偏移记入 `fired`，全部触发后 `done`；创建 / 修改时已过去的偏移直接记为已触发。
  - 模型工具 `session_event_create`（`risk: safe`）只能为当前群 / 频道建事件；修改 / 取消只经 Console RPC `session-events` / `session-event` / `session-event-create` / `session-event-update` / `session-event-cancel`（`control:read` / `control:write`）。
  - 到点唤醒复用 job-scheduler 的 `ScheduleEngine` 计时（不写 `schedule-jobs.json`）：`inbound_wake` / `schedule_wake_fired` → 控制面（按被点名判定，`mention_only` 不拦）→ 会话画像 → 模板直发（不调模型）。被拦 / 失败记为已触发、不补发；同一会话同一分钟的提醒合并为一条；重启后错过超过 10 分钟（`DEFAULT_SESSION_EVENT_GRACE_MS`）的写 `schedule_wake_missed` 不发。Bot 经日程发言后旁听窗口与冷场计数清零。
  - 审计新增 kind `schedule` 与码 `schedule_event_created` / `_updated` / `_cancelled`、`schedule_wake_fired` / `_missed` / `_merged`；决策回放可按 `kind=schedule` 过滤。

- a5f0381: 入群欢迎 / 退群记录（ADR 0037 第 1 期切片 A）。

  - 会话运营配置 `AiSessionOps` 与新表 `ai_session_ops`：按 `platform + scene_id` 存放，与会话画像分开；`welcome.enabled`（默认关）/ `template` / `mergeWindowMs`（60s）/ `maxPerHour`（10）/ `rulesUrl`，`leave.record`（默认开，只写审计）/ `leave.notify`（默认关，本期不发）。读不出时一律不发欢迎。
  - 模板变量白名单 `{members}` `{nickname}` `{group}` `{rules_url}`，未知变量原样保留。
  - 欢迎：入群 → 合并窗口 → 小时上限 → 控制面 → 会话画像发言判定 → 出站；被拦只写审计不补发，失败不重试。会话开启欢迎后 scene event 不再因入群唤醒模型（避免双发）。
  - 审计追加 kind `member_lifecycle` 与码 `welcome_sent` / `welcome_merged` / `welcome_rate_limited` / `welcome_disabled` / `member_leave_recorded`。
  - Console `plugin.root.session-ops` / `session-ops-preview`（只渲染，不发送不审计）/ `session-ops-set`（`expectedRevision`，变更写 `config_change`）。

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

- Updated dependencies [334e92d]
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [ff87195]
- Updated dependencies [18296cf]
- Updated dependencies [a3b636d]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/adapter@1.1.23
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/ai@1.1.46
  - @zhin.js/core@1.1.51
  - @zhin.js/permission@1.1.9
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/agent-feature@1.1.10
  - @zhin.js/mcp-feature@1.1.10
  - @zhin.js/prompt-section@1.1.9

## 1.1.41

### Patch Changes

- 0dd657d: Let the structured-decision provider decide group ambient engagement. New `ai.decisions.ambient` policy (`off` / `shadow` / `active`, plus `timeoutMs` and `minConfidence`): in `active` mode the DecisionProvider (for example TypeSafe Jev) answers one binary `engage` / `stay_quiet` choice over the same recent messages the chat-model judge sees, and the `ai.trigger.ambient.judge` list takes over when it fails, times out or answers invalidly; in `shadow` mode the judge list still decides and the decision is logged as `ambient_decision_shadow`. Quiet time, cooldown, hourly caps, conversation window, judge interval, `ambient.minConfidence` and ambient shadow mode are unchanged, and addressed turns still skip the ambient judge. Without `ai.decisions.ambient` nothing changes.
- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45
  - @zhin.js/core@1.1.50

## 1.1.40

### Patch Changes

- f98025b: 自动输出统一的每轮 Agent 用量汇总，DEBUG 展示模型调用与首请求上下文预算。沿用 TurnTrace 汇总主回合及子回合，传递缓存写入、模型身份和用量可用性；未知或部分数据明确标记，日志不包含消息、提示词或工具内容。
- 66ec1a5: Batch queued group moderation by conversation and sender while allowing ordinary inbound handling to continue. Preserve original-message evidence, notice-based escalation, model-owned recall and generation cancellation. Bound each group's pending buffer, explicitly audit reviews skipped at capacity, and attribute shared completions proportionally without counting the group request more than once. Older completion hosts retain per-message attribution.
- 7d68df6: 精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
- 250b026: 补齐上下文压缩中的工具参数、思考和媒体估算，以及已披露工具输入与结构化输出 Schema 的固定预算。小窗口按可用预算收紧近期原文保留量，继续保留最少消息数与工具调用配对。拒绝截断、失败、取消、请求工具、空白或未节省 token 的摘要，避免错误摘要写入历史；无可压缩前缀时不再报告摘要成功。

  摘要检查点改为绑定实际被压缩的已持久化前缀，修复当前回合未落库时的锚点错位；对来源不明、并发变更或等待写锁期间取消的结果跳过保存，原始记录不删除。

- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 9bc3285: Never send tool-call markup as a chat message. DeepSeek sometimes writes a tool call as text (`<｜｜DSML｜｜ calls>…`), which the plain-prose fallback forwarded to the group verbatim. Replies containing DSML, `<invoke>`, `<tool_call>` or similar markup are rejected in JSON and in prose, are not reworded by the format correction (that would announce an action that never ran), and fall back to the host failure notice. `<text>…</text>` wrappers are split into one message each.
- 3326db3: 减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
- e91235e: Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44
  - @zhin.js/core@1.1.50
  - @zhin.js/adapter@1.1.22
  - @zhin.js/prompt-section@1.1.8
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/tool@1.1.9
  - @zhin.js/agent-feature@1.1.9
  - @zhin.js/mcp-feature@1.1.9
  - @zhin.js/permission@1.1.8
  - @zhin.js/skill@1.1.9

## 1.1.39

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.
- deeb964: Accept integer IDs where the structured reply schema expects a string (for example a mention target written as `2100001` instead of `"2100001"`) instead of spending a format-correction model call on them.
- d9cc732: Accept structured replies that miss the strict format instead of failing the turn: a JSON object wrapped in a sentence or code fence, or with a bracket too many or too few, is repaired and still validated against the schema; a plain prose answer is sent as one text message. MiniMax often writes the structured answer as text, and these cases used to reach users as "Model did not produce the requested structured output".
- d3fc1a6: Stop prefixing chat replies with "（任务步骤较多，已自动续跑 N 次）" after an automatic continuation. A group member does not announce how many steps a task took; non-IM callers (HTTP, Console) still get the notice.
- 070bb6b: Skip the assistant-profile heartbeat while HEARTBEAT.md is missing or has no task, the way the kernel scheduler's own heartbeat already did. The default heartbeat prompt only reads that file, so each idle run was a wasted model turn (about 40k prompt tokens every 30 minutes). Heartbeats with a custom prompt still run.
- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
- Updated dependencies [d9cc732]
- Updated dependencies [070bb6b]
  - @zhin.js/ai@1.1.43
  - @zhin.js/core@1.1.49
  - @zhin.js/kernel@1.1.5

## 1.1.38

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.37

### Patch Changes

- 6fdd30b: Fix the occasional 5 s stall on an Agent turn (`SessionSystem waitForPersistence: timeout`) when `@zhin.js/workroom` is not installed. Only the Workroom persistence coordinator marked Agent persistence ready, so in Agent-only setups the first turn of every new Agent generation waited for the fallback timer. The Agent host now marks readiness itself when Workroom is absent, and `waitForPersistence` clears its fallback timer once readiness arrives (#857).
- 1a11207: HMR no longer reloads on editor temp, swap, lock and backup files (`.!<digits>!*`, `*.swp`/`*.swo`/`*.swx`, `4913`, `*~`, `.#*`, `*.tmp`, JetBrains `*___jb_tmp___`/`*___jb_old___`); matching uses the file name only (#857).

  Plugin tools can opt into the resident tool set with `defineAgentTool({ alwaysLoaded: true })`. The default stays deferred (`discover` / `load_tool`), at most 8 declared tools are resident per turn, `alwaysLoadedMode: replace` ignores the flag, and pinned tools now stay resident when a turn rebuilds its tool list after `load_tool` (#857).

- a3ab153: Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
- 61cca0b: AI 回复里引用的本地文件和 URL 媒体现在受本轮权限约束：`path` 必须通过与 `read_file` 相同的工作区与敏感路径检查，`url` 需要本轮出网权限并在每一跳都遵守 `allowedDomains`；不满足时以「附件不可用」占位。此前结构化回复可在禁止出网的回合里下载任意 https 地址，旧的 `<audio>` / `<video>` / `<file>` 写法还能把任意本地文件作为附件发出。`publishOutboundElements` 新增可选 `authority` 参数，IM 回合的回复入口已传入本轮权限。
- e8f7309: Agent structured replies now offer only the segment types the reply endpoint delivers (derived from the adapter's `segments.supported`), and the model can send quick-reply keyboard buttons. reply / forward / face are no longer offered to the model because it has no reliable source for their platform IDs.
- ade0f33: Export the `UsageSubject` type used by `completeText({ onBehalfOf })` and document its `groupId` format.
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- b15c86b: `PluginTestKit` accepts a file-backed configuration (`createConfigDocument(path)`) as `config`, so tests share the same file authority as `zhin start` (saved vs applied config, `config:explain`, reload of the config file). Adds end-to-end smoke scenarios for literal-choice config forms, `config:explain` and structured replies.

  `@zhin.js/agent` evals gain a structured-reply seed case (mention + text segments) that the nightly real-model run replays under the existing request budget.

- 3224ba3: `aiCompletion.completeText`：用量配额在调用前预留提示词估算量（并发调用互相可见），调用失败或 provider 未返回 usage 时按估算计费。

  模型降级与主对话路径一致：候选为绑定模型、模型注册表推荐、该 provider 其余模型，是否实际降级由 `ai.agent.providerResilience.fallback` 决定。

- f91cc89: 修复媒体感知描述中嵌套的帧标记在单次剥离后被重新拼出的问题（循环剥离直至稳定）。
- 1148821: 媒体感知预处理（perception pre-pass）的模型用量不再丢失：`describe` 返回 `usage`，并计入本回合的 `usageQuota` 与回合 token 汇总。
- 4dd081c: 结构化回复格式修正不再把「修正指令 + 被拒绝的原文」写入会话历史：成功时只持久化修正后的助手消息，失败时持久化实际发送给用户的失败文案。
- c618eb7: IM conversation turns now get a chat prompt: the workspace persona (SOUL.md) leads, a chat style section replaces the report-style one, and the coding-workflow sections are reduced to a short "workspace tasks" note; critical rules no longer claim to override the persona. Structured replies become `{"messages":[{"segments":[...]}]}` so the model can send several short messages, delivered in order with a short pause; a legacy single `{segments}` reply is still accepted. Workspace prompt files may use a `{{nickname}}` slot filled from `ai.agents.<name>.nickname` (default `Zhin`).
- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

- b3bbada: 子 agent 结果投递与主动出站（`sendElements`）也不再读取或下载模型在文本中引用的本地路径和 URL（新增 `NO_MEDIA_AUTHORITY`）；工具生成的图片 / 语音是内联 base64，不受影响。补齐 #892 只覆盖 IM 回合回复入口的缺口。
- 12d9a03: 识图预处理在模型返回空描述时仍上报用量；请求发出后失败（服务端错误、超时）时按提示词加媒体的保守估算计入用户配额与本轮用量。请求发出前就被拒（如识图模型不支持该媒体）不计费。
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [a383380]
- Updated dependencies [fbfefb7]
  - @zhin.js/tool@1.1.8
  - @zhin.js/core@1.1.47
  - @zhin.js/adapter@1.1.21
  - @zhin.js/ai@1.1.42
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/agent-feature@1.1.8
  - @zhin.js/mcp-feature@1.1.8
  - @zhin.js/prompt-section@1.1.7
  - @zhin.js/skill@1.1.8

## 1.1.36

### Patch Changes

- 18de875: 累计 Agent 回合内模型接口返回的用量，修复多次工具调用只报告最后一次、总结及格式纠正漏计的问题，使回合终态、日志与已启用的用量配额使用同一累计值。
- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/core@1.1.46
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/adapter@1.1.20
  - @zhin.js/agent-feature@1.1.7
  - @zhin.js/mcp-feature@1.1.7
  - @zhin.js/prompt-section@1.1.6
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 1.1.35

### Patch Changes

- d033076: 修复 MiniMax 结构化回复的 JSON 文本被 SDK 丢弃后误解析 thinking 的问题。保留完整 JSON 文本并继续严格校验；格式错误最多进行一次无历史、无业务工具的纠正，失败时返回固定提示，不重跑工具或放宽消息契约。
- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41
  - @zhin.js/core@1.1.45

## 1.1.34

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。
- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40
  - @zhin.js/core@1.1.45

## 1.1.33

### Patch Changes

- a64716a: IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- cc9959e: 新增插件用的纯文本补全 `aiCompletionToken`（`zhin.js/agent` / `@zhin.js/agent/runtime`）：`completeText()` 只做一次补全、不带任何工具，复用 provider 的重试、超时和同 provider 模型降级；`untrusted` 内容按数据块渲染且不能提前闭合；传 `onBehalfOf` 时计入用量配额。`AIProvider` 新增可选的 `completeTextResult()`，返回实际作答的模型与用量。

  **行为变化**：`AIService.createAgent()` / `runAgent()` 默认不再带 `registerTool()` 注册的工具（`includeRegisteredTools` 默认改为 `false`）；需要时显式传 `includeRegisteredTools: true`。

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39
  - @zhin.js/adapter@1.1.19
  - @zhin.js/agent-feature@1.1.6
  - @zhin.js/core@1.1.44
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/kernel@1.1.4
  - @zhin.js/mcp-feature@1.1.6
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/prompt-section@1.1.5
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6
  - @zhin.js/logger@1.1.2

## 1.1.32

### Patch Changes

- 9891e66: Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. Compatibility stubs at the old internal agent paths were removed in A4b (see `move-workroom-runtime`), together with the `./workroom/*.js`-style deep exports; `@zhin.js/workroom` exposes only its package root. Import from `@zhin.js/workroom`.
- c829031: feat(agent): 长对话压缩、已告知账本与缓存友好的提示词顺序（#730）。
  - 自动压缩改为在消息达到 `contextWindow × thresholdRatio`（新配置 `ai.agent.compaction.thresholdRatio`，默认 0.7）减去系统提示和工具定义占用时触发，插件运行时会话同样生效；以前要接近“窗口减 13k”才触发。
  - 压缩摘要会保留已告知用户的结论和承诺。
  - 新增按会话的“已告知”账本，最终回复和进度汇报共用：下一轮以 `[Already told the user]` 短块提供给模型，自动去重，最多 8 条。
  - git 状态移到系统提示最后一段，便于缓存稳定前缀。
  - 回合追踪记录 provider 返回的缓存命中 token。
- 0c17e0b: feat(agent): 上下文量化与按需披露（#729）。每轮第一次模型请求的上下文开销按段估算（系统提示、工具 schema、按需工具索引、技能目录、专家 agent 目录、已加载技能、记忆、bootstrap、历史、本轮输入），写入回合追踪的 `context_budget`，`zhin trace last` 可见。插件运行时的技能目录和专家 agent 目录改为只列名称加一行说明（最多 96 字符、40 条），技能正文在 `load_skill` 后才注入；未常驻的工具在系统提示 `## Deferred tools` 段列出名称和短说明（只含本回合有权使用的工具）。修复 `load_tool` / `load_skill` 之后模型直接给出文字回复时，agent loop 仍多发一次模型请求的问题。
- bf52b40: fix(agent): read_file / list_dir / glob / grep / edit_file / write_file 默认常驻加载（仍受本轮工具过滤与 exec 策略约束），常驻工具不再写入会话快照，不占 `maxLoadedPerSession` 名额也不会被挤出。模型直接调用本轮目录中的延迟工具时自动加载并执行，审批与权限检查照常生效；不在目录中的名字仍按未知工具拒绝，并提示使用 discover / load_tool。
- 1f24fbf: feat(agent): 后台任务（Detached Task）——持久化状态机、冻结权限快照、每步 checkpoint 与重启恢复、副作用幂等键（#731）
- 55811d1: Provider resilience gate cases for model fallback and request timeouts (#724). The eval scripted model can register several candidate models and records the model id of each request; a `hang` fault step drives a virtual clock so timeout cases never wait in real time. The provider request timeout now accepts injected timers (`ProviderTimers`).
- 9b8b586: Add a scripted-model agent eval framework (`packages/im/agent/evals`) that drives `FullAgentTurnEngine` through `TurnIngress`, with tool, outbound-text, approval and termination assertions; run it with `pnpm eval:agent` (CI gate).
- a6ea7b4: Agent evals: multi-message ingress cases (#725). A case can now feed several timed messages through the IM admission protocol (TurnAdmissionGate) on a virtual clock, which makes same-sender merging, FIFO queuing of different members, cancel and queue-full/expiry testable end to end.
- 9486586: Eval mock tools can declare `parameters` (JSON Schema), which is sent to the model. Cases with live checks must declare every argument their script passes. This fixes the nightly `seed-group-member-read-only-lookup` failure, where a real model saw `get_weather` with no arguments and called it without a city.
- 2b5e5ae: Add 27 seed agent eval cases covering QQ regressions, #716/#718 fixes and #719 group-member tightening. The scripted eval driver gains native file/bash tools on a temp workspace, `notOffered` tool-call expectations, model-input assertions and generic provider fault steps, and applies the same group-member restriction as AgentRuntime via the new shared `restrictGroupMemberTurn` helper.
- bf52b40: 新增探索纪律 harness：model harness 支持 `explorationBudget`（连续只读探索调用达到次数后在工具结果中注入提示，默认 8，0 关闭）与 `explorationGuidance`（系统提示加入"先规划、限定目标文件"）；内置 MiniMax M 系列预设（explorationBudget 5，开启 guidance，不改 maxIterations），均可通过 `ai.agent.modelHarness` 覆盖。
- bf52b40: 原生文件工具不再淹没上下文：grep/glob 默认跳过 node_modules、.git、.opencode、.zhin、dist、coverage 等目录并遵循 .gitignore（路径直接指向这些目录时仍可搜索）；grep 拒绝 `.*`、`^` 等匹配所有行的模式并给出改用 read_file / glob / list_dir 的提示，跳过二进制与超大文件；grep 匹配数、输出字节、单行长度，glob 文件数，list_dir 条目数与 read_file 行数均有上限，截断时提示如何缩小范围或继续读取。
- bf52b40: Harness 组合修复：直接调用被策略移除的 bash 不再被自动加载进会话；standalone 子 loop 支持传入父 turn 策略以同样隐藏 bash；交互提示的回答（如审批回复 y）不再作为背景事件进入下一轮上下文。
- bf52b40: 修复 IM 审批静默拒绝：审批结果区分「用户拒绝 / 审核器拒绝 / 超时 / 无审批通道」，并以不诱导重试的文案返回给模型；审批提示支持回复 y/同意、n/拒绝；超时不再被当作用户拒绝记忆；owner 读取工作区内 package.json、锁文件等非机密项目文件不再需要确认（.env、密钥等仍需确认，写入审批不变）。
- bf52b40: fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
- fc75499: feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
- bf52b40: fix(agent): 工具步数用尽时不再把原始工具输出发给用户。循环结束且没有可见回复时，会关闭工具再请模型总结已完成的工作、剩余事项并询问是否继续；总结失败则回复固定提示。`formatToolCallsForUser` 不再展示 read_file / grep / glob / list_dir / web_fetch 等只读探索工具的结果，并限制总长度。
- 2a9d08b: Semantic memory gets a data model and write policy (#733). Entries now carry `kind` (user_fact / preference / task_state / episodic), the writing turn and its trust level, `last_used_at` and a bounded version history; existing `memory_entries` tables gain the new columns at startup without losing rows. `memory_upsert` attributes writes to the turn (the model can no longer set `source`), keeps group members out of global/platform memory and away from facts written at a higher trust level, defaults group-member writes to their own `user` scope, and gives `task_state` a bounded expiry that can be tied to a task.
- e4fbfb2: Semantic memory retrieval uses BM25 (#734). `memory_search` ranks with BM25 (word tokens plus CJK bigrams), and each turn now recalls the top-k entries relevant to the current message from the initiator's visible scopes into the turn context, bounded by `ai.memory.semantic.recall` (`topK` 5, `maxTokens` 400 by default), so memory cost per turn no longer grows with the number of entries. Users can view and forget memory about themselves with `/memory` and `/forget`; `SemanticMemoryRuntime` gains `list` / `delete` for management surfaces.
- 4ce55db: Add a minimal per-turn trace: `TurnTrace` collector (model calls and tokens, redacted tool-call summaries with duration and result size, denials, budget extensions and auto-continuations, nested sub-agent turns, termination) fed from the turn journal, the last 50 traces kept in `data/agent-traces/recent.json`, a new `zhin trace <turnId|last>` command, and traces attached to failing eval reports.
- ba56e74: Nightly real-model evals (#723): a MiniMax capability matrix (tool-call format, parallel calls, long context, Chinese instruction following) with semantic checks, an optional LLM-judge interface, hard request/token budgets, and JSON/Markdown reports diffed against the previous night. Runs from a scheduled workflow, never as a PR gate.
- 56bafda: feat(agent): 多模态感知预处理 `ai.multimodal.perception`。主模型收不了的图片 / 视频 / PDF，由配置的感知模型（如 Gemini Flash-Lite）经 provider 韧性层描述后，以 `[图片描述]` 等不可信外部内容注入，并写入会话历史；按字节 sha256 缓存，每回合有上限，失败回到原占位。描述会让回合进入“已接触外部内容”状态（高危动作需审批），`media_resolution` 事件带上来源模型。不配置时行为不变；配置错误时启动失败，`zhin config check` 同样报错。

  fix(agent): 模型 fallback 跳过不支持本回合媒体类型的候选（已接收的图片不会在 fallback 时悄悄变成占位）；带图片的回合仍以绑定的模型（`ai.agents.<name>.model`）为第一候选。

  deprecate（仍兼容，下一个 minor 移除）：

  - `ai.agents.<name>.priority` / `match`（含 `hasMedia` 等全部条件）从未生效：IM 消息总是交给 `ai.agents.zhin`。仍接受，启动时告警，不再因此校验报错；`zhin config check` 报 `ai.agent_routing_deprecated`，`--fix` 自动删除。`ai.routes` 的 `--fix` 改为直接删除。删除未导出的 `routing/route-matcher` / `match-rules`；`RouteMatchConfig` 与相关字段标记 `@deprecated`。
  - `ZhinAgentConfig.visionModel`（仅代码可设置的残留）：仍作为图片回合的后备候选，设置时告警。
  - `AgentCore.runVision` / `runVisionTurn`、`runAgentLoopVisionTurn` / `runAgentLoopVisionTurnRun` 及其类型：无生产调用方，标记 `@deprecated`。

- 7d2263c: Progress-aware tool-call budget (`ai.agent.toolBudget`): `maxIterations` becomes a soft budget extended while the turn makes progress (not when looping or failing), with hard step/wall-clock/token caps, opt-out automatic in-turn continuation (default: master private chat), throttled natural-language progress updates (default: private chats), and the exploration budget resetting on the same progress signal. Sub-agents use the same budget with a lower hard cap and no continuation.
- 1ea299a: Add PR-gate eval cases for provider resilience (#724): 429 retry then success, retries exhausted with a polite reply, empty reply with and without a re-ask preset, and a malformed tool call.
- 27da0e8: Provider resilience for agent turns: classify provider errors (rate limit, timeout, 5xx, network, empty reply, malformed tool call), retry with exponential backoff honouring Retry-After, per-request timeout, fallback across `modelCandidates`, and per-model quirk presets (`emptyReplyRetries`, `requestTimeoutMs`; MiniMax M-series re-asks once on an empty reply). Configured via `ai.agent.providerResilience` with conservative defaults.
- 7d2263c: Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
- dbc1456: feat(agent): 后台任务插话、改向与叫停，`/tasks`、`/task stop|redirect` 命令，并从 `@zhin.js/agent` 导出后台任务模块（#732）
- d91d21a: feat(agent): trust tiers and initiator binding (#726). Each turn now has an initiator trust level (owner / trusted_member / group_member), and its authority is that level's ceiling intersected with the configured policy. This replaces the #719 group-member special case; group-member turns keep the same restrictions, but denials now report the `trust-level` policy. Sub-agent reports, third-party plugin prompt sections, skill instructions and background group events are rendered as labelled `external_content`, and traces record the initiator trust level.
- a62acca: Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
- 9ab9ffb: fix(ai): `completeText`（压缩、上下文摘要、子 agent 摘要）与主对话路径对齐。
  - 经现有 provider 韧性层（`createResilientCompletionPort`）做错误分类、退避重试、单次超时（默认 180s）和同 provider 模型 fallback；SDK 自带重试置 0，避免重试叠加。
  - `TextCompleteOptions` 新增 `signal`、`timeoutMs`、`fallbackModels`、`resilience`；压缩与摘要调用方在有取消信号时透传，取消不再走降级摘要，也不计入自动压缩熔断。
  - 只返回正文，绝不把模型的 thinking 当摘要；内容安全 / 长度失败抛出 `CompletionFailureError`（消息即面向用户的说明）。
  - 未指定模型时优先使用 provider 配置的 `defaultModel`。
- 1280631: Gemini provider fixes (#769). Gemini chat models now default to multimodal input, and images go out as typed file parts. Gemini 3 function-call thought signatures round-trip. SAFETY, RECITATION and blocked-prompt refusals, empty MAX_TOKENS replies and MALFORMED_FUNCTION_CALL now show up as visible errors instead of empty replies. Gemini `RetryInfo.retryDelay`, `API_KEY_INVALID` and RPC statuses feed retry classification. A new provider-config `providerOptions` field carries `safetySettings` and `thinkingConfig`, and opt-in `contextCache: { mode: 'explicit' }` adds explicit Gemini `cachedContents` with TTL refresh and invalidation. The nightly real-model evals now run on Gemini (`GEMINI_API_KEY`), with new multimodal eval cases.
- bd78a94: Gemini coverage for the provider resilience layer (#724). Gemini safety blocks (SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY, RECITATION and blocked prompts) now get a polite refusal and are never retried or sent to a fallback model. A per-day Gemini quota (`QuotaFailure` `PerDay`) skips retries and falls back to the next candidate model. 504 `DEADLINE_EXCEEDED` is reported as a timeout. A new Gemini model-harness preset re-asks an empty reply or a `MALFORMED_FUNCTION_CALL` once on the same model. The nightly capability matrix gets a multimodal column, and `NIGHTLY_PROVIDER=minimax` keeps MiniMax available next to the Gemini default.
- 57ea5f7: Provider config fixes. Provider `timeout` and `maxRetries` now take effect: they override `ai.providerResilience` for that provider, below per-model harness settings. New opt-in `firstChunkTimeoutMs` / `chunkTimeoutMs` abort streams that connect but go silent, and the stall is retried and failed over like any timeout. `authScheme` now works for every scheme (`Token`, `Bearer`, `''`) on chat requests and model discovery alike. The `sdk: openai` `baseUrl` gets `/v1` on a bare proxy root, like the other OpenAI-protocol providers; `compat.appendV1: false` keeps the old as-written behaviour. `compat.supportsDeveloperRole: false` sends `system` instead of `developer` to reasoning models. OpenAI refusals now surface as a content-policy message instead of an empty reply. MiniMax `baseUrl` values ending in `/anthropic` or naming only a host are completed to `/anthropic/v1`, and `@ai-sdk/minimax` is declared as an optional peer dependency. `compat.supportsReasoningContent` and `compat.toolCallsInAssistant` are deprecated no-ops, and gateway presets no longer set them.
- f48ba72: `deferredTools.alwaysLoadedTools` now extends the default resident tools (`ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`) instead of replacing them, so an override no longer hides `discover`/`load_tool`. Set `deferredTools.alwaysLoadedMode: 'replace'` to restore the previous replace behaviour.
- 417ec5b: **Behaviour change (#753):** IM private chats from senders who are neither the owner (`master`) nor on `trigger.trusted` now get the `group_member` trust level instead of `trusted_member`. Such stranger DMs no longer get `bash`, file-write or send-to-other-conversation tools. Owner DMs, trusted-list DMs and non-IM ingress (HTTP, CLI, schedules) are unchanged. To restore full authority for a DM user, add their ID to `trigger.trusted`.
- 7f0f8ca: Agent evals: the eval driver accepts a real-model source (`createLiveModel`), and the nightly MiniMax runner now replays seed cases that declare `live` semantic checks end to end through the driver. The PR gate also runs those checks on each scripted run, so it stays deterministic (#723).
- d38d38c: Tighten agent turns started by ordinary group members (not master, not in `trigger.trusted`): no bash, read-only files, and no outbound messaging tools. Restricted tools are hidden and also denied at execution with a clear reason (#719).
- 8e26cf1: 配置面收敛（#735）：弃用运行时未读取的 `ai.agent.maxSkills`、`policyDenialStopAfter`、`deferredToolMaxResults`、`taskExecApprovalMode`（启动告警，`zhin config check --fix` 可移除），新增《默认行为规范》权威文档与开关清单门禁。
- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

- f768296: Stream observers of `executeAgentTurn` now read a journal-derived feed: the turn journal is the single source, so authority tool events (`tool_call` / `tool_result` / `tool_denied`) committed by TurnToolRuntime reach stream consumers in commit order with the existing TurnEvent shape, without being journaled twice. Adds `createJournalFeed` / `journalFeedOf`.
- 9891e66: Move the Workroom runtime composition (`workroom-runtime`) from `@zhin.js/agent` into `@zhin.js/workroom`; the dependency direction is now `@zhin.js/workroom` -> `@zhin.js/agent`.

  - Workroom exports were removed from `@zhin.js/agent`, `@zhin.js/agent/runtime` and `zhin.js/agent`; the `zhin.js/agent` re-export surface shrank, so users who imported Workroom exports through `zhin.js/agent` must import them from `@zhin.js/workroom` instead (the export names are unchanged). `@zhin.js/agent` no longer depends on `@zhin.js/workroom`.
  - The `Local*` assignment authority types declared by the authority provider module (`WorkroomLocalAssignmentAuthorityInput`, `WorkroomLocalAssignmentResolvedAuthority`, `WorkroomLocalAssignmentAuthorityPort`) clash with the domain contracts of the same name in a single barrel; the provider variants are exported with a `WorkroomProvider` prefix.
  - Compatibility stubs at the old internal agent paths and the `./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js` deep exports of `@zhin.js/workroom` are removed. Use the package root.
  - `@zhin.js/agent` gains three narrow host-integration exports: `collectAgentLoopTurnRun` and type `ZhinAgentPrivate` (`@zhin.js/agent/core`; `ZhinAgentPrivate` is an internal host-integration type, not a stable API), and `runWithAgentTurnConfiguration` (`@zhin.js/agent/turn`).
  - `@zhin.js/cli` and `@zhin.js/a2a` declare `@zhin.js/workroom` as an optional/dev + peer dependency (like `@zhin.js/agent`), so installing the core no longer pulls in agent/workroom.

- bc09928: Nightly evals: retry a 503 UNAVAILABLE once (8–15 s, or a longer Retry-After), record runs that stay 503 as provider-unavailable instead of model failures, fail mostly-503 nights as infra-flaky, list budget-skipped runs in the summary, and default to gemini-3.5-flash-lite.
- 779750f: Nightly evals: serialize and pace real model requests to the Gemini free tier (≥4 s apart, ≤15 RPM). A 429 is retried after 2/4/8 s or after a longer `retryDelay` / `Retry-After`; a daily-quota 429 is never retried and fails the run with a clear message.
- 9891e66: Separate Workroom runtime code from the generic Agent runtime (`src/workroom-runtime/`) and remove Agent-core reverse dependencies on Workroom.

  Migration notes:

  - `validateWorkroomDefinitions` is no longer exported from `@zhin.js/agent/config`; import it from `@zhin.js/workroom`.
  - Workroom console fields (`workroom`, `workroomCatalog`, `workroomControl`, `workroomProfiles`, `workroomKnowledge`, `portfolioSponsor`, `effectSponsor`, `dataLifecycle`) moved from `AgentHostConsolePort` to the new `workroomHostToken` (`@zhin.js/workroom`).
  - `defineAiDatabaseModels` now registers only Agent tables; call `defineWorkroomDatabaseModels` for Workroom tables. `activateAiDatabaseStorage` no longer activates the Workroom journal/catalog; use `prepareWorkroomDatabaseStorage` (validates persisted journal headers) before it and `.activate(...)` after.
  - `plugin-runtime/deferred-capability-plan.ts` is now Workroom-free: the Workroom realization/authority code moved to `workroom-runtime/workroom-capability-realization.ts` (exported from `@zhin.js/workroom`); `createDeferredCapabilityPlan` takes an injected `ceiling` (`DeferredCapabilityCeiling`) instead of `authority`, and `isReservedControlToolName` is exported.
  - `createDeferredCapabilityPlan` now throws if the legacy `authority` option is passed (it used to be silently ignored; use `createWorkroomDeferredCapabilityPlan`), and it throws if the injected `ceiling` returns tools or skills that are not a subset of its input (by reference).
  - `RESERVED_CONTROL_TOOL_PREFIX` ('workroom\_') is exported from `@zhin.js/agent/runtime` next to `isReservedControlToolName`.

- b3fea8c: Agent turn traces are now persisted in `data/agent-traces/<day>.jsonl`, kept for 7 days with a 64 MB size cap (`ZHIN_TRACE_RETENTION_DAYS`, `ZHIN_TRACE_MAX_MB`), and redacted again when written. `zhin trace` can filter by session and time (`--sessions`, `--session`, `--since`, `--until`). A new read-only host API (`/api/agent/trace-archive/*`, full scope) backs the Console Agent Trace page (`TraceArchivePage`), which goes from sessions to turns to a turn detail with a waterfall and the raw record. Failing agent evals print a `zhin trace` command that opens the failing case's trace (#728).
- Updated dependencies [9891e66]
- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [386150d]
- Updated dependencies [2dfe5fa]
- Updated dependencies [2dfe5fa]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/ai@1.1.38
  - @zhin.js/core@1.1.43
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/kernel@1.1.3
  - @zhin.js/mcp-feature@1.1.5
  - @zhin.js/agent-feature@1.1.5
  - @zhin.js/prompt-section@1.1.4
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5

## 1.1.31

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42
  - @zhin.js/ai@1.1.37

## 1.1.30

### Patch Changes

- b36452a: Bind optional decision providers to the held runtime generation. Add explicit off, shadow and active policies for progressive capability selection, scoped search reranking and automatic approval judgments, preserving deterministic permissions and human approval memory. Validate consumer configuration and expose redacted decision diagnostics.
- Updated dependencies [badcc1f]
- Updated dependencies [b36452a]
  - @zhin.js/core@1.1.41
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/ai@1.1.37
  - @zhin.js/adapter@1.1.17
  - @zhin.js/agent-feature@1.1.4
  - @zhin.js/mcp-feature@1.1.4
  - @zhin.js/prompt-section@1.1.3
  - @zhin.js/skill@1.1.4
  - @zhin.js/tool@1.1.4
  - @zhin.js/permission@1.1.4

## 1.1.29

### Patch Changes

- b9b3953: Recognize versioned Tool, MCP, Skill and Agent projections across native generation module identities, so protocol ingress retains visible capabilities and fixed-generation execution guards. Keep MCP tools/list available with an empty tool set and reject unknown calls explicitly instead of advertising an unavailable method.

  Bind reused Tool projections to the explicit operation snapshot: new requests read current generation config, resources and projections, while in-flight requests keep their leased generation and retirement guards.

- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/adapter@1.1.16
  - @zhin.js/im-contract@1.1.3
  - @zhin.js/core@1.1.40
  - @zhin.js/ai@1.1.36
  - @zhin.js/tool@1.1.3
  - @zhin.js/mcp-feature@1.1.3
  - @zhin.js/skill@1.1.3
  - @zhin.js/agent-feature@1.1.3
  - @zhin.js/kernel@1.1.2

## 1.1.28

### Patch Changes

- 0de4836: Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.
- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/permission@1.1.3
  - @zhin.js/adapter@1.1.15

## 1.1.27

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- 95b24d4: Skip unsupported directory handle flushes on Windows while retaining file flushes and POSIX directory durability, and prevent Agent message persistence from issuing a second insert when a SQL dialect does not return an inserted id.
- cce3d5b: Automatically activate the uniquely matching private Skill of a selected platform Agent so intent-specific tools are available in the same turn.
- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
- Updated dependencies [95b24d4]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/core@1.1.38
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/ai@1.1.35
  - @zhin.js/adapter@1.1.15
  - @zhin.js/agent-feature@1.1.2
  - @zhin.js/mcp-feature@1.1.2
  - @zhin.js/permission@1.1.2
  - @zhin.js/prompt-section@1.1.2
  - @zhin.js/skill@1.1.2
  - @zhin.js/tool@1.1.2

## 1.1.26

### Patch Changes

- c861789: Own the Agent lifecycle event contract inside the Agent package and remove the
  classic Plugin event subscription bridges. Runtime consumers now subscribe
  through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
  publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
  declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
  activity bus with a generation-owned Resource, and remove concrete Plugin objects
  from ZhinAgent and its tool security path.
- 1414ccb: Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
- e1d77d2: Centralize each turn's executable tool snapshot in `ExecutableToolRegistry`, removing duplicate mutable maps from full and standalone Agent loops and keeping model projection and runtime lookup on one authority.
- 743d470: Make `@zhin.js/tool` the sole owner of Agent Tool input Schema admission, JSON Schema projection, and pre-execution parsing. Require an object-root JSON Schema or the public Zod 4 `safeParse` plus `toJSONSchema` contract, remove Zod 3 structural compatibility, and delete the duplicate `@zhin.js/core/tool-zod` entry point.
- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- eb0100a: Model per-turn tool execution, Workroom priority authorization, and generation-owned governed dispatch as concrete classes with private dependencies. Construct these implementations directly and remove their anonymous-object factories.
- 6b0415a: Move Agent Host composition, database activation, runtime introspection, and MCP lifecycle helpers to `@zhin.js/agent/runtime`, and remove the classic `ToolRuntime` machinery from the package root. `composeZhinAgentRuntime` now returns the composed runtime carrying its internal Host contract, so the CLI no longer imports or calls `asPrivate` itself.
- cd54131: Remove the deleted `usePlugin`, `getPlugin`, and host-root registry signatures
  from the public runtime instead of retaining throwing or no-op compatibility
  exports. Remove the module-global `registerAIHook` compatibility registry;
  Agent hooks now belong to generation-owned resources and canonical stream events.
- 8ededb6: Remove the classic Plugin-tree Agent discovery path. Workspace Agent discovery now accepts only a project root, package Agent surface discovery accepts a filesystem descriptor, and plugin-packaged Agents remain owned by the generation Feature provider.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- 103f2c3: Document the canonical Workroom Journal, Projection Outbox, and Extended Console RPC module entries, and add a repository gate that prevents external deep imports or restoration of their removed flat source entries.
- 9110ab8: Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.
- d844144: Move Bash execution to a native generation ToolFeature backed by an explicit execution port and the typed Turn policy. Remove the classic Bash tool API, hidden input authority channel, and `createBuiltinTools` Bash entry.
- 2a2b5d7: Move conversation compaction state into a host-owned `AgentCompactionRuntime`. Automatic compaction, manual compaction, lifecycle cleanup, and stability metrics now operate on the same explicit runtime instance, so multiple Agent hosts cannot share or evict each other's session state.

  Remove the process-global compaction state helpers. `@zhin.js/agent/memory` now exposes the class-based runtime, including instance-local metrics, LRU pressure eviction, and cleanup.

- 1fa1c09: Replace the process-wide proxy URL and fetch cache with provider-owned `AiHttpTransport` instances. Model discovery, text generation, image generation, and generated-image downloads now use the owning provider's transport, and disposing `AIService` waits for proxy agents to close.
- b853dba: Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
- e561309: Give each IM runtime one dedicated conversation owner for event-store replacement, inbound and outbound fact recording, notice normalization, reference lookup, context aggregation, and consumer cursors. Split the conversation contract into reader and writer ports so Agent and CLI receive only the read capability while Core retains mutation authority.
- f4387ef: Publish `generate_image` as a generation-owned native Tool Feature for both main and subagent turns. Provider lookup and image defaults now stay with the Host-owned `AIService`, execution follows the canonical `ToolIndex` and `TurnToolRuntime` path, and the detached class-based implementation is removed.
- 75920c4: Replace the process-global LLM provider, transport, live-model resolver, and language-model caches with owner-scoped `LlmApiRuntime` instances. Agent loops and compaction now require an explicit completion port; AIService, ZhinAgent, subagents, deferred workers, and the CLI composition root retain and inject their own runtime. Remove the global registration, lookup, resolver, cache-reset, and test-reset APIs.
- 5c1ea6c: Replace the process-global Owner approval helpers with `OwnerApprovalRuntime`, owned by each `ZhinAgent` and injected into command handling and exec policy evaluation. Remove classic `Plugin` lookup wrappers, the unreachable pending-approval map and shorthand, and its misleading stability metric.

  Split strict V2 persistence into a private store that validates complete documents and writes atomically. V1 files are rejected without online migration or rewriting; retained approvals must be recreated explicitly.

- cd4f240: Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
- 535fed1: Make `tools/<name>/index.ts` available to the owner-aware Tool Feature, preserve tool tags and keywords through Agent projection, and replace the 60s plugin's process-global API base registration stack with an owner-scoped `SixtySClient` used by every command and Agent Tool.
- 5d990be: Remove dead classic Plugin and Adapter runtime bridges. Agent activity feedback now depends on the explicit Adapter `EndpointControl` port, dangerous-tool allowlists come only from the current turn context, and the unused global Adapter registry cleanup and typing example integration are gone.
- cd55ee6: Remove the ambiguous `defineTool` and `DefineToolInput` aliases from the Agent authoring surface. Explicit `tools/<name>/index.ts` entries now use the single canonical `defineAgentTool` authoring API.
- 98dbc85: Remove classic `*.tool.md` and standalone Skill directory discovery from the Agent runtime. Tools now enter through Plugin Runtime `tools/<name>/index.ts` features, Skills use `skills/<name>/SKILL.md`, and Group Suite keeps its database and transient state inside its owning plugin runtime.
- 3abdc90: Remove the unused classic Plugin-based Agent introspection REST and collector APIs. Console introspection is owned by the Host composition and reads commands, components, middleware, endpoints, and Agent resources from the current Runtime snapshot.
- 2b7b271: Remove the unused classic `AgentFeature` and `MCPFeature` registries from the Agent root API. Agent presets and MCP connections now have one authority each: the generation-owned `AgentIndex` and `McpIndex` projections provided by their dedicated Feature packages.
- f19d598: Remove the remaining classic Agent Tool rail and the unmounted `install_skill` and retired `activate_skill` protocols. Skill loading now uses the polymorphic `SkillInstructionSource` contract and typed read results, `spawn_task` owns its explicit turn-bound definition, and Web, file, orchestration, spawn, and Skill modules replace the former catch-all `builtin` directory. Remove the unused ToolSelection collector and its compatibility exports so the generation Tool catalog remains the only production selection path.
- ba0ba3c: Remove the unused classic `createBuiltinTools()` aggregate and the duplicate class-based file, web-fetch, and TODO Tool implementations. These capabilities are now exposed only as generation-owned `@zhin.js/tool` definitions and executed through `ToolIndex` and `TurnToolRuntime`.
- 5140ce1: Remove the unmounted classic Database Feature, its `defineModel` extension, and the process-global post-start migration hook. Database tables and lifecycle now have one authority through the generation-owned Database Host. Also remove the inactive online `bot_id` compatibility migration; supported schemas must use `endpoint_id` directly.
- 379439b: Remove the unmounted classic Core `ToolFeature` and `SkillFeature` registries and the unused Agent bridge that copied them into a mutable resource hub. Tool and Skill authority now comes only from generation-owned Feature projections consumed by Plugin Runtime `CapabilityIngress`; Core retains only the stateless IM access predicate used by the current path.
- 11c9352: Remove dead deprecated aliases from Core and Agent, including legacy Tool and outbound segment types, the old interactive segment helper, duplicate Session and Schedule names, obsolete log formatters, and the process-global Task Executor drain shim. Current APIs now expose one name and one ownership model for each behavior.
- 4bc3d3c: Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
- 6012e3c: Remove the detached `analyze_media` Tool that reported images as model-ready without injecting them into a model turn. Inbound images now use the canonical media pipeline directly: vision-capable providers receive native image input, while unsupported providers report that limitation explicitly. File tools no longer direct callers to a nonexistent analysis path.
- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- cb61227: Remove the implicit classic `web_search` Tool from standalone `AIService` agents. Standalone capabilities are now explicit through per-agent `tools` or the service-owned registration boundary, while the generation runtime remains the sole owner of native Web Tool Features. Move shared Web search infrastructure into the cohesive `web` module and reject ambiguous duplicate registrations.
- 140cf0f: Remove the legacy composed side-event mapping aliases in favor of structured `mapNoticeParts` and `mapRequestParts`. Delete unmounted Agent default hook, tool, and subagent modules that exposed no runtime behavior.
- 774ed26: Require the canonical `data/memory/global`, `platforms/<platform>`, and `sessions/<session>` layout. File-memory loading no longer copies or reads root-level legacy files, and the public migration helper has been removed.

  Anchor memory path classification to the selected workspace and reject root-level or unknown memory paths. Path resolution, policy checks, and memory reads are now pure and cannot create memory directories as a side effect.

- adecba9: Remove process-global prompt, instruction, bootstrap, and Git status caches. Context readers now observe the current workspace on every request without cross-owner state or cache-reset APIs.
- 019f5ff: Make the generation `ToolIndex` the sole Agent Tool catalog. Remove the empty ResourceHub Tool registry, its builder and Capability Seam adapter, and stop merging its empty projection into Console introspection. Agent support resources now own only Skill, SubAgent, MCP, and Hook state; plugins register Tools through `tools/<name>/index.ts` or `context.addTool()`.
- 77d5a46: Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
- da17137: Remove the unused legacy Capability Seam DI symbol and direct Tool and Skill invocation compatibility APIs. Capability Seam now enters the runtime only through the generation-owned `capabilitySeamToken`, provider projection, and the canonical Turn Tool Runtime.
- 659b61d: Require the current Agent session database models during generation activation and remove automatic SQLite schema probing, legacy-column deletion, and historical session-tree backfills. Database mode now rejects incomplete schema registration instead of silently retaining in-memory session state.
- 91adaa5: Require every Workroom Projection binding and outbox item to carry an explicit audience and binding-generation cursor. Remove online normalization of legacy bindings and cursor migration, and split Projection contracts, repositories, state transitions, tracing, projection rules, and delivery into one canonical domain module.
- 1fed817: Require the composition root to inject one `NotificationRouter` into Schedule execution and delivery. Remove the duplicate `resolveAdapter` construction path and the Task Executor adapter resolver exposure so scheduled output has one outbound routing authority.
- 698f16f: Replace ambiguous command approval modes with `ask`, `auto`, and `bypass`, add a fail-closed review Agent, and scope remembered human decisions to the current invocation, sender, or conversation.
- e5d9795: Separate Workroom, Portfolio, and Data Governance domain contracts from Agent runtime composition. Assignment grants, disclosure authority, remote execution, governed dispatch reasons, catalog validation, and effect blocker ports now belong to their domain modules; the local model assignment adapter moves to `@zhin.js/agent/runtime`. Remove the deprecated Workroom catalog config aliases and enforce the domain dependency direction in the architecture harness.
- 444ea45: Split the Workroom Journal into a canonical domain module with explicit contracts, Memory/File/Database adapters, event validation and codec, stored control projection, and governed payload publication/replay boundaries. Preserve the package-root API while removing the monolithic source entry and migrating all internal consumers to the new module.
- 2fd8017: Make root `AGENTS.md` the main Agent contract and `agents/<name>/agent.json` plus `system.md`, `boundaries.md`, and `conventions.md` the only named sub-agent authoring shape. Standardize Agent and Skill private Tools, Skills, and Hooks as nested named directories, enforce access predicates and governed Tool activation, and keep supporting-file changes on Agent Slot hot reloads.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [13f7301]
- Updated dependencies [cd54131]
- Updated dependencies [a9e4a40]
- Updated dependencies [5855db7]
- Updated dependencies [ef92a6d]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [63d1f7a]
- Updated dependencies [25a845a]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [eb3227a]
- Updated dependencies [1fa1c09]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [75920c4]
- Updated dependencies [b076eae]
- Updated dependencies [cd4f240]
- Updated dependencies [535fed1]
- Updated dependencies [73a24b7]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
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
- Updated dependencies [4bc3d3c]
- Updated dependencies [31b42a8]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [77d5a46]
- Updated dependencies [65d0391]
- Updated dependencies [698f16f]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [cf83528]
- Updated dependencies [33ea736]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/core@1.1.37
  - @zhin.js/ai@1.1.34
  - @zhin.js/tool@1.1.1
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/adapter@1.1.14
  - @zhin.js/mcp-feature@1.1.1
  - @zhin.js/prompt-section@1.1.1
  - @zhin.js/agent-feature@1.1.1
  - @zhin.js/skill@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/kernel@1.1.1
  - @zhin.js/im-contract@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.25

### Patch Changes

- 33b1582: Update vulnerable dependencies and replace unsafe HTML and protocol-text regular expressions with bounded scanners.
  - @zhin.js/core@1.1.36

## 1.1.24

### Patch Changes

- 28b7375: Add a governed software-delivery plan, GitHub workspace REST transport and exact-artifact CI/CD provider integration. Enforce candidate-bound, current-clock review and Sponsor decisions; prevent duplicate Effect dispatch and recover uncertain external operations through query-only reconciliation and health evidence.

  Custom GitHub capabilities must provide an explicit binding matching the Effect capability reference and digest; missing or mismatched bindings now fail closed. Ref and PR recovery validate the actual immutable diff against the workspace path scope before settling success.

- aec523c: Add authenticated GitHub Issue admission through the standard Workroom Host, isolated coding execution and Git object upload, and a digest-bound GitHub Actions candidate provider. Keep missing service identities and deployment prerequisites blocked, with durable recovery and cancellation checks.

## 1.1.23

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/agent-feature@1.1.0
  - @zhin.js/ai@1.1.33
  - @zhin.js/core@1.1.35
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/kernel@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/mcp-feature@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9
  - @zhin.js/prompt-section@1.1.0
  - @zhin.js/schedule@1.1.0
  - @zhin.js/skill@1.1.0
  - @zhin.js/tool@1.1.0

## 1.2.1

### Patch Changes

- @zhin.js/core@1.5.16

## 1.2.0

### Minor Changes

- 12325e1: Project Root Capability Seam Tool and Skill providers through the fixed-generation
  `CapabilityIngress` through the new `capabilitySeamToken` and canonical
  `TurnToolRuntime`, including permission,
  approval, cancellation, journal, conflict, and lifecycle enforcement. Direct
  Tool and Skill invocation helpers now fail closed; use projected Turn
  capabilities for execution.

### Patch Changes

- d19e976: Repair Workroom bootstrap, planning, governed payload, Portfolio assignment, scheduling, projection, acceptance, and graceful shutdown flows so fresh self-hosted projects can execute `/work` end to end.

## 1.1.22

### Patch Changes

- a728a20: Expose the token-bound Console principal for safe Workroom sponsor initialization, generate the missing governed Console disclosure sink, use one canonical Catalog binding digest, and renew stale Project disclosure authorities after Catalog or Sponsor changes.

## 1.1.21

### Patch Changes

- 337fd05: Normalize Project Data Governance authority candidates before requesting the exact publication decision, so Workroom disclosure bootstrap persists through the canonical repository without digest drift.

## 1.1.20

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.
- Updated dependencies [882a08a]
  - @zhin.js/ai@1.5.9
  - @zhin.js/core@1.5.15

## 1.1.19

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.
- Updated dependencies [d85eddd]
  - @zhin.js/ai@1.5.8
  - @zhin.js/core@1.5.15

## 1.1.18

### Patch Changes

- a5ee497: Stop Workroom feedback loops in shared IM rooms by consuming trusted Bot principals without confusing Endpoint aliases with platform user IDs. Admit explicit mentions on member Bot endpoints, route projection replies through each member's configured or default primary endpoint, and keep governed `/work` requests inside Workroom when planning is unavailable. Converge stale Workroom projection bindings to the interaction binding revision with monotonic idempotent replay, and preserve Sponsor bindings when one Agent definition occupies multiple member roles.
- 7108d0b: Resolve uniquely mentioned Workroom members to their active Assignment, isolate Orchestrator turns from ordinary room sessions and conversation tails, remove classic subagent delegation from Workroom capabilities, deliver replies through the canonical Orchestrator Endpoint, reject untrusted bot identity metadata, and recognize implicit default Endpoints during Catalog validation.
- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - @zhin.js/ai@1.5.7

## 1.1.17

### Patch Changes

- 736fa04: Fix Workroom human-ingress replay for runtime Endpoint identities containing canonical separators, add per-member Bot/App message routes for shared rooms, acknowledge applied human input, and expose exact application errors in runtime logs.

## 1.1.16

### Patch Changes

- e9c6a73: Close lifecycle races across IM activity indicators, subagent cancellation and schedule feedback: retry inactive starts, serialize native typing keepalives with cleanup, await generation disposal without task-observer self-deadlocks, propagate subagent abort signals without delivering retired-generation results, preserve spawn/start/finish ordering, and make same-scene schedule locks executor-owned and lifecycle-drained. The deprecated global schedule-lock drain remains exported for compatibility but now fails explicitly with migration guidance instead of falsely reporting that generation-owned executors were drained.
- 902fa35: Separate Adapter definitions from live Endpoint responsibilities in activity feedback. Runtime feedback now depends on a narrow outbound send port and the concrete Endpoint control surface instead of fabricating the legacy all-in-one Adapter class.
- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/prompt-section@0.0.1
  - @zhin.js/core@1.5.14
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/ai@1.5.7
  - @zhin.js/logger@1.0.77
  - @zhin.js/skill@1.0.13
  - @zhin.js/tool@1.0.13
  - @zhin.js/agent-feature@1.0.13
  - @zhin.js/mcp-feature@1.0.13
  - @zhin.js/permission@1.0.4
  - @zhin.js/kernel@1.0.8

## 1.1.15

### Patch Changes

- 3dbf990: Add content-free Workroom readiness diagnostics and authenticated Sponsor controls for exact-sequence Run cancellation and durable replan requests.
- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13

## 1.1.14

### Patch Changes

- d336a3f: Remove the process-global Assistant, legacy orchestration, and session-tree registries. Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`; the Workroom major changeset removes `OrchestrationService` itself rather than retaining another mutable command authority. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.

  Also remove the unused process-global bootstrap gate, connection authorization queue, session agent-state store, and the empty `@zhin.js/agent/connection` compatibility subpath. The inert state-authoring contract is removed in full: `defineState`, its public definition/discovery types, `DiscoveredPluginAgentSurface.states`, `AgentSurfacePluginInfo.states`, and `agent/state/*` discovery/reporting no longer exist. These experimental APIs had no production authority or lifecycle owner; connection authorization and durable state must be supplied by explicit generation-owned ports instead.

  Remove the equally inert `defineDynamic` contract, `agent/dynamic.ts` discovery, process-global resolver registry, and per-turn prompt scratch field. Although files were reported as discovered, no production composition path ever registered them. Dynamic turn policy must be modeled as an explicit generation-owned projection rather than a latest-live module registry.

  Make the Schedule `JobWorker` the sole owner of a narrow private `ScheduleExecutionQueue`, removing the public generic orchestrator `TaskQueue`, module-level latest-generation lookup, implicit queue/timer construction fallback, speculative DAG/priority/listener APIs, and the direct-execution bypass. Queue timeout and disposal now propagate cancellation through `TaskExecutor` into the Schedule Turn, retain their concurrency/lifecycle slot until the real operation settles, settle every queued waiter, and reject use after disposal. Remove the deprecated `AssistantJob*`, `createAssistantJobStore`, `getAssistantJobsPath`, `legacyDualWrite`, and inert `jobsFile` configuration surfaces; Schedule naming and the fixed `schedule-jobs.json` path are now the only contracts.

- 0c82a7e: Remove the process-global remote Agent and task-poller registries. Remote orchestration now receives an explicitly generation-owned `RemoteAgentRegistry`; configured Agent Cards are validated and must be ready before a candidate generation can publish. Delegation, SSE continuations, non-streaming polling, and persisted-task recovery are tracked and drained by that owner, while the old public poller API has been deleted.
- b9217e4: Replace the process-global semantic-memory repository and classic memory tools with a generation-owned `SemanticMemoryRuntime` and native ToolFeature definitions. Enabling semantic memory now requires a ready Database Host and `memory_entries` model; invalid candidates fail closed instead of silently using process-global or ephemeral memory.

  Completed orchestration runs are no longer written to semantic memory implicitly. Persisting a run summary now requires an explicit, authorized memory write through the generation-owned tool/runtime, so orchestration completion and durable user memory no longer share a hidden side effect.

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

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
- 63d89f9: Remove the unconstrained `accept_task` Workroom command. Task acceptance now enters through a trusted `WorkroomAcceptancePolicyDecisionPort`; the Kernel validates exact Task/Assignment/candidate bindings and permits automatic acceptance only for low-risk, fully deterministic, evidence-complete candidates before appending a structured Acceptance Record with Journal CAS.

  Pre-policy `task.accepted` journal entries do not satisfy the new record schema and must be exported for audit and replanned instead of being silently promoted to accepted Project state.

  Task revisions must now pin an immutable Acceptance Contract and Policy snapshot before an Executor can claim them. The standard Agent Host resolves the provider through the generation-owned `workroomAcceptancePolicyDecisionToken`, so hot reload cannot replace the contract already recorded in a Run.

  Policy routes that require judgment or high-risk authority now append durable, candidate-hash-bound Reviewer Assignment or Sponsor Gate facts. Each wait records its pinned Contract/Policy, owner, deadline and recovery actions; expiry is replayable and can be reopened by a fresh policy evaluation, replanned or cancelled without waiting for an Agent response.

  Reviewer claims/verdicts and Sponsor decisions now enter through typed Kernel methods backed by a generation-owned `WorkroomAcceptanceAuthorityPort`. Every authorization is rebound to the exact Project, Run, Task, target and Journal sequence; producer self-review, stale candidates, incomplete criterion/claim disposition and untrusted authority are rejected. Reviewer-only and Reviewer-then-Sponsor routes now produce replayable Acceptance Records with principal and control-target proof.

- 71c7cdd: Add the first production Data Governance boundary. Unknown or malformed descriptor input is quarantined against a trusted category/kind confidentiality floor, while the pure disclosure policy returns only typed `full`, `metadata_only`, `transform_required`, `approval_required`, or `deny` decisions bound to the exact descriptor, policy, channel, purpose, principal, processing destination, recipient snapshot, transform, and approval scope.
- 3cca0ea: Advance the production Workroom boundary with four fail-closed contracts:

  - project accepted Task claims into immutable Task Memory and typed, CAS-bound Project State patches without admitting rejected or free-form report content;
  - persist Remote A2A dispatches in a crash-durable, fenced Memory/File Outbox with payload-sensitive idempotency and reconciliation states that cannot complete Tasks;
  - execute exact role-scoped Assignment envelopes through a cancellable observation-only Executor port; and
  - register, govern, activate, roll back, and pin immutable Project Profile revisions, requiring Sponsor authority for bootstrap or semantic capability expansion.

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

- 04b861d: Route local and remote Assignment observations through the fenced Workroom Kernel CAS, add a crash-durable authenticated Remote Callback Inbox with ordered reconciliation, and remove the legacy unfenced heartbeat and execution-completion commands.
- a23d544: Add the first independent Portfolio Admission production boundary: a strict content-free Capacity Request parser and a Portfolio-only Journal repository contract with expected-sequence CAS, payload-sensitive idempotency, immutable atomic Resource Bundles, and explicit rejection of Workroom Task, Plan, Context, Memory, Artifact, Evidence, prompt, message, title, and tool-argument payloads.
- 8cddabf: Add production Workroom execution infrastructure: a durable remote-dispatch worker, a constrained local Assignment Executor, a crash-durable Profile Journal, atomic Portfolio Resource Bundle admission, and content-free materialized Disclosure Manifests backed by trusted policy and destination digests.
- dbe5081: Add the first production contracts for the remaining Workroom cutover:

  - immutable, content-digested Remote A2A Dispatch envelopes and a generation-owned outbound executor port whose receipts are observations rather than Task terminal facts;
  - a fail-closed Profile compiler for exact Capability Pack revisions and generation capability supply; and
  - an I/O-free `WorkflowPlanBuilder` that returns deterministic versioned DAG proposals without executing Agents or writing Workroom state.

- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/core@1.5.12
  - @zhin.js/ai@1.5.6
  - @zhin.js/agent-feature@1.0.12
  - @zhin.js/mcp-feature@1.0.12
  - @zhin.js/permission@1.0.3
  - @zhin.js/skill@1.0.12
  - @zhin.js/tool@1.0.12

## 1.1.13

### Patch Changes

- @zhin.js/core@1.5.11

## 1.1.12

### Patch Changes

- Updated dependencies [0b8b5bd]
  - @zhin.js/ai@1.5.5
  - @zhin.js/core@1.5.10

## 1.1.11

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - @zhin.js/agent-feature@1.0.11
  - @zhin.js/mcp-feature@1.0.11
  - @zhin.js/skill@1.0.11
  - @zhin.js/tool@1.0.11

## 1.1.10

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/ai@1.5.4
  - @zhin.js/agent-feature@1.0.10
  - @zhin.js/mcp-feature@1.0.10
  - @zhin.js/skill@1.0.10

## 1.1.9

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

- 6fb24dd: Replace the concrete `AIService` and `ZhinAgent` escape hatches on `AgentHostPort`
  with a canonical protocol port that lists immutable Agent bindings and executes
  `TurnRequest`s. `AgentRuntime` selections now require the immutable binding for
  the turn so provider/model state remains isolated across concurrent requests.

  Route A2A tasks through the canonical Agent runtime without synthetic IM
  messages or shared `agent.configure()` mutation. A2A callers now enter as a
  fail-closed `user` principal, cancellation propagates through the turn
  `AbortSignal`, and task completion continues to project through the A2A event
  bus.

- d162216: Replace Message-shaped session management with canonical session-key interfaces.
  `ZhinAgent.archiveSession`, `ZhinAgent.compactSession`, and the session-tree
  helpers now accept a stable session key instead of a synthetic IM Message.

  Route Plugin Runtime transcript recording, passive group context, management
  commands, and Owner approval through immutable Turn access/address data. Owner
  approval persistence now has one origin-neutral implementation shared by the
  canonical command path and the remaining classic policy adapter. Ordinary IM
  turns no longer construct a synthetic Message; that projection is isolated to
  configured collaboration Cell orchestration.

- 7427818: Route scheduled and preview Agent work through the generation-owned canonical Turn ingress and the single full Agent core. Remove the synthetic IM Message schedule path, legacy schedule-context execution branch, and duplicated schedule tool-security wrapper.

  Add a typed direct capability-resolution event and explicit canonical Shell preset authority. Schedule execution is stateless, fail-closed, journaled, budgeted, audited, and uses the same capability policy/runtime as other canonical turns.

- 90da255: Remove the unreachable classic Plugin bootstrap, process-global authoring registration, and the parallel HTTP Agent session runtime. Agent setup is now owned exclusively by the Plugin Runtime composition root, authoring capabilities are published only through generation projections, and transport approval must be supplied explicitly through `ApprovalPort`.

  Also remove the classic proactive-dispatch factory and stop `AIService` standalone agents from fabricating an authenticated IM message. Standalone execution without an authenticated IM origin now carries no message authority and therefore remains fail-closed under tool policy.

  BREAKING CHANGE: `initAgentModule`, `createAgentSessionHostPort`, `HttpAgentSessionStore`, `FileHttpSessionPersistence`, `HttpStepProjector`, `HttpApprovalWaiter`, `createProactiveOutboundService`, `registerPluginAgentSurfaces`, and related HTTP-session types are removed. Protocol hosts must execute canonical `TurnRequest` values through the generation-owned `AgentHostPort`; proactive delivery must be implemented by the generation-owned IM runtime.

- 953cfe1: Remove the obsolete Collaboration Scene/Cell domain after Agent coordination
  moved to the Orchestration Kernel. This deletes `/collab`, the initialization
  wizard, Scene identity and membership repositories, archived Cell pipeline
  state, seven Collaboration database tables, and their public exports.

  The top-level `collaboration` configuration key is no longer accepted and now
  fails schema validation. Agent startup is selected only by `ai` or `assistant`.

  Keep the optional Five-Agent workflow as an independent Agent module with
  `FiveAgentRole`, role binding, and role capability policy interfaces. It no
  longer depends on IM scenes, Bot membership, or text handback conventions.

  Remove `StructuredOutboundDetectInput.collaborationCell`; structured outbound
  selection is based only on tool, handoff, and Adapter capability requirements.

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

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/mcp-feature@1.0.9
  - @zhin.js/tool@1.0.9
  - @zhin.js/ai@1.5.3
  - @zhin.js/agent-feature@1.0.9
  - @zhin.js/permission@1.0.2
  - @zhin.js/skill@1.0.9

## 1.1.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7

## 1.1.7

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

  - @zhin.js/core@1.5.6

## 1.1.6

### Patch Changes

- @zhin.js/core@1.5.5

## 1.1.5

### Patch Changes

- 6f9c366: Make the full Agent Core origin-neutral by removing legacy IM Message and Plugin
  lifecycle dependencies from model execution, compaction, and tool hooks. Tool
  security remains exclusively owned by the required per-turn
  `ToolExecutionAuthority`.
- 373a56b: Make the full Agent Core depend on one required ToolExecutionAuthority. Policy, approval, journal, cancellation, and execution now remain behind a turn-owned adapter, allowing canonical TurnToolRuntime execution without a second Agent loop or duplicate approval path.
- 0de46a8: 删除进程级 `AgentRuntimeRegistry` 与按 Endpoint 复制 `ZhinAgent` 的运行时子图。

  Plugin Runtime 现在只有一个 generation-owned Agent 权威；协作任务通过显式 binding 在该 Agent 的 SubAgent 系统中执行，不再通过 Endpoint key 查找或隐式回退到另一个可变 Agent 实例。持久化就绪状态也只提交给当前 generation 的 Agent。

  Console 的 Agent 工具、MCP、会话树、Assistant 与 Orchestration 端口统一从其正在观察的 `RuntimeSnapshot` 根资源读取 `agentHostToken`，不再拼接多个“最新 generation”全局 store。相应移除公开的 registry/bootstrap API。

  Console Host 的 Agent runtime 接口改为 lease-bound `acquireAgentRuntime`；所有异步 Session、Assistant 与 Orchestration 操作在完成前持有 generation lease，避免 HMR 中途销毁正在使用的旧代资源。

- b08f7fe: refactor(agent): migrate global registries to generation-scoped stores

  Replace module-level global singletons with createGenerationStore across
  orchestration, schedule, session-tree, typing-indicator, assistant,
  collaboration, and memory-entry registries. Pattern changes from
  set*/register* to provide\* with lifecycle-bound disposal. AgentDispatcher
  is now owned by OrchestrationKernel instead of a global singleton.
  AIService removes chat/chatStream/ask methods (use completeText).
  New spawn-delegation module detects async vs sync spawn_task results.
  KeyedMutex utility added for per-key async serialization.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- a9fa72e: Make Context System builders and injectors consume canonical Turn identity rather than Core IM `Message`. Schedule context is now selected explicitly from the Turn origin, uses a native Schedule session/principal projection, and fails closed when the job identity is absent.
- c8de3ef: Replace Home Assistant's legacy `ZhinTool` and IM `Message` execution boundary with native generation-owned Agent Tool definitions. Home authorization now consumes the authenticated canonical tool principal, and the CLI publishes Home tools only through the Tool Feature projection.

  Configured Agent and Home candidate initialization now fail closed instead of publishing a generation with the requested capability silently absent.

- 60f0fc8: Route production IM Agent turns through the Root-owned `AgentRuntime` and the
  generation-owned full `AgentTurnEngine`. Add canonical deferred capability
  loading for projected tools and skills, keep policy/audit execution under the
  turn authority, and remove the production `ZhinAgent.processTurn` bridge.
- 574c990: Replace Message-based passive group context APIs with canonical session/principal observations, remove the deprecated append API, and make TurnIngress session preparation drain passive context by its fixed session identity.
- d096f16: Replace schedule management tools' legacy `ZhinTool` and IM `Message` boundary with native Agent Tool definitions and canonical invocation identity. Schedule creation now derives creator and delivery target from the authenticated tool principal and origin.

  Remove the process-global Schedule manager registry. Every generated Schedule Tool set closes over its own generation manager, preventing in-flight old-generation turns from crossing into a newer engine.

- 3f29623: Require every Tool invocation to carry immutable permission, unattended, and network policy into `ToolExecutionContext`. Tool transports can now enforce the exact fixed-Turn authority at each side-effect boundary without process-global execution context.
- 2916852: Make canonical invocation origin and principal display identity part of every
  Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
  carry structured origin data through ToolIndex instead of requiring tools to
  read a legacy IM Message side channel.
- d047869: Make the canonical Turn Tool Runtime enforce file and Bash policy before execution. File writes, sensitive reads, unsafe shell commands, shell mutations, and shell reads of sensitive paths now use the shared policy facade and fail closed from authenticated Turn principal roles.
- 162fa34: Publish `ask_user` as a generation-owned ToolFeature backed by a Root-owned, origin-neutral InteractionRouter.

  Tool execution now receives an optional turn-scoped QuestionPort. The IM composition root binds that port to the canonical session and authenticated sender, and ImRuntime can claim pending interaction replies before middleware, commands, or Agent fallback. Invalid replies use the current message's delivery authority; the router never retains an expired Runtime Message or Adapter handle. Missing interactive authority, ambiguous sessions, delivery failures, cancellation, and Root shutdown fail closed.

  BREAKING CHANGE: canonical Agent turns no longer rely on Plugin Prompt middleware or mutable global ask-user registries for `ask_user`. Ingress adapters that support interactive questions must provide a QuestionPort; unattended turns cannot expose one.

- e62561e: Replace Message-based inbound media resolution with canonical `TurnMedia` processing. IM segment fallback and platform references are projected only by the ingress adapter before media materialization, transcription, and model injection.
- 3eeeb46: Add explicit, fail-closed network authority to canonical Turn policy. Web tools and Bash network commands are denied unless the Turn grants network access; URL-bearing operations enforce absolute URLs, HTTPS constraints, SSRF protection, and domain allowlists before execution.
- 85d0f82: Require an explicit immutable Agent prompt profile for interactive and Schedule Turns. Prompt assembly no longer discovers Schedule mode from ambient storage or borrows synthetic IM platform/session fields, and the unused fast-path prompt API has been removed.
- 61bfc1c: Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

  Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.

- 04bad47: Fail closed when a required tool execution fact cannot be written to the Turn
  Journal. Journal integrity failures now abort the model loop and return the
  stable `turn_journal_commit_failed` outcome instead of becoming tool output.
- e40b048: Require generation leases at the IM ingress route instead of exposing a bare
  snapshot. Snapshot leases are store-owned, expose their active state, and can
  be rejected when presented to an Agent Runtime attached to another Root.

  Project configured MCP clients into the generation lifecycle. Configured
  servers must become ready during candidate activation; activation failure is
  fail-closed and leaves the previous generation serving traffic. Agent bindings
  filter the MCP servers visible to a turn, and MCP tools use owner-qualified
  `${qualifiedServer}__${tool}` names with fail-closed approval metadata.

- 5a5b1bb: Resolve the complete Agent Turn engine from the fixed generation snapshot instead of capturing a constructor callback. `AgentRuntime` now fails closed when the active generation does not provide `agentTurnEngineToken`.
- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- d254a81: Publish the built-in file capability family as native, generation-owned ToolFeatures on the canonical IM Turn path.

  File execution now requires explicit Turn workspace authority. The shared policy facade canonicalizes existing targets, symlinks, and missing write targets before checking workspace containment and sensitive paths, then passes that exact authorized input to the executor. Missing authority, home-relative paths, directory escape, and symlink escape fail closed. Native read, write, edit, list, glob, and grep tools consume ToolExecutionContext and AbortSignal directly; glob and grep no longer spawn shell commands.

  BREAKING CHANGE: `runTurnToolPolicies` is asynchronous and successful/approval decisions carry the authorized input. `createRuntimeTurnRequest` requires `workspaceRoot`, and canonical file tools no longer permit paths outside that workspace.

- 7123c47: Publish `web_fetch` and `web_search` as native generation-owned ToolFeatures on the canonical IM Turn path.

  Both tools now use one Turn-scoped network module that authorizes every redirect hop, rejects non-public DNS results, pins the socket connection to the reviewed address while preserving HTTPS SNI and Host, enforces cancellation, timeout, redirect, and response-size limits, and records transport policy rejection as a canonical denied tool event. Interactive IM turns receive HTTPS authority only from the explicit `network` execution preset.

  BREAKING CHANGE: the canonical web tools no longer consume ambient AsyncLocalStorage network policy or automatic fetch redirects. Deployments must explicitly select the `network` preset, and non-public or non-HTTPS targets fail closed.

- 05befc1: Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
- 0663b6a: Make the public Turn Context Envelope consume canonical Turn origin, principal, and session data instead of IM `Message`. IM metadata is now validated and projected only by the ingress adapter, while Schedule, HTTP, A2A, and internal Turns describe their native origins without fabricated platform fields.
- f28f9b3: Remove ambient mutable Schedule state from the Agent turn context. Schedule authority now flows explicitly through the existing Context, Prompt, and Tool pipelines, while Schedule feedback events publish their job identity directly from TaskExecutor instead of mirroring it through legacy plugin-event ALS.
- 9f340f7: Delete the classic Plugin/Message-based `ask_user` implementation and its global pending-session middleware.

  Interactive clarification now has one authority: the generation-owned `ask_user` ToolFeature and turn-scoped QuestionPort. Security approval remains a separate, explicit ApprovalPort and fails closed when the ingress does not provide one. AIService no longer accepts a Plugin to inject interactive tools, classic built-in aggregation no longer publishes `ask_user`, and post-tool owner prompting no longer bypasses the approval boundary.

  BREAKING CHANGE: `AskUserBuiltinTool`, `AskUserSessionService`, `createAskUserTool`, `AIService.setPlugin`, `ImApprovalAdapter`, `SessionInteractionPort`, and owner hard-orchestration exports are removed. Hosts must provide QuestionPort for ordinary questions and ApprovalPort for security decisions.

- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- 5eedd26: Publish `todo_read` and `todo_write` as native generation-owned ToolFeatures backed by a session-addressed, crash-safe TodoStore.

  The canonical session key is now the only TODO identity. Storage filenames are hashes, replacements are serialized and atomically renamed, aborted writes are never published, and model input cannot select a chat identifier or filesystem path. `.zhin/` is now runtime-private state and generic file tools cannot read or enumerate journals, TODO documents, or other authority-owned files.

  BREAKING CHANGE: `todo_read` and `todo_write` no longer accept `chat_id`; TODO state is isolated by the canonical Turn session and moved to `.zhin/todos`.

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

- f919b6f: Add one Turn Event source module that owns concurrent worker-to-stream bridging,
  exactly-once terminal emission, error mapping, and worker settlement. Reuse it
  from the existing streaming turn path so future IM ingress adapters do not
  reimplement event queues or release generation leases while work is active.

  Agent surface diagnostics now include root `tools/` convention entries as well
  as `agent/tools/`, matching Plugin Runtime discovery.

- 098e411: Schedule the canonical Agent `TurnEvent` stream through `PromptController` and
  persist synthesized failure, cancellation, and missing-terminal facts before
  returning a `TurnOutcome`.
- e1b7c01: Commit the durable Agent terminal before conversation, session, metrics, and IM
  reply projections. Projection failures are isolated diagnostics and cannot
  rewrite the committed `TurnOutcome`.
- 9b94f87: Replace Message-keyed deferred tool state with a turn-owned deferred controller. Deferred meta tools are now created by the Agent turn, concurrent turns and subagents receive isolated state, and the legacy WeakMap binding API has been removed.
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
- Updated dependencies [b0f37ae]
- Updated dependencies [c50aca3]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [61bfc1c]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [05befc1]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/permission@1.0.1
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/ai@1.5.2
  - @zhin.js/tool@1.0.8
  - @zhin.js/mcp-feature@1.0.8
  - @zhin.js/kernel@1.0.7
  - @zhin.js/agent-feature@1.0.8
  - @zhin.js/skill@1.0.8

## 1.1.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/schedule@0.0.5
  - @zhin.js/agent-feature@1.0.7
  - @zhin.js/ai@1.5.1
  - @zhin.js/core@1.5.3
  - @zhin.js/kernel@1.0.6
  - @zhin.js/mcp-feature@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/skill@1.0.7
  - @zhin.js/tool@1.0.7

## 1.1.3

### Patch Changes

- 2e41ad5: fix: agent 优化
- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent-feature@1.0.6
  - @zhin.js/mcp-feature@1.0.6
  - @zhin.js/skill@1.0.6
  - @zhin.js/tool@1.0.6

## 1.1.2

### Patch Changes

- 696ab1b: fix(agent): subagent 延迟加载工具执行报 "Unknown tool" + 父会话 snapshot 污染

  子 Agent / standalone loop 此前只有静态工具集：`load_tool` 报"加载成功"（写 snapshot）但 executor 找不到新加载的工具，模型反复重试空耗 token（实测 15 轮 77s 无法识别图片）。修复：

  - standalone loop 接入与主 loop 相同的延迟加载机制：`load_tool` 命中后从 catalog 并入完整工具、重建 schema 并补全一轮（`refreshTools` + `shouldRecompleteAfterTool`）。
  - deferred runtime 增加 AsyncLocalStorage 隔离通道：子 loop 的 snapshot 从父会话克隆（可见父已加载工具），但其 `load_tool` 变更只活在本 loop，不再写父会话 snapshot。

## 1.1.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent-feature@1.0.5
  - @zhin.js/core@1.5.1
  - @zhin.js/mcp-feature@1.0.5
  - @zhin.js/skill@1.0.5
  - @zhin.js/tool@1.0.5

## 1.1.0

### Minor Changes

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

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0
  - @zhin.js/core@1.5.0

## 1.0.10

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/ai@1.4.8
  - @zhin.js/core@1.4.3

## 1.0.9

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3

## 1.0.8

### Patch Changes

- f346346: fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层
- Updated dependencies [f346346]
  - @zhin.js/ai@1.4.7
  - @zhin.js/core@1.4.2

## 1.0.7

### Patch Changes

- @zhin.js/agent-feature@1.0.4
- @zhin.js/mcp-feature@1.0.4
- @zhin.js/skill@1.0.4
- @zhin.js/tool@1.0.4
- @zhin.js/core@1.4.2

## 1.0.6

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

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [f0ec5ab]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/tool@1.0.3
  - @zhin.js/mcp-feature@1.0.3
  - @zhin.js/ai@1.4.6
  - @zhin.js/schedule@0.0.4
  - @zhin.js/core@1.4.1
  - @zhin.js/agent-feature@1.0.3
  - @zhin.js/skill@1.0.3
  - @zhin.js/kernel@1.0.5

## 1.0.5

### Patch Changes

- 3ea84a0: Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- Updated dependencies [7db69c1]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent-feature@1.0.2
  - @zhin.js/mcp-feature@1.0.2
  - @zhin.js/skill@1.0.2
  - @zhin.js/tool@1.0.2

## 1.0.4

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

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

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/schedule@0.0.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/kernel@1.0.4
  - @zhin.js/ai@1.4.5
  - @zhin.js/agent-feature@1.0.1
  - @zhin.js/mcp-feature@1.0.1
  - @zhin.js/skill@1.0.1
  - @zhin.js/tool@1.0.1

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/schedule@0.0.2
  - @zhin.js/ai@1.4.4

## 1.0.2

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/schedule@0.0.1
  - @zhin.js/ai@1.4.3

## 1.0.1

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2
  - @zhin.js/ai@1.4.2
  - @zhin.js/logger@1.0.72

## 1.0.0

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.3.1)

## 0.3.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- 93e58d9: refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

  - 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
  - `core/index.ts` 移除死导出、统一结构
  - 新增 `Disposable` 接口替代 `as any` dispose 调用
  - `bridge.ts` MCP inputSchema 类型安全
  - 脚手架依赖版本锁定（latest → ^major.minor.0）
  - 修复 icqq/sandbox 客户端缺失 Bot 图标导入

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/core@1.3.1
  - @zhin.js/ai@1.4.1

## 0.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0
  - @zhin.js/core@1.3.0

## 0.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/core@1.2.1
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71

## 0.2.0

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
- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - @zhin.js/ai@1.2.0

## 0.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/core@1.1.33
  - @zhin.js/ai@1.1.31

## 0.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30

## Unreleased

### Minor Changes

- **Assistant Runtime（路线 A）**：M1–M5 统一 JobStore、Event Ingress、NotificationRouter、Home Domain、Assistant Profile
  - `assistant.enabled` opt-in；`assistant-jobs.json` SSOT
  - `POST /api/assistant/events`、`GET /api/assistant/jobs`
  - `home_*` 工具、`assistant.profile.yml` Bootstrap 合并
  - `notify.channel` 多通道；`cron_add notify_channel` 参数
  - Profile `morningBrief` / `bedtimeCheck` cron routines → JobStore
  - `assistant.queue` TaskQueue（重试 / 并发 / 死信）
  - `syncSchedulerJobsFromLegacy`；assistant.enabled 时关闭 legacy Scheduler
  - `assistant.home.mcpServer` 与 `ai.mcpServers` 校验；Profile 设备别名合并
  - `CronJobContext` / `context` 已移除（破坏性）；`cron-jobs.json` / `assistant-jobs.json` 必须含 `notify`
  - `zhin cron add --notify-channel`；Console RPC `cron:add` 使用 `notify` / `notifyChannel`（默认 silent）
  - `legacyDualWrite` 默认 false

## 0.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- c8f8207: fix: 增加重启恢复会话功能
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
  - @zhin.js/logger@0.1.70
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31

## 0.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/core@1.1.29
  - @zhin.js/ai@1.1.27

## 0.1.26

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/ai@1.1.26

## 0.1.25

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化
  - @zhin.js/logger@0.1.67
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25

## 0.1.24

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24

## 0.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/ai@1.1.23

## 0.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24

## 0.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21

## 0.1.20

### Patch Changes

- 3b3e49b: fix: ask 工具修复,icqq skill 优化
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20

## 0.1.19

### Patch Changes

- 92da96d: fix skill 激活优化
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19

## 0.1.18

### Patch Changes

- 88caeb2: fix: ask user 护栏
- Updated dependencies [88caeb2]
  - @zhin.js/core@1.1.20
  - @zhin.js/ai@1.1.18

## 0.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
- Updated dependencies [fcad030]
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19

## 0.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/ai@1.1.16
  - @zhin.js/core@1.1.18

## Unreleased

### Changed

- 子代理默认继续使用最小工具继承（不自动继承主会话 skill/tool）；可通过 `ai.agent.subagentTools` 显式追加子代理可用工具白名单。

## 0.1.15

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/core@1.1.17

## 0.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14

## 0.1.13

### Patch Changes

- 63d0b88: fix: 定时任务优化
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13

## 0.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14

## 0.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13

## 0.1.10

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/ai@1.1.10

## 0.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
- Updated dependencies [0eba6d6]
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9

## 0.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/core@1.1.7

## 0.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6

## 0.1.5

### Patch Changes

- ba30934: fix: web 优化
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5

## 0.1.4

### Patch Changes

- bf0dc75: fix: 幻觉优化
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4

## 0.1.3

### Patch Changes

- a257f3f: fix: 定时任务提示词优化
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3

## 0.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/core@1.1.2
  - @zhin.js/ai@1.1.2

## 0.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1

## 0.1.0

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

- Updated dependencies [8280fe7]
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0

## 0.0.20

### Patch Changes

- c606a57: fix: ask_user 优化
- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - @zhin.js/ai@1.0.18

## 0.0.19

### Patch Changes

- 20ab379: fix: ai 优化
- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56

## 0.0.18

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - @zhin.js/ai@1.0.16

## 0.0.17

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54

## 0.0.16

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/ai@1.0.14

## 0.0.15

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/ai@1.0.13

## 0.0.14

### Patch Changes

- 607acc4: fix: 视觉模型处理
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12

## 0.0.13

### Patch Changes

- 2510365: fix: 文件安全拦截
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11

## 0.0.12

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - @zhin.js/ai@1.0.10

## 0.0.11

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - @zhin.js/ai@1.0.9

## 0.0.10

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - @zhin.js/ai@1.0.8

## 0.0.9

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46

## 0.0.8

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6

## 0.0.7

### Patch Changes

- 4f2fb55: fix: agent bug
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/ai@1.0.4

## 0.0.5

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42

## 0.0.4

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/ai@1.0.2

## 0.0.3

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - @zhin.js/ai@1.0.1

## 0.0.2

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39

## 0.0.1

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
