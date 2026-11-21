---
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
---

#1250 第 85 批：收紧入站路由与 Agent 管理命令的分发租约。

- `ingressRouteToken` 改为 Root 私有 token（`createRootPrivateToken`）：插件作用域 `use` / `has` 读不到它，运行时快照的公开资源里也没有它。IM 运行时改经 Root 的真实快照存储按消息租约读取：`resolveIngressRoute(snapshots, lease)`（签名变化，原来是 `resolveIngressRoute(snapshot)`）；`executeInboundTurnSpine` 不再从快照公开资源回退读取路由，只用 `envelope.ingressRoute`。
- 令牌下承载的也只是入站钩子的窄外观：新增 `createIngressRouteFacade(route)`（`@zhin.js/core/runtime`），返回冻结对象，只有绑定到路由的 `preRoute` / `shouldRouteBeforeDispatch` / `route`；Agent Host 不再提供 `AgentTurnIngressRoute` 对象本身，路由的选项（Agent 运行时、快照存储）与 `clearAsCommand` / `runManagementOperation` 都不经令牌暴露。`AgentTurnIngressRoute` 的选项改为 ECMAScript 私有字段（`#options`）。
- 纵深防御：`AgentTurnIngressRoute` 的 `route` / `preRoute` 只处理 Root 真实快照存储签发且仍有效的租约（`AgentRuntime.ownsLease(lease) && lease.active`）；伪造或他人的租约不路由（返回 `false`，静默，记一条 warn 日志），伪造消息无法借此执行清空等操作。
- 分发租约只认本 Host 分发交出的：`createHostOperationResources()` 返回值新增 `holdsDispatchLease(lease)`（只认本工厂签发的租约端口 `retain()` 交出的租约），`AgentTurnIngressRoute` 新增可选项 `holdsDispatchLease`；管理路径除了用真实快照存储校验，还要求租约是本 Host 分发交出的，直接从快照存储 `acquire()` 的租约不执行。**行为变化（嵌入方）**：自行装配时必须把同一个 `createHostOperationResources()` 实例的 `holdsDispatchLease` 传给 `AgentTurnIngressRoute`，不传时 `/models`、`/health`、`/tree`、`/fork`、`/compact`、`/reset` 一律以 `dispatch_lease_rejected` 拒绝；`runManagementOperation` 收到没有 `retainLease` 的分发时也同样拒绝（与 `clearAsCommand` 一致）。校验抛错时，已 retain 的租约在抛出前释放。
- Host 侧拒绝租约时不再抛普通错误：以 UserFacingError 拒绝（结局 `refused`，原因 `dispatch_lease_rejected`），回复「这条管理命令没有通过本实例 Agent Host 的分发校验，没有执行。」（英文同义）。
- `createRuntimeManagementCommands()` 新增可选项 `hostResourcesInstalled`：Host 接好操作资源时传 `true`（`zhin start` 装配的实例已传），调用方自传的 `operation` 即使不提供任何资源，管理命令的结局也是 `direct_command_required`（之前误报 `management_unavailable`）。`imOperationResourcesToken` 是 Root 私有 token，不在运行时快照的公开资源里，所以由 Host 显式声明，而不是从快照判断。
- 结局说明新增原因级模板 `refused` / `direct_command_required` 与 `refused` / `dispatch_lease_rejected`，ADR 0061 表同步；`docs/ai/agent.md`（中英文）补充说明。
