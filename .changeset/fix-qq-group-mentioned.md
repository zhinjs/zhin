---
"@zhin.js/adapter-qq": patch
---

fix(qq): 群消息 @ 判定改为统一按 mentions 检查，不再按 channelKind 直接视为 @

`GROUP_MESSAGE_CREATE` 与 `GROUP_AT_MESSAGE_CREATE` 在 SDK 中都映射为 `message.group`，前者会下发非 @ 的普通群消息；此前 `channelKind === 'group'` 一律置 `mentioned`，导致所有群消息都触发 AI。现统一按 `mentions` 判定：群场景只认 `is_you === true`（精确标识当前机器人；群里 @ 另一个机器人时 `bot: true` 但无 `is_you`，不误判），`bot === true` 回退仅限频道 `AT_MESSAGE_CREATE`（该事件仅 @ 当前机器人时下发，mentions 无 `is_you`）。非 @ 群消息将回到旁听（Passive Group Context）路径。
