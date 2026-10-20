# @zhin.js/plugin-roulette

俄罗斯轮盘：群里多人轮流扣动扳机，弹巢里只有一发子弹，中弹的人输。接入游戏大厅，战绩和排行由 `@zhin.js/plugin-game-hub` 统一展示。每个群可以单独开启「输家禁言」惩罚，默认关闭。

## 安装

```yaml
plugins:
  game-hub: "@zhin.js/plugin-game-hub"
  roulette: "@zhin.js/plugin-roulette"
database:
  dialect: sqlite
  storage: ./data/zhin.db
```

没有数据库时对局保存在内存里，重启后丢失。

## 命令

| 命令 | 说明 |
|------|------|
| `轮盘` / `轮盘 帮助` | 玩法说明 |
| `轮盘 开局` | 创建一局，自己先上桌 |
| `轮盘 加入` | 加入等待中的对局 |
| `轮盘 开始` | 房主开局，至少 2 人 |
| `开枪`（或 `轮盘 开枪`） | 轮到你时扣动扳机；没轮到你时「开枪」只是普通聊天 |
| `轮盘 退出` | 等待时离开；对局中离开算认输 |
| `轮盘 取消` | 房主或机器人管理员取消本局，不计分 |
| `轮盘 状态` | 查看当前对局 |
| `轮盘 禁言` | 查看本群禁言惩罚和平台是否支持禁言 |
| `轮盘 开启禁言` / `轮盘 关闭禁言` | 机器人主人（`master`）或受信任用户（`trusted`）切换本群禁言惩罚 |

`/轮盘赌`、`roulette` 是同一组命令的别名；也可以从 `/游戏` 大厅进入。

## 规则

- 一个群同一时间只有一局。玩家按加入顺序轮流开枪，弹巢数量和人数上限见配置。
- 开局时随机把子弹装进其中一个弹巢，之后按顺序逐个击发，所以最多一轮弹巢就会分出胜负。
- 轮到的人超过 `turnTimeoutSeconds` 不开枪，判负；每开一枪重新计时。
- 开局后超过 `lobbyTimeoutSeconds` 还没开始，自动解散，不计分。
- 对局中离开等同认输。
- 结束后幸存者各记 1 胜（得 1 分），输家记 1 负。对局和群设置都存在数据库表里（`roulette_sessions`、`roulette_group_settings`），不使用插件 state store。取消或解散的对局不记录。用 `战绩`、`排行 轮盘` 查看。

## 禁言惩罚

- 按群开关，默认关闭。只有机器人主人或受信任用户可以切换，判断的是框架角色，不读取平台的群管理员身份。
- 插件不判断平台名称。每次需要时，用消息自带的 `conversation.endpoint`（适配器插件和 Endpoint 能力 id）走 `project(adapterFeatureId).connection(adapter, endpointId)`，再看 `resolveEndpointManagement(endpoint)?.muteGroupMember` 是否存在。存在就能禁言，不存在（或运行时没有 Adapter Feature）就只计分。
- 超时判负由 `schedules/deadlines` 每 5 秒检查一次，它拿到的也是同样的能力上下文，所以超时的输家同样会按上面的规则处理。
- 平台不支持禁言时无法开启；开启后平台失去这项能力，或禁言被拒绝（例如机器人不是群管理员），这一局照常结算，只是不禁言。
- 只在群聊里生效，输家禁言 `muteSeconds` 秒。

## 配置

```yaml
roulette:
  chambers: 6              # 弹巢数，2-12
  maxPlayers: 6            # 每局人数上限，2-10
  turnTimeoutSeconds: 60   # 轮到的人多久不开枪判负，10-600
  lobbyTimeoutSeconds: 300 # 开局后多久不开始自动解散，30-3600
  muteSeconds: 60          # 开启禁言惩罚的群里输家禁言秒数，10-3600
```

## 开发

```bash
pnpm --filter @zhin.js/plugin-roulette build
pnpm vitest run plugins/games/roulette/tests
```
