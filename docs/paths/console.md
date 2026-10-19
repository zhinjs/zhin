---
title: "Console 管理路径：在浏览器里管理运行中的 Bot"
description: "连接 Console，按任务找到对应页面，查看消息和 AI 执行过程，管理 Workroom，并用一条固定顺序排查问题"
---

# Console 管理路径：在浏览器里管理运行中的 Bot

Console 是 Zhin 的网页管理后台。不用登录服务器，你就能看 Bot 是否在线、收发消息、查看 AI 每一步做了什么、排查报错。

做完后你会：

- 知道每类任务该去哪个页面；
- 能从一条消息追到 AI 的执行步骤和日志；
- 分清只读的 Demo token 和可管理的 Full token。

::: tip Console 和 Bot 是分开的
Console 是独立的网页应用（[console.zhin.dev](https://console.zhin.dev)），你的 Bot 进程（Host）只提供受 token 保护的接口。所以同一个 Console 可以连接不同机器上的 Bot。
:::

## 1. 连接 Host

1. 启动 Bot，并复制终端打印的 API Base。
2. 打开 [console.zhin.dev](https://console.zhin.dev)。
3. Token 使用项目 `.env` 中的 `HTTP_TOKEN`。

用脚手架新建的项目默认端口是 `8068`，但请以终端输出或配置里的 `http.port` 为准。连不上时先运行 `npx zhin doctor`。

## 2. 按任务选择页面

| 任务 | 页面 | 看到的事实 |
| --- | --- | --- |
| 判断系统是否健康 | 工作台 | Endpoint、日志、Agent 与待处理事项摘要 |
| 收发消息或处理请求 | 渠道与会话 | Endpoint、会话、消息、通知与请求 |
| 查看 AI 处理一条消息的过程 | Agent 概览 | 每次执行的步骤、工具结果、取消与重试入口 |
| 管理多 Agent 协作项目 | Workroom | 项目内的任务、分派、审核与放行关卡 |
| 确认某个命令或工具真的加载了 | 运行时能力 | 命令、中间件、组件、Tool、Prompt Section 与 MCP |
| 排查失败 | 日志 | 级别、来源、时间线和详情 |
| 修改系统 | 配置、环境变量、文件、数据库 | 仅 full scope 开放的管理面 |

**配置里写了不等于已经生效。** 判断某个能力是否可用，以“运行时能力”页面显示的当前加载结果为准。

## 3. 收发消息

在“渠道与会话”中选择一个 Endpoint（Bot 在某个平台上登录的账号）和会话，就能查看和发送消息。新消息实时推送；刷新页面后，已保存的历史消息仍在。

::: details 为什么有些平台看不到更早的历史？
页面通过 SSE 接收实时事件，通过 HTTP 拉取历史；断线重连后如果中间有缺口，会重新拉取当前会话。如果某个平台的适配器不提供历史消息接口，Console 只能显示 Bot 运行期间自己保存下来的那部分。
:::

## 4. 查看 AI 的执行过程

“Agent 概览”列出每一次 AI 执行（Run），点开能看到模型的每一步、调用了哪些工具、结果是什么，以及是否被取消。也可以在这里取消正在执行的任务，或导出一份执行报告。

工作台里还可以开实验会话：启动时指定工作目录和安全策略，会话由 Host 保存，刷新后仍在。

::: details 怎么确定一次执行对应哪条消息？
每次执行以 `runtimeId + turnId` 唯一标识，不要靠时间或消息文本去猜。执行开始时用到的工具、Prompt Section 和 MCP 会被固定下来，中途保存代码不会影响这一次执行。
:::

## 5. 管理 Workroom

Workroom 是多个 Agent 协作完成任务的空间，绑定一个群、频道或 GitHub 仓库；同一个 Bot 账号可以服务多个 Workroom。概念介绍见 [Agent 深入](../ai/agent.md#workroom-kernel)。

- **“Workroom 配置”**：新建或修改 Workroom，保存后立即生效，不用重启。成员里的 Agent 必须是 `ai.agents` 中已经配置的。
- **看板**：查看任务、分派、审核人和放行关卡的当前状态。

::: details 配置存在哪？看板上能直接改任务状态吗？
Console 里的 Workroom 配置保存在持久化的 Runtime Catalog 中，**不会**写回 `zhin.config.yml` 的 `ai.workrooms`。看板内容是 Workroom Journal（事件日志）的只读视图；Console 不能直接改写任务状态，所有修改都要通过经过认证的控制接口提交。
:::

## 6. Full token 与 Demo token

| | Full token | Demo token |
| --- | --- | --- |
| 查看状态、能力列表、执行过程 | ✅ | ✅ |
| 发送消息、修改配置/环境变量/文件/数据库 | ✅（按 Host 策略） | ❌ |
| 读取原始 YAML 配置 | ✅ | ❌ |

Token 就是密码：不要放进 URL、截图或公开的前端配置里。

::: details 远程部署时连不上？
在配置中设置 `http.corsOrigins` 允许 Console 的域名；如果前面有反向代理，要同时转发 API、SSE、WebSocket 和页面资源，只转发普通 HTTP 请求会导致实时消息或页面加载失败。详见 [生产部署与运维](../operations/production.md)。
:::

## 7. 出问题时按这个顺序查

如果能在会话中找到那条入站消息，先打开消息的“诊断”。它按完整会话与平台消息 ID 查询，显示实际观测到的来源分类、前缀检查、中间件、指令状态及回复投递；不会重新执行消息。

- `completed` 只表示本次入站处理已结束；交给 Agent 不等于 Agent 已完成。
- 投递 `sent` 表示 Endpoint 返回了消息 ID，不保证远端客户端已经展示；`deliveryUnknown` 表示结果不确定，应先核实原会话，不自动重发。
- 每个 IM Runtime 仅在内存保留最近 15 分钟、最多 500 条记录；重启、过期或容量淘汰后查不到，不代表处理成功或从未收到。
- 诊断仅允许 full scope 读取，不另存正文、发送者资料或原始异常。单条记录最多保留 32 个步骤与 32 次投递；超出时 `truncated: true` 表示记录不完整，不替代完整审计日志。

Host 查询入口为 `GET /api/messages/diagnostics`：`id` 查询一条记录，或用 `conversation`（完整 `ConversationRef` JSON）、`messageId` 精确筛选，`limit` 为 1–100。找不到记录时，再按下面的路径排查。旧版 Host 不提供此接口，需分别更新 Host 与独立 Console。

1. **工作台**：Bot 连上了吗？各 Endpoint 在线吗？
2. **渠道与会话**：用户的消息到达 Bot 了吗？
3. **运行时能力**：相关的命令、工具或 Prompt Section 加载了吗？
4. **Agent 概览**：AI 执行到哪一步、以什么状态结束？
5. **日志**：按同一时间段和来源筛选，找具体报错。

## 管理员任务中心

「任务中心」（`/tasks`）先按“我想做什么”展示用途，再读取当前运行实例实际提供的任务服务。没有安装或加载提醒插件时，页面提供安装入口；同一个包有多个实例时须选择具体实例。旧版 Host 不支持任务接口，需要单独升级 Host 和 Console。

首版支持持久提醒插件的管理员任务。配置 Database Host 后，在页面选择已加载的提醒实例、投递账号、会话种类及 ID；有父容器或话题时也要完整填写。账号来自实际 Endpoint 列表；平台不提供会话目录时手动填写精确目标，不能用显示名替代身份。确认目标、含时区的绝对时间、内容及未来发送效果后再创建；创建成功表示任务已保存，不表示平台在线或消息已经发送。

管理员任务与聊天个人任务分开存储和限额。聊天创建的提醒继续归真实发送者，任务中心不会冒充平台用户，也不展示或取消其个人提醒。管理任务必须使用显式配置且验证通过的 full scope Bearer Token，未配置 Token 和 demo Token 均不能使用。

任务可用操作由插件返回：待执行任务可暂停，暂停后才可编辑或恢复；取消不能撤回已经开始的发送。投递结果为 `unknown` 时只允许核实后取消，不提供重试或恢复。固定周期表示间隔秒数，不等于按本地日历“每天同一时间”。自然时间解析、订阅任务及更多用途仍在后续计划中。

页面保留提交时的运行代与任务版本，冲突时保留草稿，不静默覆盖。请求超时或响应丢失时保留操作 ID 并冻结写入，只读取插件持久回执核对；没有找到回执不能推断操作未执行。换登录后需明确确认原操作身份才能核对，不会自动重发。页面临时保存的核对信息不包含任务正文、参数或凭据。

Host 接口为 `GET /api/tasks/use-cases`、`GET /api/tasks/providers`、`POST /api/tasks/create` 和 `POST /api/tasks/change`。任务事实、并发版本及操作回执由插件持久化，Host 不另建调度器。参见[持久提醒插件](../../plugins/utils/reminder/README.md)与 [CLI 用途指南](../cli/index.md#use-cases按用途找到配置入口)。

## 下一步

- [Console 概览](../console/)：Console 与 Host 如何分工、页面扩展
- [Agent 深入 · Workroom Kernel](../ai/agent.md#workroom-kernel)：Workroom 的规则与配置
- [多平台社区 Bot](../showcase/community-bot.md)：一个多平台生产案例
