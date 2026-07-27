---
"@zhin.js/cli": patch
---

插件包生命周期命令补全：`zhin uninstall` 注册进 CLI 并现代化——卸载时从新格式配置（`plugins.<instanceKey>` 映射，兼容 legacy 数组）和 package.json 的 `zhin.plugins` 挂载清单中同时移除，本地插件目录 `./plugins/<name>` 改为确认后删除（替代旧 src/plugins 路径）。`zhin install` 修复"只写配置不挂载"：启用后同步把 `{package, instanceKey}` 合并进 `zhin.plugins` 清单（此前插件不会真正加载）。至此 `new / build / pub / install / uninstall / search` 全部可用且对齐 Plugin Runtime 约定。
