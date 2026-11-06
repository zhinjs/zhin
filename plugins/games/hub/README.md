# @zhin.js/plugin-game-hub

Plugin Runtime 游戏大厅：聚合展示当前 generation 已注册的小游戏插件（`GameIndex` 投影）、个人战绩与排行榜。

## 能力

- **聊天命令**：
  - `games [action]`：列出已加载的小游戏插件及快捷开局提示。
  - `战绩`：查询当前用户在各小游戏中的胜负与积分统计。
  - `排行 [游戏名]`：查看指定小游戏的积分排行榜。
- **AI Skill 与 Tool**：
  - `skills/game-hub/SKILL.md`：按需激活的游戏大厅技能。
  - `skills/game-hub/tools/game_catalog/index.ts`（`game_catalog`，`readOnly: true`）：查询已注册小游戏目录（ID、名称、别名、人数范围、简介与开局指令），支持按名称或别名过滤。
- **Console 页面**：
  - `pages/index/index.ts`（权限 `game-hub:read`）：通过 `pluginConsoleRpcToken`（`createGameHubConsoleRpc`）展示已注册游戏数量与游戏目录表。
