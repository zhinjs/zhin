---
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"zhin.js": patch
---

热重载与文件监视（#1250）：`zhin status` 显示实例当前的 generation（网关按实例每次提交后发布的路由表更新，不再停留在启动时的 1）；文件变化事件合并 300 毫秒（`HmrCoordinator` 新选项 `watchDebounceMs`），`sed -i`、编辑器原子保存、`git checkout` 等一次改动只触发一次重载，显式 `enqueue` 不受影响；被监视的 `package.json` 只有 `scripts`、`description` 等不影响运行时的字段变化时直接忽略（debug 日志 `manifest_change_ignored`），依赖、`pnpm.overrides`、`zhin`、`exports` / `main` / `type` 等字段变化仍按原路径处理，需要重启时先记 `instance_restart | reason: manifest_changed | file | fields`（其他重启原因同样有结构化记录）；`hmr_reload` 新增 `rebuilt`（实际重建范围 root / subtree / capability）与 `rebuilt_plugins`（重新 setup 的插件，含适配器），实际退化为整棵 Root 重建时另记 warn `hmr_full_rebuild` 说明原因。重载范围算法本身不变。
