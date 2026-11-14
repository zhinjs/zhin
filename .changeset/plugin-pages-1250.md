---
"@zhin.js/client": patch
"@zhin.js/console-contract": minor
"@zhin.js/pagemanager": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-idiom-chain": patch
---

官方插件 Console 页面与命令可用性（#1250 反馈八、九）。

- `@zhin.js/client` 新增会话选择器与会话显示名：`ConversationPicker`（从机器人账号与最近会话中选择、可搜索、「手动填写（高级）」）、`ConversationLabel`、`useConversationDirectory` / `useSharedConversationDirectory`、`parseConversationAddress`、`formatConversationLabel` 等。数据来自已有的 `endpoint.list` 与 `inbox.recent`，按现有 Console 权限表鉴权（没有 `endpoint.view` 时退回原始 ID 与手动填写）。
- 声明式页面（`@zhin.js/console-contract` 与渲染端）新增：表单字段 `type: 'date' | 'time' | 'conversation'`（`conversationKinds`）、列类型 `conversation`、条目 `muted` / `badge`、取值表达式 `$i18n`（按查看者语言取 `{ 'zh-CN', en }`）、动作 `result`（结果紧贴表单内联显示，不再是页顶横幅）。页面构建桩同步支持 `$i18n`。
- 群管套件：会话列显示会话名而不是 `["conversation-v1", …]` 键，签到排行显示昵称；问答与关键词按 `teach-list` / `keyword-list` 口径分别统计并合计，持久关键词经插件级索引计入（索引建立前保存的词库在该群下次修改后出现）。
- RSS：添加订阅用会话选择器选择推送会话并保存精确目标（`target_json`），不再手填平台与目标 ID；订阅列表按会话名显示。旧的 `adapter` / `targetType` / `targetId` 参数仍可用。
- 进程监控：区分「本次运行」与「累计（自某日起）」，新增近 24 小时崩溃 / 重启数（状态文件记录带时间戳的事件，旧文件兼容，起点按文件创建时间估算并注明），详情标签全部本地化。
- 日历：新建日程使用日期 / 时间选择器（服务端校验 `HH:mm`），删除放到日程列表每一行。
- 彩票：显示定时推荐开关；关闭时 Cron 置灰并标注「未启用」。
- 内容审核：「检测文本」干跑结果紧贴输入框、本地化显示判定、严重度、命中词、审核源与按当前 `actions` 配置将执行的动作（干跑接口新增可选字段 `hits`、`flaggedSources`、`decisionI18n`、`severityI18n`、`actionsI18n`、`hitsText`、`sourcesText`）。
- 成语接龙：帮助与游戏大厅提示中文写法 `接龙 同音` / `接龙 同字`（英文 `pinyin` / `char`），`start_pinyin` / `start_char` 仍可用。
