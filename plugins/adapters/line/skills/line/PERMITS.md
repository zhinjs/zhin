# LINE 适配器权限说明

LINE Messaging API 适配器本身不涉及平台级权限检查（LINE 没有类似 Telegram 的 ChatMember 权限模型）。

## 平台权限

LINE 的权限模型通过 LINE Official Account Manager 管理，不在 bot 层面控制。
所有发消息权限由 Channel Access Token 的 scope 决定。

## 已知 scope

| scope | 说明 |
|-------|------|
| `message` | 发送消息（Reply + Push） |
| `profile` | 获取用户资料 |

如需额外权限，请在 LINE Developers Console 的 Messaging API 设置中启用。
