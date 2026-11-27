---
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/adapter-sandbox": patch
---

**Sandbox：刷新后恢复等待中的交互、切换会话不再丢回复**（#1250 b114）。

- 刷新 Sandbox 页面后，仍在等待回答的确认卡 / 按钮交互重新出现在「待处理操作」里并可完成。以前 `GET /api/interactions/pending` 只按连接的 `owner` 读取，而 Sandbox 页面发言用的是模拟发言人（`~sim:<ID>`）或你的聊天身份，从来不是 `owner`，所以页面自己触发的交互刷新后一个也读不到，历史消息里的按钮又是只读的，交互只能等到超时。现在该接口列出当前会话里所有仍有效的交互（含 `answeredBy: 'anyone'`），每条只返回 `id`、`generation`、`expiresAt`、`segments` 和 `answerAs`（服务端把交互所问的对象和发出请求的连接比对后给出：`{ kind: 'anyone' }`、`{ kind: 'self' }`（问的是你自己的聊天身份）、`{ kind: 'simulated', senderId }`（模拟发言人 `~sim:<ID>`）或 `{ kind: 'other' }`（问的是别人：页面只读显示、不可点击，也不下发对方 ID）），不再返回会话引用和内部主体标记；权限不变（`endpoint.view`，只读）。页面点击恢复的交互时按它所问的发言人作答（模拟发言人就用该 ID，自己的聊天身份就用「我的聊天身份」），与发送框当前填的 ID 无关；是否接受仍由 Host 判断。已经结束的交互在历史里照旧显示为不可点（禁用样式）。
- `ImRuntime.listPendingInteractions(conversation, generation)`：只读列出一个会话（精确匹配，会话 ID 含 `:` 也不会串到别的会话）当前所有主体的交互；`PendingUserInteraction` 新增可选 `answeredBy: 'anyone'`。
- 一轮回复还没结束就切到另一个会话，再切回来能看到完整回复。以前一个 Sandbox 连接只收当前会话的消息，切走后这一轮剩下的流式内容和后续消息因「没有在线连接」投递失败（`not_sent`），切回来只看到一部分或看不到。`subscribe` 控制帧新增可选 `retain: true`（页面总是带上）：之后该连接仍接收之前**显式订阅过**的会话（最多 32 个），消息按帧里的 `conversation` 归到对应会话，后台会话收到新回复时会话列表显示未读数（新出现的会话第一条就计 1）。连接建立时默认的 `private` + `owner` 会话和只靠发消息进入的会话不会被保留，所以共用一个 Sandbox 账号的两个页面不会收到对方会话里的回复；后续一次不带 `retain` 的订阅会关闭保留；断线重连后保留表为空（见 README 与协议文档）。页面收到后台会话的帧只计未读、不切换当前会话，列表里没有的会话只加入列表；后台会话的帧不会刷新待处理操作，后台的错误提示和输入回声也不会改动当前视图的提示和发言人角色。不带 `retain` 的旧客户端行为不变。
- 按 `connectionId` 读取的 Console 接口（`/api/interactions/pending`、`/api/conversations/history`、`/api/conversations/results`、`/api/conversations/outcomes`、`/api/conversations/workspaces*`）现在核对该连接是否由发出请求的同一个 Console 用户（会话或 API 令牌）打开，不是则返回 `403`（`sandbox_connection_forbidden`）。不上报连接归属的旧版 Sandbox 适配器不做该比对。
- 对提示卡的作答（如确认卡回复 `y`）和提示卡本身，除了进程内的标记，还会在会话事件表里追加一条只追加的 `message.interaction_answered` 事件（`{ message: MessageRef }`，不改表结构）。实例重启后、或进程内 1000 条上限把旧标记挤掉后，这些消息仍不会作为背景消息进入 Agent 上下文；读取窗口之后才写入的标记按 `message_key` 补查一次。会话历史（Console）、上下文聚合与迁移都忽略这类事件。`ConversationEventReader` 新增可选 `listInteractionAnswered(refs)`。**兼容性**：降级到旧版本时，旧版读到这类行会当作无效行跳过并告警（`skipped stored event … reason: invalid_event`），不会崩溃；只是旧版无法再据此排除这些作答。
