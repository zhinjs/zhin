---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
---

fix(agent): read_file / list_dir / glob / grep / edit_file / write_file 默认常驻加载（仍受本轮工具过滤与 exec 策略约束），常驻工具不再写入会话快照，不占 `maxLoadedPerSession` 名额也不会被挤出。模型直接调用本轮目录中的延迟工具时自动加载并执行，审批与权限检查照常生效；不在目录中的名字仍按未知工具拒绝，并提示使用 discover / load_tool。
