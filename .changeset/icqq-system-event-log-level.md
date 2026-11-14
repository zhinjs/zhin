---
"@zhin.js/adapter-icqq": patch
---

ICQQ `system.*` 事件按语义分级记录（#1250）：上线（`system.online`）与等待人工处理的登录验证（二维码、设备锁、滑块、身份验证）记为 INFO，只有登录失败（`system.login.error`）与掉线（`system.offline*`）记为 WARN，正常登录不再进入「历史警告」。
