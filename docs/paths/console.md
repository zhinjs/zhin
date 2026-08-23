# 用 Console 管理运行中的 Zhin

目标：不登录服务器，也能确认当前 generation、处理消息、诊断问题和观察 Agent/Workroom。Console 是独立 Web 应用；Host 提供受 token 保护的 API、SSE 和 Sandbox。

## 完成标准

- 能区分“配置期望”与“当前运行态”。
- 能从 Endpoint 消息定位到 Agent 步骤与日志。
- 刷新页面后，持久会话和 Workroom Task 仍可恢复。
- Demo token 只读，full token 才能执行管理操作。

## 1. 连接 Host

1. 启动 Bot，并复制终端打印的 API Base。
2. 打开 [console.zhin.dev](https://console.zhin.dev)。
3. Token 使用项目 `.env` 中的 `HTTP_TOKEN`。

新脚手架当前默认端口是 `8068`，但 Console 应始终以终端输出或 `http.port` 为准。连接失败先运行 `npx zhin doctor`。

## 2. 按任务选择页面

| 任务 | 页面 | 看到的事实 |
| --- | --- | --- |
| 判断系统是否健康 | 工作台 | Endpoint、日志、Agent 与待处理事项摘要 |
| 收发消息或处理请求 | 渠道与会话 | Endpoint、会话、消息、通知与请求 |
| 观察一次 Agent 执行 | Agent 概览 | Run、步骤、工具结果、取消与重试入口 |
| 管理协作项目 | Workroom | Project-scoped Run、Task、Assignment 与 Gate |
| 核对实际装载能力 | 运行时能力 | 命令、中间件、组件、Tool、Prompt Section 与 MCP |
| 排查失败 | 日志 | 级别、来源、时间线和详情 |
| 修改系统 | 配置、环境变量、文件、数据库 | 仅 full scope 开放的管理面 |

不要从配置文件推断能力已经生效。以“运行时能力”中的 generation projection 和具体 Run 为准。

## 3. 验证实时消息与历史恢复

“渠道与会话”通过 SSE 接收增量事件，并通过 HTTP RPC 拉取权威历史。断线恢复出现 gap 时，Console 会清空增量投影并重新拉取当前 Endpoint/Channel。

刷新页面不应丢失 Host 已持久化的消息。若某适配器不提供历史能力，Console 只能展示 Host 收件箱中已经持久化的部分。

## 4. 使用 Agent 工作台

Agent Run 以 `runtimeId + turnId` 标识，不能只靠时间或消息文本猜测归属。工作台展示模型步骤、Tool 调用、取消终态和可携带报告。

实验会话由 Host 持久化；启动任务时可指定工作目录和安全策略。Prompt Section、Tool 与 MCP 则从该回合固定的 generation snapshot 读取。

## 5. 使用 Workroom 看板

一个 Workroom 绑定一个完整协作空间：群、频道或 GitHub 仓库。同一个 Bot Endpoint 可以服务多个 Workroom。

“Workroom 配置”写入持久 Runtime Catalog，保存立即生效，不修改 `ai.workrooms`，也不要求重启 Host。成员中的 Agent 必须引用当前 `ai.agents` binding。

看板的 Run、Task、Assignment、Reviewer 与 Sponsor Gate 来自 Workroom Journal 的只读投影。Console 不直接伪造 Task 状态；写操作必须进入受认证的 typed control port。

## 6. Full 与 Demo 的权限边界

- Full token：按 Host 策略开放配置、环境变量、文件、数据库和控制操作。
- Demo token：只读目录与投影；不读取原始 YAML，也不能发送、渲染或修改资源。
- Token 是权限凭据，不要放进 URL、截图或公开前端配置。

远程部署时配置 `http.corsOrigins`，并让反向代理转发 API、SSE、WebSocket 与页面条目。不要只代理普通 HTTP 请求。

## 7. 一条标准排障链

1. 工作台确认连接和健康状态。
2. 渠道与会话确认入站是否到达。
3. 运行时能力确认命令、Tool 或 Prompt Section 是否在当前 generation。
4. Agent 概览检查执行步骤和终态。
5. 日志按同一时间段和来源收窄。

## 下一步

- Console 与 Host 的边界：[Console 架构](../console/)
- Workroom 的事实模型：[Workroom Kernel](../ai/agent.md#workroom-kernel)
- 多平台生产案例：[多平台社区 Bot](../showcase/community-bot.md)
