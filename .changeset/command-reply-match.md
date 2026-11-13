---
"@zhin.js/command": patch
---

`defineCommand` 新增两项便捷写法：`reply` 用固定内容代替 `execute`；`match` 正则让整句消息触发命令（命令名路由优先，结果在 `context.match`，不允许 `g` / `y` 标志）。命令列表的描述中带上 `match` 的字面形式。
