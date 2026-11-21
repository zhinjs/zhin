---
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/permission": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-sandbox": patch
---

#1250 第 87 批：角色与 Sandbox（ADR 0060 §5.4）。

- 「以我的聊天身份发言」第一条消息即生效（sandbox-speak-as-me）：还没有 Sandbox 身份时，服务端在处理这条消息前为已登录的 Console 用户建立 `console-<用户 id>`（与 `chat-identities.simulated.ensure` 同一次写入与同一门槛），并以它发言，不再依赖页面先发 RPC。`@zhin.js/core` 的 `ChatRoleReader` 新增可选方法 `ensureConsoleSpeaker(conversation, consoleUserId, { canManageGlobal, displayName })` 与类型 `ChatEnsureConsoleSpeakerOptions`，`createChatRoleReader` 新增选项 `ensureConsoleSpeaker`（实例只在模拟适配器上写入）。建立失败时消息按模拟身份发送，回显带 `asMeUnavailable: 'identity-failed'` 与 `asMeError`；Sandbox 页面在这种情况（以及 `needs-global-iam`）下关闭开关并显示原因。同一连接上的消息按到达顺序处理。
- 不再给模拟发送者授予角色（grant-owner-to-simulated-identity-silent）：模拟适配器上只有 Console Sandbox 身份（其人链接了 Console 用户）会发言，`chat-roles.grant` 给 `sandbox-user` 这类自填 id 授予时返回 400 `simulated-identity` 并指引「以我的聊天身份发言」，聊天中的 `角色 授予` 同样拒绝（撤销照常）。「是否已有全局 owner」（认领、「需要你处理」、`zhin status`、`suggestGlobalOwner`、聊天无主提示）不再把只落在这类 id 上的 owner 授予算作有效。
- `绑定 <码>` 免命令前缀（bind-hint-omits-command-prefix）：与 `认领 <码>` 一样在入站最早处接手（带前缀也有效）；`@zhin.js/permission` 的全局 owner 说明改为「绑定 <码>（不需要命令前缀）」，`bindCommand` / `commandPrefix` 仍接受但不再影响文案；「需要你处理」的绑定提示同步。
- 只装了模拟适配器时的引导（owner-hints-dead-end-sandbox-only）：`zhin status`、启动日志、「需要你处理」的 `chat-roles.no-owner`（`state.simulationOnly`）、聊天中的无主提示，以及认领 / 绑定在模拟适配器上的拒绝文案，都改为指向「在 Sandbox 打开『以我的聊天身份发言』，再到『聊天角色』把全局 owner 授予这个身份」。
- 最近发言人（chat-recent-speakers-empty）：模拟发送者按设计不记录；`@zhin.js/console-protocol` 的 `ConsoleChatIdentitiesRecentResult` 新增 `simulatedSendersOmitted`（作用范围内的模拟适配器别名），`ConsoleChatIdentity` 新增 `simulatedSender`（模拟适配器上永不发言的 id），供 Console 显示「模拟发送者不出现在这里」，代替空列表与「90 天内没有发言」。
