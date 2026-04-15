# @zhin.js/plugin-checkin

签到积分插件 —— 每日签到、积分累积、连续签到奖励、排行榜。

## 安装

```bash
npm install @zhin.js/plugin-checkin
```

## 配置

在 `zhin.config.yml` 中添加：

```yaml
plugins:
  - "@zhin.js/plugin-checkin"
checkin:
  basePoints: [10, 30]  # 基础积分范围（随机）
  streakBonus: 5         # 连续签到每天额外积分
  streakCap: 50          # 连续奖励上限
  rankSize: 10           # 排行榜显示人数
```

## 命令

| 命令 | 说明 |
|------|------|
| `checkin` | 每日签到，获得随机积分 |
| `mypoints` | 查看个人积分、签到天数、连续天数 |
| `rank` | 查看积分排行榜 |

## 积分规则

- 每日签到获得 **10~30** 基础积分（可配置）
- 连续签到每多一天，额外 +5 积分（上限 50）
- 中断签到后连续天数重置

## AI 工具

| 工具名 | 说明 |
|--------|------|
| `checkin_query` | 查询用户积分信息或系统摘要 |
| `checkin_rank` | 获取排行榜数据 |

## 数据库

依赖 Zhin 数据库服务，自动创建 `checkin_records` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | text | 用户 ID |
| user_name | text | 用户名 |
| points | integer | 当前积分 |
| total_checkins | integer | 累计签到天数 |
| streak | integer | 当前连续天数 |
| max_streak | integer | 历史最长连续 |
| last_checkin | text | 上次签到日期 |
| context_type | text | 上下文类型 (global/group) |
| context_id | text | 群 ID |

## 许可

MIT
