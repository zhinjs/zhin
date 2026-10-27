---
name: icqq-messages
platforms:
  - icqq
description: ICQQ 当前会话的引用回复、真实消息合并转发，以及撤回机器人自己的发言。
keywords:
  - 引用
  - 回复原消息
  - 转发
  - 撤回
  - 自己的消息
tools:
  - quote_reply
  - forward_messages
  - recall_own_message
scopes:
  - private
  - group
---
# icqq-messages

Only use real message IDs from the current conversation. Do not invent IDs, source authors or forwarded content. The tools resolve the originals and send through the unified outbound pipeline. Cross-conversation forwarding is not supported.

`quote_reply` sends a text reply quoting one original; `forward_messages` sends a merged forward of the supplied originals. Use `inspect_conversation_reference` to read an incoming quote/forward when available; it does not send messages.

`recall_own_message` needs no management role or per-call approval, including when the bot is an ordinary group member. It verifies the bot authored the message. The platform decides the recall time window; never promise success before receiving confirmation or retry an unconfirmed result automatically. To recall another member's message, load `icqq-group-admin` instead.

These tools currently support QQ private/group conversations, not guild channels. A failed or suppressed outbound receipt is not a delivered message.
