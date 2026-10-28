---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

ADR 0040 切片 C2：试跑沙箱加载（§3.3）——静态检查通过后把草稿所在插件根拷到系统临时目录、在一次性子进程的试跑运行时（只装 IM 运行时，无端点、无模型、无令牌，60 秒超时杀进程组）里装配，校验 `sandbox_load` 与 `capability_discovered`；拷贝用完即删，崩溃残留 1 小时后清理。同时补上 `stripComments` 的线性扫描（CodeQL js/polynomial-redos，#1064 合入时漏掉），指令目录里的非 `index.*` 辅助模块不再要求默认导出 `defineCommand`。
