---
"@zhin.js/adapter": patch
"@zhin.js/host-http": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/permission": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-sandbox": patch
---

#1250 第 87 批：角色与 Sandbox（ADR 0060 §5.4）。

- 「以我的聊天身份发言」第一条消息即生效（sandbox-speak-as-me）：还没有 Sandbox 身份时，服务端在处理这条消息前为已登录的 Console 用户建立 `console-<用户 id>`（与 `chat-identities.simulated.ensure` 同一次写入与同一门槛），并以它发言，不再依赖页面先发 RPC。（行为变化）Sandbox 的「以我的聊天身份发言」现在与该 RPC 一样**需要 Console 权限 `self.chat-identity`**（内置角色都带）：没有时消息按模拟身份发送，回显 `asMeUnavailable: 'needs-self-chat-identity'`，页面关闭开关并说明缺这项权限。这一写能力不放在插件可读的 `chatRolesToken` 上：`@zhin.js/adapter` 新增 Root 私有（仅 Adapter Feature 投影时可读）的 `simulatedConsoleSpeakerToken` 与类型 `SimulatedConsoleSpeakerHost` / `AdapterConsoleSpeakerPort`，实例提供它，Adapter Feature 只给**受信的**模拟适配器（新增 `declaresLocalSimulation` / `isTrustedSimulationAdapter` / `isTrustedSimulationAdapterPackage` / `TRUSTED_SIMULATION_ADAPTER_PACKAGES`：能力画像声明 `runtime.sandbox` 且所属包是 `@zhin.js/adapter-sandbox`；第三方插件声明 `runtime.sandbox` 仍按模拟适配器对待，但拿不到端口）一个按所属插件绑定的 `AdapterContext.consoleSpeaker`（`ensure(conversation, principal)`）。适配器交出的 principal 不被信任其内容：`@zhin.js/host-http` 的路由新增（不在插件可见的按代绑定 Host 上的）`isHostIssuedPrincipal(value)`，按 Host 实例记录它交给路由 / socket 的 principal 对象（深度冻结），`createBridgedHttpHost` 与 Node Host（含多监听组）同样提供；实例只接受自己的 Host 交出的那个对象，适配器构造的同形对象（哪怕带全局 `iam.manage`）、拷贝或别的 Host 的 principal 一律拒绝（`not-host-issued`），不写任何人、身份或链接；之后 `self.chat-identity` 与全局 `iam.manage` 才从该 principal 判断，且只写该插件的模拟适配器、该适配器上的会话。建立失败或 10 秒内未完成时消息按模拟身份发送，回显带 `asMeUnavailable: 'identity-failed'` 与 `asMeError`；Sandbox 页面在这种情况（以及 `needs-global-iam`）下关闭开关并显示原因。同一连接上的消息按到达顺序处理；连接关闭（含 `principal-revoked`）后已排队、尚未执行的帧不再派发。
- 不再给模拟发送者授予角色（grant-owner-to-simulated-identity-silent）：模拟适配器上只有 Console Sandbox 身份（其人链接了 Console 用户）会发言，`chat-roles.grant` 给 `sandbox-user` 这类自填 id 授予时返回 400 `simulated-identity` 并指引「以我的聊天身份发言」，聊天中的 `角色 授予` 同样拒绝（撤销照常）。「是否已有全局 owner」（认领、「需要你处理」、`zhin status`、`suggestGlobalOwner`、聊天无主提示）不再把只落在这类 id 上的 owner 授予算作有效。
- `绑定 <码>` 免命令前缀（bind-hint-omits-command-prefix）：与 `认领 <码>` 一样在入站最早处接手（带前缀也有效）。（行为变化）**只在存在开放的绑定码时才免前缀接手**：有效码一律接手（不进会话历史、日志脱敏；群聊中作废并提示改私聊），私聊里形如绑定码的错码也接手（回复「不正确或已过期」并计数，5 次锁 10 分钟）；没有任何开放码时什么都不接手、也不计失败，`bind username`、`绑定 82345678` 与项目自己的 `绑定 <QQ号>` 之类命令照常到达命令和 Agent。被接手的消息在处理前被丢弃时，它携带的开放码作废。`@zhin.js/permission` 的全局 owner 说明改为固定的「绑定 <码>（不需要命令前缀）」，`bindCommand` / `commandPrefix` 仍接受但不再影响文案；「需要你处理」的绑定提示同步。`@zhin.js/agent`：主人 `approve` 指令的拒绝文案随之变为「绑定 <码>（不需要命令前缀）」（原为带本账号前缀的「/绑定 <码>」/「!bind <code>」），不再向 `describeGlobalOwnerRequired` 传 `commandPrefix`。
- 只装了模拟适配器时的引导（owner-hints-dead-end-sandbox-only）：`zhin status`、启动日志、「需要你处理」的 `chat-roles.no-owner`（`state.simulationOnly`）、聊天中的无主提示，以及认领 / 绑定在模拟适配器上的拒绝文案，都改为指向「在 Sandbox 打开『以我的聊天身份发言』，再到『聊天角色』把全局 owner 授予这个身份」。每次换代（适配器增减）都会重新判断是否已有全局 owner 并刷新认领码文件与日志中的 `simulationOnly` 引导（已开放的认领码不轮换）。
- 最近发言人（chat-recent-speakers-empty）：模拟发送者按设计不记录；`@zhin.js/console-protocol` 的 `ConsoleChatIdentitiesRecentResult` 新增 `simulatedSendersOmitted`（作用范围内的模拟适配器别名），`ConsoleChatIdentity` 新增 `simulatedSender`（模拟适配器上永不发言的 id），供 Console 显示「模拟发送者不出现在这里」，代替空列表与「90 天内没有发言」。
