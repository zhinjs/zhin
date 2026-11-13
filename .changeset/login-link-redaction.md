---
"@zhin.js/core": patch
"@zhin.js/console-protocol": patch
"@zhin.js/adapter-icqq": patch
---

登录流程事件与历史不再带验证链接：`withoutLoginMedia` 去掉滑块 / 设备锁 / 授权 / 链接验证挑战的 `media.link`、`media.captcha` 与链接块（它们带 sid），标记 `media.linkOmitted: true`，需要时用 `login.flow.get` 读取；二维码挑战不变。icqq 登录辅助日志只记录挑战类型与链接主机名。
