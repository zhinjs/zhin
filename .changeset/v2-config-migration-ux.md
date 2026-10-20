---
"@zhin.js/cli": patch
"zhin.js": patch
---

**从 1.1.13 及更早版本升级（configVersion 2）**：先停止 Bot，再升级依赖，然后运行 `zhin migrate instances` 预览、`zhin migrate instances --apply` 迁移配置，最后 `zhin config check` 后重新启动。指南：https://zhin.js.org/operations/upgrades#configversion-2

降低 v1 配置升级成本：启动、`zhin config check` 和 `zhin doctor` 检测到 v1 配置（缺少 `configVersion: 2` 或仍有 `package.json#zhin.plugins`）时，直接说明是 v1 配置，并给出停机与迁移命令和文档链接，不再报通用解析错误。`zhin migrate instances` 默认输出按键名列出的可读预览（不含任何配置值，`--json` 保留机器输出）；`--apply` 写入前把原文件复制到 `.zhin/backups/config-v2-<时间戳>/` 并打印路径与恢复方式。`zhin migrate` 默认保留精确版本、`link:`、`file:` 等锁定依赖（`--include-pinned` 才改为 latest），dry-run 结束时明确提示未做任何改动，帮助文本指向配置迁移并区分 `zhin runtime migrate`。
