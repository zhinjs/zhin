# 使用实例作用域的 Console EntryStore

Console entry 通过 `EntryStore` 归属于某个 `PageManager` 实例，而不是归属于进程级静态状态。静态 `PageManager.addEntry` shim 已按 breaking 清理删除；插件代码必须通过 `web` 上下文拿到实例后注册，这样多个 console runtime 可以保持隔离。

