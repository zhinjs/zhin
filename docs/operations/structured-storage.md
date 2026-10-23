---
title: 结构化存储与用量查询
---

# 结构化存储与用量查询

启用 Agent 并使用 SQLite、MySQL 或 PostgreSQL 时，运行时会自动保存每轮对话及模型调用的用量。记录独立于日志级别，也不依赖 Workroom 或 trace 归档。Console 的数据库页可以查看这些表；图表、统计指令和专用查询 API 尚未提供。

```yaml
ai:
  usage:
    retentionDays: 30
```

`retentionDays` 是正整数，默认 30 天。启动时及运行期间每小时清理一次，按根回合结束时间同时清理该回合和所属调用。改变配置后由新 generation 接管清理；它不改变消息、会话、任务或普通日志的保留规则。

## 用量表

| 表 | 一行代表什么 | 可查询的字段 |
| --- | --- | --- |
| `agent_usage_turns` | 一次根回合 | owner、trace/turn/session 标识、请求人、入口、完整会话地址、选定模型、结果、起止时间、耗时、调用次数 |
| `agent_usage_calls` | 一次已报告用量的模型响应 | 根回合、实际子回合、调用序号、实际 provider/model、结束原因、耗时、输入/输出/总 token、缓存读写、推理 token |

两表通过 `agent_usage_calls.root_id = agent_usage_turns.id` 关联。同步子 Agent 的调用计入同一个根回合，并保留自己的 `turn_id`；不要把父回合调用次数与明细行数再相加。`selected_model` 是入口选择，明细中的 `model` 是实际调用模型。

用量字段为数值列。`NULL` 表示供应商没有报告或无法证明；明确报告的零值才保存为 `0`。查询总量时同时返回已知样本数，避免把缺报当成零消耗：

```sql
SELECT provider, model,
       COUNT(*) AS calls,
       COUNT(input_tokens) AS calls_with_input,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens
FROM agent_usage_calls
GROUP BY provider, model;
```

缓存读写是输入的分项，推理 token 是输出的分项，不能重复相加。这些表保存模型报告的用量，不是供应商账单。没有进入回合事件链的独立决策、嵌入或图像生成调用，以及未返回用量的网络失败，不会被猜测成账单数据。记录在回合结束时原子写入；进程崩溃前尚未结束的回合可能没有最终记录。写入失败会产生 `op=usage_persist status=failed` 日志，不会改变已经执行的回复，也不会重新调用模型。

用量表不保存聊天正文、提示词、思考正文、工具参数、工具返回值或异常正文。身份字段仍属于业务数据，访问权限沿用数据库和 Console 的管理权限。

## 消息与会话

| 表 | 新增查询维度 | 仍保留的回放数据 |
| --- | --- | --- |
| `conversation_events` | 事件类型、完整 endpoint、会话、父容器、线程、actor、平台消息 ID | `event_json`、原事件序号和游标 |
| `agent_messages` | actor、turn/intent、provider/model、停止原因、工具调用 ID、是否错误 | `payload`、扩展信息、消息树父子关系 |
| `agent_sessions` | 会话建立时的入口、endpoint、会话、父容器、线程 | 原 session key、活动叶子、归档状态 |
| `unified_inbox_message` | 入站/出站方向、canonical endpoint、线程 | 原 content/raw 与 Console 展示字段 |

会话的来源列记录创建来源，不改变会话路由、权限或归属。旧会话无法证明来源时为 `NULL`；不会从字符串 session key 猜测身份。消息正文、结构化 Segment、任意扩展仍用原格式保存，以保证回放无损；常用查询不需要再解析整段 JSON。

身份列采用可逆 `k1:` 编码：`%` 编为 `%25`，NUL 编为 `%00`，其他字符不变。原因是 canonical endpoint ID 可能含 NUL，而 PostgreSQL 文本不接受 NUL。插件可从 `zhin.js/plugin-runtime` 导入 `encodeStorageIdentity` / `decodeStorageIdentity` 构造过滤条件或解码。`NULL` 与空字符串仍可区分。任务自由文本也使用该编码保证跨库回放；provider/model 和状态等列保持普通文本。

## 任务表与原子更新

Agent 的 `agent_schedule_jobs` 按列保存计划、创建者、目标、状态与执行结果；不定长的工具/技能列表、事件载荷和特定调度选项保留在明确命名的 `*_json` 扩展列。

提醒和管理员 RSS 使用插件实例私有表，Console 显示的是带 owner 限定的物理表名：

| 逻辑表 | 内容 |
| --- | --- |
| `reminder_tasks`、`admin_reminder_tasks` | 聊天/管理员任务及精确目标、状态、认领标识 |
| `admin_reminder_receipts` | 管理操作的幂等回执 |
| `admin_rss_tasks` | RSS 任务、游标状态、静默设置、待发摘要计数 |
| `admin_rss_seen`、`admin_rss_pending_items` | 已见文章、待发摘要条目 |
| `admin_rss_receipts` | RSS 管理操作回执 |
| 各 `*_book` 表 | 版本、CAS 修订号和迁移标记，不含整本任务 JSON |

每次更新把任务、认领、明细、回执与版本放在同一个数据库事务内提交；冲突只重试纯数据库计算。发送前的 `unknown` 认领不会因重启或迁移变回待发送。聊天任务仍归真实发送者，管理员任务仍独立选择目标；RSS 首次/恢复只建基线，暂停清空摘要的规则不变。

## 升级与数据库范围

升级前停止旧进程并备份数据库及 `data/schedule-jobs.json`，然后用新版本启动。不要让新旧版本同时写同一任务存储。新增任务表须在启动时注册，安装此次升级后需要完整重启。

- 已有消息表只增加缺失字段，并分批从原记录回填；不删除旧列、消息树或摘要锚点。无法解析的 canonical 消息会使迁移失败，原记录保留，修复后可重新启动。
- 提醒/RSS 第一次访问时，在事务中迁移旧 CAS 键。提交成功后清理旧键；持久迁移标记阻止已删除任务被旧副本重新导入。
- Agent 首次启用 SQL 任务存储时导入 `schedule-jobs.json`，保留原文件，之后以数据库为准，不再读取旧文件来恢复已删除任务。损坏或不支持版本的文件会阻止迁移。
- MongoDB、Redis、memory 保留原有会话能力；此轮不提供结构化用量与事务任务表，会明确记录不支持提示，不会自动更换数据库。已有文件模式的 Agent 任务继续使用原方式。

跨库回归使用隔离测试数据库，覆盖 SQLite，以及 MySQL/PostgreSQL 的单连接和连接池。仓库 CI 的 `database-live` 作业也会运行这些检查；它不代表真实 IM 平台投递验收。
