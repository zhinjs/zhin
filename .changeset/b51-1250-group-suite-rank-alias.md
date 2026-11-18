---
"@zhin.js/plugin-group-suite": patch
---

group-suite：`rank` 去掉中文别名「排行」（`group-suite-rank-alias-collides-game-hub`）。「排行」与游戏大厅（`@zhin.js/plugin-game-hub`）的 `排行` 命令重名，两个插件同时启用时其中一方被跳过、只记一条 `command_route_conflict` 日志；现在单独的「排行」留给游戏大厅，积分排行用「积分排行」或 `rank`。新增契约测试 `tests/contracts/official-plugin-command-routes.test.ts`：所有官方插件一起加载进同一个 Command 索引时不得出现路由冲突。
