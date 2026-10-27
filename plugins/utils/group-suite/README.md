# @zhin.js/plugin-group-suite

Plugin Runtime 群运营套件，提供签到积分、消息统计、群问答、持久词库与群成员欢迎。
能力按统一的 commands、middlewares、handlers、schedules 和 skills 目录发现。

## 安装与配置

```bash
pnpm exec zhin install @zhin.js/plugin-group-suite
```

安装会将实例声明写入主配置 `plugins` 映射。手工声明：

```yaml
configVersion: 2
plugins:
  group-suite: '@zhin.js/plugin-group-suite'
```

应用 Host 必须共享同一物理实例的 `@zhin.js/command`、`@zhin.js/middleware`、
`@zhin.js/handler`、`@zhin.js/schedule-feature`、`@zhin.js/tool` 与 `@zhin.js/skill`
Feature provider，并装配 Schedule Host。正常 CLI 负责 Host 装配；手写测试 Host 也需要显式安装这些资源。

```yaml
configVersion: 2
plugins:
  group-suite: "@zhin.js/plugin-group-suite"
group-suite:
  keywordReply: true
  ephemeralKeywords: false
  welcomeMessage: "" # 默认关闭；可设为 欢迎 {name} ({id})
  basePointsMin: 10
  basePointsMax: 30
  streakBonus: 5
  streakCap: 50
  rankSize: 10
  teachMaxPerGroup: 200
  teachCooldownMs: 3000
  teachAllowRegex: true
  teachPageSize: 10
```

约束以 [schema.json](./schema.json) 为准。启用关键词回复时默认要求 Database Host 的原子
状态服务；没有该服务会启动失败并提示原因。演示环境可显式设置 `ephemeralKeywords: true`，
此时词库只活在当前插件实例，插件重载或进程重启后会丢失。
即使 `keywordReply: false`，词库管理仍要求持久状态服务（除非显式启用临时词库）；默认无数据库
时这些命令会回复配置要求，不会返回伪造的空词库或宣称写入成功。

持久词库通过公开 `databaseHostToken.state.forConversation()` 存储，每次管理命令在原子
更新完成后才返回成功。一个群最多 200 条，关键词 1–200 字符，回复 1–2000 字符。
整个词库的 JSON 编码必须小于 64 KiB（UTF-8 字节，包含键、回复与 JSON 标点）；条数上限与
字节上限同时约束，长回复可能先达到字节上限。更新超限会拒绝并保留旧词库，临时词库使用同样限制。
在同一数据库和相同实例身份下，指令热更新、插件重载和进程重启保留词库。

签到、教学和统计优先写入 Database Host；没有数据库时使用实例私有内存模型，不能视为持久存储。
统计只在入站累加内存缓冲，每 10 秒由正式 Schedule Host 批量写入；主动查询也会刷新缓冲。
它是 best-effort 计数，并非持久 outbox：停止、插件重载或崩溃时尚未落库的批次可能丢失。
退休 generation 的清理不额外写数据库，也不绕过代级准入。

## 使用与权限

未配置命名空间时直接使用表内指令名；如果实例设 `commandNamespace: suite`，使用
`suite checkin` 等形式。实际前缀由 Endpoint 决定。
别名同样位于命名空间之下（如 `suite 签到`、`suite checkin rank`）。

| 指令/能力 | 说明 |
|---|---|
| `checkin` / `mypoints` / `rank` | 签到、积分与排行 |
| `checkin do` / `签到` · `checkin streak` · `checkin rank` | 兼容别名：分别等同 `checkin`、`mypoints`、`rank`，方便从 `checkin <子命令>` 风格的本地签到插件迁移 |
| `stats` / `stats-week` / `stats-rank` / `mystats` | 消息统计 |
| `stats-card` | 当日统计 HTML 图卡；没有渲染服务时走统一文本降级 |
| `teach` / `teach-regex` / `teach-list` / `forget` | 群问答与管理 |
| `keyword-add <keyword> <reply...>` / `keyword-list` / `keyword-remove <keyword>` | 当前群词库 |
| `welcomeMessage` | 当前群增加成员时欢迎，默认关闭，只在设置非空文本后发送 |
| `skills/<name>/tools/<tool>/index.ts` | Skill 激活后披露签到查询、排行、统计和群公告 Tool |

关键词与问答修改命令要求群主、管理员、master 或 trusted；普通成员不能修改。查询命令仍按其
各自公开 permit 执行。Tool 保持既有审批策略，命令角色判断不能替代 Tool 审批或平台权限。
欢迎通过 `outboundMessageToken` 走统一发送链路，投递失败/未知会报错，不盲目重试。
`stats-card` 是 HTML 图片/文本展示，不是平台原生 `card` 载荷。

### 限定群欢迎范围

`welcomeConversations` 是当前插件实例的精确会话白名单，最多 100 项。省略此字段保留原行为：
设置非空 `welcomeMessage` 后，所有符合条件的群成员加入事件都可触发欢迎。显式配置 `[]`
则不欢迎任何会话；`welcomeMessage` 为空时仍始终关闭欢迎。

```yaml
group-suite:
  welcomeMessage: "欢迎 {name} ({id})"
  welcomeConversations:
    - endpoint:
        adapter: "<复制实际 conversation.endpoint.adapter>"
        id: "root/qq\u0000zhin.adapter\u0000icqq~main"
      kind: group
      id: "123456"
```

示例 Endpoint ID 仅说明格式，实际请复制当前 canonical `conversation.endpoint`，不要按昵称、
账号、Endpoint 简称或实例名拼接。完整 Endpoint ID 中的 NUL 在双引号 YAML 中写为 `\u0000`。
`endpoint.adapter` 也须与事件完全一致。

每项同时匹配完整 Endpoint 身份、`kind`、会话 `id`、`parent.kind/id` 和 `threadId`，没有通配符。
省略 `parent` 或 `threadId` 只匹配同样没有该字段的群根会话；需要父容器或线程时须完整填写。
`null`、空 ID、残缺父容器和额外字段会被拒绝。重复条目不会重复发送欢迎。
白名单只筛选入站群成员加入事件，不改写原会话投递目标，也不限制签到、词库、统计等能力。

同一群若同时开启 Agent 会话欢迎（ADR 0037 切片 A 的 `welcome.enabled`），两边会各发一条；
在统一前每个群只开一种，见[群欢迎指南](https://github.com/zhinjs/zhin/blob/main/docs/solutions/group-welcome.md)「与 Agent 会话欢迎的关系」。
成员退群时本插件不发送消息。

这不补充平台本身缺少的入站事件或目标：未提供 canonical 群会话的成员加入事件不会发送欢迎，
也不会推测频道。配置可热更新，校验失败保留旧配置与 generation；没有单独的范围数据库。

所有新数据按插件实例与完整会话隔离：平台、Endpoint 身份、群/频道/私聊类型与 ID，以及父会话、
线程信息共同参与键。相同群号的两个 Bot 不共享词库、签到、教学或统计。群专用 Tool 只接受 IM
群上下文，并通过当前 AdapterIndex 精确解析 Endpoint，无法确定唯一来源时拒绝执行。当前群的查询保留当前线程，只查该完整会话，不聚合其他线程。
显式查询另一群时使用该群根会话，不将当前群的线程 ID 带到另一群。

旧记录只有裸群号或全局范围，无法安全判断属于哪个 Bot。新实现不会自动读入或建立兼容别名；
需要保留旧记录时，维护者必须根据实际 Bot/会话身份进行明确的人工迁移。

## 验证

```bash
pnpm --filter @zhin.js/plugin-group-suite build
pnpm --filter @zhin.js/plugin-group-suite test
```

集成验收使用公开 `@zhin.js/testing`、真实 Native Runtime/CommandIndex/PermissionHost、
合成端点、真实 PluginScheduleHost 和 SQLite 状态 CAS，覆盖两个实例、端点隔离、权限拒绝、
无数据库错误、热更新、配置失败回滚及新进程重启后的持久词库。HTML 渲染使用 stub，另测文本
降级；统计/签到/教学模型在此 fixture 为内存端口。它不代表真实平台登录、欢迎投递、截图质量或
生产数据库端到端验收；实机操作需要单独授权。

## 语言

签到、积分、问答管理、关键词管理与消息统计根据当前发送者语言显示中文或英文；统计图卡及统一发送链的文本降级使用同一语言。AI Tool 反馈使用可信调用上下文中的语言。

自定义欢迎语、词库回答、用户昵称和分析得到的内容保持原文；问答模板的日期与时间仅使用当前语言格式化，不改变既有时区。命令路径、别名、权限与统计范围不变。签到提示使用当前环境真实命令前缀和命名空间；无法确定调用头时只提示入口，不猜测命令。
