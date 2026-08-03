---
"@zhin.js/cli": patch
---

fix(cli): `bridgeRuntimeMessage` 的 `$sender.id` 优先取 `metadata.userId`，修复 QQ/KOOK/Discord 私聊会话以昵称为 key 的问题

QQ/KOOK/Discord 适配器入站 `sender` 传显示名、稳定平台 ID 经 `metadata.userId` 传递；此前 `$sender.id` 直接用显示名，导致私聊 sceneId 与记忆作用域随昵称变化而丢失历史。未提供 `metadata.userId` 的适配器（OneBot/ICQQ/Milky 等 sender 本身即平台 ID）行为不变。注意：升级后 QQ/KOOK/Discord 私聊会按稳定 ID 新建会话，旧昵称会话不再命中。
