---
"@zhin.js/gateway": patch
---

Console 终端：在 Shell 就绪前收到的输入（票据校验、PTY / SSH 启动期间）不再丢弃，就绪后按顺序回放，排队上限 1 MiB；对端在启动前离开时丢弃排队内容。
