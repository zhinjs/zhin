# 企业微信 WeCom Platform Permits

## 入站字段（ADR 0056 §1）

企业微信回调不提供群内地位、角色或权限位：本适配器不上报 `sender.platform`，也不声明 `scene.platformStanding` / `scene.selfStanding`，因此 `platform:*` 与 `bot:*` permit 在企业微信会话中都不满足。需要门禁的工具请使用 zhin 角色（`owner` / `admin` / `trusted`）。

`wecom_send_text` 可向任意用户发消息（不在当前会话），要求全局层 zhin `owner`（`owner@global`）。
