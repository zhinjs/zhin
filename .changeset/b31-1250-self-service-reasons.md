---
"@zhin.js/command": minor
"@zhin.js/core": minor
"@zhin.js/console-protocol": minor
"zhin.js": patch
"@zhin.js/adapter-sandbox": patch
---

没回复、被拒绝、离线都说清原因（zhinjs/zhin#1250 第 31 批）：

- `self-service-unknown-conversation-opaque`（回退的根因）：第 9 批（ADR 0060 P3，b6ec01464「Sandbox speaks as the linked chat identity; typed ids are simulated and role-less」）起，Sandbox 里手填的发送者以 `~sim:<id>` 进入运行时，而 `chatRoleMessageContext()` 把这种保留 id 当成「无法识别」，`功能` / `角色` / `认领` / `绑定` 都只回「无法识别当前会话。」；之前同一个群里 `功能 关闭 repeater` 能用，是因为当时手填的 id 还会被当成真实身份。现在 `@zhin.js/core` 新增 `resolveChatRoleMessageContext()`，返回 `{ ok: false, reason }`（`no-conversation` / `unknown-endpoint` / `no-adapter` / `no-sender` / `simulated-sender` / `invalid-sender`），实例侧再加 `unkeyed-conversation`（适配器没有提供可用的会话类型或会话 id）；四个指令按原因回复下一步（如「你正以模拟身份发言……请在 Sandbox 打开『以我的身份发言』，或在 Console『功能』/『聊天角色』页设置」）。不带参数的 `功能` / `角色` 直接列出。
- 被拒绝或失败的自助指令不再记成 `command_replied | executed`：`UserFacingError` 新增闭合的拒绝码 `reason`，指令派发结果带 `refusalReason`，入站结局记 `refused` 与该码（如 `simulated-sender`、`not-admin`、`usage`、`locked`、`self-service-disabled`），回复文字不变。没有码的 `UserFacingError` 仍记 `user_facing_error`。
- `unaddressed-message-no-record`（复测失败的根因）：第 18 批之后，没被 @、不是指令的群消息其实已经记了 `not_addressed`，但未点名的静默结局一律只写 debug 日志，Console 的运行日志看不到；结局只存在进程内，Sandbox 和轨迹页也没有入口，看起来就像「什么都没记」。现在每个会话每分钟第一条 `not_addressed` 写 info（`inbound_outcome | … | sampled: first_per_minute`），其余仍为 debug；新增 `GET {base}/conversations/outcomes`（`endpoint.view`，只限当前 Sandbox 连接绑定的会话、且只列该连接 owner 本人或其模拟身份发出的消息；只返回结局码和面向发送者的文案，不含插件名、阶段等运维文案），Sandbox 发消息后读取这条消息的结局，没有回复时显示原因（如「这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。（not_addressed · no_command_not_ambient）」）。`ConsoleMessageDiagnostic` 补上已有的 `outcome` 字段。
- `console-offline-no-reason`：适配器不上报连接状态（如 GitHub 这类 Webhook 适配器）且没有失败记录的已启动账号，不再显示「离线 · 连接状态：未知」，改为「未上报连接状态」（提示级），并说明常见原因与检查方法；确实离线时附上最近一次失败的原因、失败时间与自动重试次数 / 下次重试时间。这些只改显示文字：条目的 revision 与之前相同，已忽略的待办不会重新出现（「已从配置导入聊天角色」的 revision 也仍按原始条目数计算）。
- `principal-link-attention-ids`：「人员名单或身份链接等待确认」按人分组，每个身份写出适配器与账号（`qq·bot-a`），平台 id 只显示后 4 位（`尾号 1234`），数量按去重后的 (adapter, endpoint, userId) 计算；查看者本人显示为「你（显示名）」，其他 Console 用户显示 id 前 8 位，条目新增 `links`（`ConsoleAttentionItem.links`）供 Console 按 `iam.users.list` 换成用户名。
