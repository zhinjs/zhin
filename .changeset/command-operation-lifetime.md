---
"@zhin.js/feature-kit": patch
"@zhin.js/command": patch
"@zhin.js/core": patch
---

通过中立的 operation input 生命周期 hook 将真实入站运行代的退休信号传给 CommandContext.signal，使补问与确认能及时取消。
保留旧 lease 普通操作和已开始发送的正常排空语义，不全局拦截回复。
