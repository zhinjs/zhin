---
name: qq-messages
platforms:
  - qq
description: QQ 官方机器人当前会话的引用回复，以及撤回机器人自己的发言。
keywords:
  - 引用
  - 回复原消息
  - 撤回
  - 自己的消息
tools:
  - quote_reply
  - recall_own_message
scopes:
  - private
  - group
  - channel
---
# qq-messages

Only use real message IDs from the current conversation. Do not invent IDs or source authors. Both tools stay inside the current conversation; cross-conversation forwarding does not exist on the official API.

`quote_reply` sends a text reply that references one original (passive reply `msg_id` / guild `message_reference`) through the unified outbound pipeline. Use `inspect_conversation_reference` to read an incoming quote when available; it does not send messages.

`recall_own_message` accepts only the bot's own send receipt ID and needs no management role or approval. QQ only recalls messages younger than 2 minutes; never promise success before confirmation or retry an unconfirmed result. To recall another member's message, load `qq-group-admin`.

Merged forward (`forward_messages`) is not available: the official API cannot send merged-forward records.
