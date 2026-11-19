---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/core": patch
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

前几批审查遗留的低危项（#1250 第 56 批）。

- **移除工具预执行**（ADR 0067 遗留）：`preExecutable` 工具原先在模型调用前被执行，输出作为「Pre-fetched data」注入提示词，不经工具运行时、不记来源。Plugin Runtime 路径本就不保留这个标记，只有旧的 `ZhinAgent.process` / `processTurn` / `processStream` 能走到，而这条路径没有来源门禁，因此直接删除该机制：回合不再注入预取数据；`@zhin.js/agent/tool` 的 `planToolRun()` 与 `ToolRunPlan` 已弃用、不再起作用（不执行任何工具，总是返回空的预执行结果），下一个 minor 删除；`AgentTool.preExecutable`（`@zhin.js/ai`）、`Tool.preExecutable` 与 `SceneManagementMethodSpec.preExecutable`（`@zhin.js/core`）保留为 `@deprecated`、不再起作用，成员列表 / 场景信息工具不再标记它。`ai.agent.preExecTimeout` 改为已弃用键（启动告警、`zhin config check` 报告、`--fix` 删除），从 `@zhin.js/runtime` 的配置 schema 与默认配置中移除。
- `TriggerTimeoutError` 合并为一个类：`@zhin.js/agent/runtime` 重新导出 `@zhin.js/agent/turn` 的实现，工具运行时把入站超时正确认作 harness 错误。构造函数以超时毫秒数为主（`new TriggerTimeoutError(60000)`），旧的 `(sessionKey, timeoutMs)` 写法仍可用（已弃用），消息统一为「AI 处理超时（Nms）」。
- 网络请求被重定向到不允许的地址，或重定向那一跳出现其他网络错误（DNS 解析失败、TLS 证书主机名不符等）时，错误原因改为固定文案，不再带出重定向目标的主机名或解析出的地址（原因只写 debug 日志）；首个 URL 的错误原因不变。
- `zhin update` 的 pnpm overrides 同步（`@zhin.js/gateway`，`zhin update --dry-run` 的 `@zhin.js/cli` 同步一致）：`pnpm-workspace.yaml` 中值为 YAML 块标量（`>-` / `|`）、带锚点且被别名引用、或本身是别名的 Zhin 条目，一律列为「需要手动修改」并给出文件行号，不再自动剪下（块标量原先会多剪下一条，锚点剪掉后别名悬空）。
- 协作：有协作的根回合在流式回复的每次中间更新和收尾时都过滤 `[[no_reply]]` 标记（含大小写、反引号变体；生成中结尾可能成为标记的残片先暂缓发出），已发内容不被改写，不会因前缀变化被平台流拒绝；actor 回合结束和根回合结束后迟到的委派读取不再登记，结果邮件立即照常处理，不再空等 120 秒。
