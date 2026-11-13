---
"@zhin.js/adapter-icqq": patch
"@zhin.js/core": patch
---

ICQQ 改用登录辅助 v2 的登录流程（ADR 0058 P2）：每次登录一条流程（连接 → 挑战 → 验证中 → 在线 / 失败），声明 `login: { mode: 'interactive', relogin: true, refreshQr: true }` 并实现「重新登录」「刷新二维码」钩子。扫码时自动跟踪扫码状态（已扫码提示、确认后自动继续、过期自动换码两次）；滑块带托管验证码辅助页（`media.captcha`）和手动提取 ticket 的分步说明，NT 登录提交 `ticket,randstr`、旧版只提交 ticket；设备锁提供「我已在手机完成验证」和「改用短信验证码」（6 位验证码、60 秒后可重新发送，发送失败报 `rate_limited` / `unknown` 并留在设备锁）；身份验证提供设备 JSON（敏感，只在活动挑战上）、验证链接二维码和只在 `accounts.qq.com/login/attack` 运行的静态辅助脚本。`system.login.error` 按一张表映射到错误码，验证码错误留在原挑战；需要人处理的失败不再自动重新登录，只有被踢下线、网络错误等不需要验证的失败保留退避重试并记入时间线。QQ 命令 `icqq login confirm / code / status / qr` 按挑战作答（设备锁 `code sms`、短信 `code resend`），`code` 支持带 QQ 号。core：流程挑战的兼容待办 `payload.message` 带上简短说明，`payload.url` 在没有 `media.link` 时取第一个链接块。
