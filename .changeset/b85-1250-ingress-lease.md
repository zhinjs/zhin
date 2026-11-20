---
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

#1250 第 85 批：收紧入站路由与 Agent 管理命令的分发租约。

- `ingressRouteToken` 只暴露 IM 运行时调用的入站钩子：新增 `createIngressRouteFacade(route)`（`@zhin.js/core/runtime`），返回冻结对象，只有绑定到路由的 `preRoute` / `shouldRouteBeforeDispatch` / `route`。Agent Host 在令牌下提供这个窄外观，不再提供 `AgentTurnIngressRoute` 对象本身——插件读令牌拿不到路由的选项（Agent 运行时、快照存储）或 `clearAsCommand` / `runManagementOperation`。`AgentTurnIngressRoute` 的选项改为 ECMAScript 私有字段（`#options`）。
- 分发租约只认本 Host 分发交出的：`createHostOperationResources()` 返回值新增 `holdsDispatchLease(lease)`（只认本工厂签发的租约端口 `retain()` 交出的租约），`AgentTurnIngressRoute` 新增可选项 `holdsDispatchLease`；管理路径除了用真实快照存储校验，还要求租约是本 Host 分发交出的，直接从快照存储 `acquire()` 的租约不执行。没有该选项时一律拒绝。
- Host 侧拒绝租约时不再抛普通错误：以 UserFacingError 拒绝（结局 `refused`，原因 `dispatch_lease_rejected`），回复中英文提示。
- 实例装了 Host 资源时，调用方自传的 `operation` 即使不提供任何资源，管理命令的结局也是 `direct_command_required`（之前误报 `management_unavailable`）。
- 结局说明新增原因级模板 `refused` / `direct_command_required` 与 `refused` / `dispatch_lease_rejected`，ADR 0061 表同步；`docs/ai/agent.md`（中英文）补充说明。
