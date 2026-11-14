---
"@zhin.js/runtime": minor
"@zhin.js/plugin-runtime": minor
"@zhin.js/agent": patch
"zhin.js": patch
---

热重载重建范围按受影响的子树分别计算（#1250 `hmr-multi-change-full-rebuild`、`hmr-stale-cross-package-import`）：同一批里改了几个插件（入口、子树内的辅助模块、能力文件混在一起）时，只重建这些插件子树并替换子树外受影响的能力，其他插件 Scope、适配器投影与 Endpoint 原样保留（不重连、不重登）；适配器只在自身源码或配置变化时重建。Root 安装器可以用新的 `watchProjectFiles({ patterns, onChange })`（`RootResourceContext`）声明自己读取的项目文件，只改了这些文件（例如 `SOUL.md` / `AGENTS.md` / `TOOLS.md`、`ai.knowledge` 目录）时不再重建 Root，改为通知声明方重读（Agent Host 已声明，turn 读取最新 bootstrap；`hmr_reload | rebuilt: resource`），未声明的根目录文件仍整棵重建并记 `hmr_full_rebuild` 原因。根插件 tool 等通过包名引用挂载的本地插件模块时，被引用文件变化会让引用方一起重新加载（新代码，所有重载的引用方共享同一个新实例）；未变化的插件包保持原有的共享实例，引用方重载不会重复执行其顶层副作用；依赖索引只沿包名导入进入被监视的目录，不再遍历 workspace 链接的框架源码（启动不再变慢）；引用了普通 workspace 库等无法刷新的依赖方，在 `hmr_reload` 的 `unrefreshed_dependents` 和 warn `hmr_unrefreshed_dependents` 中列出。子树重载因拓扑变化退回整棵重建时也记 `hmr_full_rebuild` 原因；没有归属记录的文件（例如 Feature 包内的文件）仍整棵重建并说明原因；批次中其余部分重载失败时，已声明的项目文件仍会通知声明方。
