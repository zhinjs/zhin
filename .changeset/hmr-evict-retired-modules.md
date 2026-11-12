---
"@zhin.js/runtime": patch
---

开发态热更在每次提交新一代后，把已退役的 `?zhin-generation=N` 模块从 Node ESM 加载缓存中移除，使旧模块实例及其导出状态可被 GC，长时间开发时内存不再随热更次数线性增长。依赖 Node 内部 `loadCache`（经进程内 inspector 读取），不可用时自动退回原行为；`ZHIN_HMR_EVICT=0` 可关闭。`NativeDevelopmentModuleRuntime` 新增 `evictRetiredModules` 选项与 `evictionStats`。
