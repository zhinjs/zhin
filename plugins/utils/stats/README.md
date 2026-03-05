# @zhin.js/plugin-stats

消息统计插件 —— 按用户/群维度统计消息量，支持日/周/月报表和活跃排行。

## 安装

```bash
npm install @zhin.js/plugin-stats
```

## 配置

在 `zhin.config.yml` 中添加：

```yaml
plugins:
  - "@zhin.js/plugin-stats"
stats:
  rankSize: 10         # 排行榜显示人数（默认 10）
  retentionDays: 90    # 数据保留天数（默认 90）
```

## 命令

| 命令 | 说明 |
|------|------|
| `stats` | 查看今日消息统计 |
| `stats-week` | 查看本周消息统计 |
| `stats-rank` | 查看本月话唠排行 |
| `mystats` | 查看个人消息统计 |

## 工作原理

1. 中间件自动计数，不干扰消息处理流程
2. 使用写入缓冲（10s 批量刷盘），减少数据库 IO
3. 按 `(用户ID, 群ID, 日期)` 维度存储每日计数
4. 自动清理超过保留天数的旧数据

## AI 工具

| 工具名 | 说明 |
|--------|------|
| `stats_query` | 查询消息统计数据（支持 today/week/month） |
| `stats_user` | 查询指定用户的消息统计 |

## 数据库

依赖 Zhin 数据库服务，自动创建 `message_stats` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | text | 用户 ID |
| user_name | text | 用户名 |
| group_id | text | 群 ID（私聊为空） |
| date | text | 日期 (YYYY-MM-DD) |
| count | integer | 当日消息数 |

## 许可

MIT
