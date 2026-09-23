---
title: 消息从哪里来、往哪里去？
---

# 消息从哪里进入，又从哪里发出？

**入站从平台 Endpoint 进入，出站最终也回到 Endpoint。** 找接收问题，就沿 Endpoint、入站中间件、命令分发往下看；找发送问题，就沿 `$reply`、渲染、出站中间件、Endpoint 往下看。

这条路径描述普通 IM 消息。申请、通知和登录状态有各自的事件投影，不要把它们当成一条 `message.receive` 来调试。

## 收到一条消息时

平台 Client 交给 Endpoint，Endpoint 用 `emit('message.receive', payload)` 送入 Core。Runtime 持有该事件所属 generation 的快照，构造 `Message`，经过入站中间件，再由命令分发器处理。只有装了 Agent，命令未命中的消息才可能进入 AI 兜底。

如果中间件没收到消息，先检查 Endpoint 是否真的发出 `message.receive`，再检查它的 `inbound` 能力和当前代；如果命令没响应，再看前缀、命令发现和中间件是否调用 `next()`。

## 发送一条消息时

命令返回值或 `Message.$reply()` 会进入统一出站管道：内容渲染与规范化、出站中间件、`AdapterIndex.send`，最后调用目标 Endpoint 的 `send()`。主动推送也走 `OutboundMessageService.send`，这样才能保留渲染与中间件行为。

Endpoint 必须具备 `outbound` 能力且处于启动状态；检查“代码执行了但平台没收到”时，这两个条件与出站中间件值得先看。

完整链路、事件形状和多媒体约束见[消息流](/concepts/message-flow)。平台特有的收发方式见[适配器索引](/adapters/)。
