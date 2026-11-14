---
"@zhin.js/adapter": minor
"@zhin.js/core": minor
"@zhin.js/runtime": minor
"zhin.js": minor
"@zhin.js/console-protocol": minor
"@zhin.js/client": patch
---

账号（Endpoint）启动不再阻塞实例就绪（#1250）。实例提交 generation 后即就绪；每个账号最多等约 3 秒宽限期，其余在后台继续启动，失败的账号按退避自动重试（5 秒起翻倍，封顶 5 分钟，±20% 抖动，不限次数）。`Endpoint.start()` 合同不变，适配器无需改动。

行为变化：

1. 实例 ready 与 `/pub/ready` 返回 200 不再意味着账号在线；需要账号在线才算就绪时用 `http.readiness.endpoints`。网关 `gateway.readyTimeout` 不再覆盖账号登录时间。
2. 账号 start 失败不再导致实例启动失败或热重载回滚：改坏账号配置的热重载**会提交**（以前会回滚、旧账号继续在线），旧账号下线，新账号进入 `failed` / `retrying` 并按策略处理。账号停止时清理失败只把该账号标为失败（`endpoint_cleanup_failed`，等待人工处理），不再作为整个 Root 的完整性失败。
3. 宽限期内没完成登录的慢账号，热重载从“先上新再下旧”变为“先下旧再上新”；宽限期内完成的不受影响。
4. `zhin start --once` 是启动检查：宽限期后最多再等 30 秒，直到每个账号的首次启动尝试有结果；有启用账号处于 `failed` 或 `retrying`（首次尝试已失败）时以非零码退出，`stderr` 以首个失败账号的脱敏报错开头并列出全部失败账号；仍在 `starting` 或等待交互式登录（`awaiting_assist`）的账号不算失败。
5. 账号上线前向它发送仍立即失败（`endpoint_inactive`，`not_sent`）。
6. 自动重试会产生周期性的 `endpoint_start_failed` 日志（错误类名、错误码、类别与脱敏后的原始报错 `reason`）；配置错误与交互式登录（`login.mode: interactive`，如 ICQQ）不自动重试，等 Console「重新登录」/「启动」，重新登录也会立即唤醒等待中的重试。

新增：`AdapterEndpointPhase` 的 `failed` / `retrying`，Endpoint 行与 `Adapter.list()` 的 `startAttempt` / `startFailure` / `nextRetryAt`，`Adapter.retryStart()`；core Endpoint 列表把等待登录验证的启动中账号报告为 `awaiting_assist`；需鉴权的 `{api}/system/readiness` 详情新增不参与就绪判断的 `endpoints[]`；Console 协议 `ConsoleEndpointPhase` 新增 `retrying` / `awaiting_assist`，账号页显示「启动中 / 启动失败 / 等待重试」；TTY 启动摘要分 online / starting / failed 列出账号。账号 start 作为 Console 变更执行时，首次尝试失败的执行码由 `endpoint_execution_failed` 改为 `endpoint_start_failed`。

`AdapterIndex.activate()`（Root generation 交接）按上述规则后台启动；`AdapterIndex.start()` 保留给工具与测试，仍等待每个账号的首次尝试，并以 `Endpoint.start()` 原样抛出的首个错误拒绝（随后停止全部账号，不留后台重试）。
