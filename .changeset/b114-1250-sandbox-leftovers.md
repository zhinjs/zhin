---
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/adapter-sandbox": patch
---

**Sandbox：刷新后恢复等待中的交互、切换会话不再丢回复**（#1250 b114）。

- 刷新 Sandbox 页面后，仍在等待回答的确认卡 / 按钮交互重新出现在「待处理操作」里并可完成。以前 `GET /api/interactions/pending` 只按连接的 `owner` 读取，而 Sandbox 页面发言用的是模拟发言人（`~sim:<ID>`）或你的聊天身份，从来不是 `owner`，所以页面自己触发的交互刷新后一个也读不到，历史消息里的按钮又是只读的，交互只能等到超时。现在该接口列出当前会话里所有仍有效的交互（含 `answeredBy: 'anyone'`），每条只返回 `id`、`generation`、`expiresAt`、`segments` 和 `answerAs`（`{ kind: 'anyone' }` 或 `{ kind: 'sender', senderId }`），不再返回会话引用和内部主体标记；权限不变（`endpoint.view`，只读）。页面点击恢复的交互时按它所问的发言人作答（模拟发言人就用该 ID，聊天身份就用「我的聊天身份」），与发送框当前填的 ID 无关；是否接受仍由 Host 判断。已经结束的交互在历史里照旧显示为不可点（禁用样式）。
- `ImRuntime.listPendingInteractions(conversation, generation)`：只读列出一个会话（精确匹配，会话 ID 含 `:` 也不会串到别的会话）当前所有主体的交互；`PendingUserInteraction` 新增可选 `answeredBy: 'anyone'`。
- 一轮回复还没结束就切到另一个会话，再切回来能看到完整回复。以前一个 Sandbox 连接只收当前会话的消息，切走后这一轮剩下的流式内容和后续消息因「没有在线连接」投递失败（`not_sent`），切回来只看到一部分或看不到。`subscribe` 控制帧新增可选 `retain: true`（页面总是带上）：之后该连接仍接收之前看过的会话（最多 32 个），消息按帧里的 `conversation` 归到对应会话，后台会话收到新回复时会话列表显示未读数。不带 `retain` 的旧客户端行为不变。
