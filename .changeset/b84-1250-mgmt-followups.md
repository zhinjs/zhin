---
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/command": patch
"@zhin.js/feature-kit": patch
---

#1250 第 84 批：收尾第 83 批（Agent 管理命令改为 Root 命令）的复审问题。

- 命令只回应人：命令分发统一过滤非人类来源。消息的可信来源 `origin`（或没有可信来源时适配器自报的 `metadata.origin`）不是 `human` 时，这条消息不进任何命令——不执行、不回复无权限（permit 拒绝）、不给近似指令提示，对所有插件命令都生效；结局 `ignored_bot`（原因 `non_human_origin`，阶段 `command`）。过滤分两层：入站分类器判出的可信来源 `self` / `member` / `peer_bot` 在入站阶段就丢弃（结局 `ignored_self` / `ignored_bot`，阶段 `ingress`），中间件、事件处理器和命令都收不到；命令分发层的过滤是兜底，只对没有可信来源、靠 `metadata.origin` 自报的消息生效，这类消息中间件与事件处理器照常收到。「只回应人」只覆盖 PeerRegistry 里登记过的 zhin 机器人（以及出站台账认得出的本实例消息）：不在 PeerRegistry 里的第三方机器人会被分类器判成 `human`，命令照常响应。Agent 管理命令里各自的来源判断随之删除（结局由 `filtered_by_policy` 改为 `ignored_bot`）。
- `@zhin.js/core`：新增导出 `isNonHumanOrigin()`（`@zhin.js/core/runtime`，Agent 入站复用同一判定）；`InboundOutcomeSink` 新增可选 `reportCount()`；`ImOperationResourcesInput` 新增可选 `conversationSequence`（这条消息在会话里的序号）。
- 结局如实：指令什么都没返回、什么都没发，且执行期间自己记了结局时，分发层不再追加 `command_replied`（它的优先级会压过静默结局）。没有聊天角色的人发 `reset` 却没有清空时，结局记 `not_addressed`（原因 `clear_command`：群里未 @、AI 不回应他等）、`filtered_by_policy`（原因 `outbound_stopped`：控制面停了出站），直播间里记 `not_addressed`（原因 `live_room_clear`）；清空了但冷却期内没有再发确认时记 `cleared`。新增两条原因级结局说明（ADR 0061 表同步）。
- 直播间里没有聊天角色的人发 `reset`：保持静默，不清空也不进 AI 回合（文档写明）。
- `reset` 的清空路径带上这条消息的会话序号，发言闸门把截至这条消息的场景事件（如刚被禁言）折叠进来再判断。
- 分发租约只给 Root 自己分发的 Root 命令操作（Agent 管理命令）：插件命令 / handler 的操作资源里不再有分发租约，深路径导入内部令牌也拿不到，无法钉住旧快照代。操作的 owner 由框架绑定，不由调用方自报：交给插件的消息视图只为它自己的作者打开 Host 资源，自称 Root（`owner: snapshot.root`）时这次操作没有任何 Host 资源；`CommandIndex.dispatch` 从来源消息读操作资源时改从命令作者的视图读取（在执行策略计数之前读取）。
- 插件中间件 / handler / 按钮回调经 `CommandIndex.dispatch({ input, source: context.input })` 分发 Root 命令（项目自己的命令与宿主命令）照常执行，装不装 Agent 都一样，拿到的资源与直接发送一致（例如推理客户端），只是没有分发租约：消息视图经插件作者改绑（含 P → Q → Root、Root → P → Root 等多跳，记为第一个插件作者）时，Host 收到 `ImOperationResourcesInput.delegatedFrom`（新增可选字段）并只去掉分发租约。
- 分发租约不靠令牌保密：Agent 管理命令只认**本 Host 实例**签发的租约端口，并由 Host 侧用真实快照存储再校验一次。`createHostOperationResources()`（`@zhin.js/agent/runtime`）返回值新增 `isDispatchLease(port)`，只认这个工厂实例自己签发的端口（登记在实例私有的 WeakSet 里，不再是模块级登记：插件自己调用公开的 `createHostOperationResources()` 签出的端口不算）；`RuntimeManagementCommandHost` 新增必填 `isDispatchLease`，Agent Host 把自己那个实例的判定传给 `createRuntimeManagementCommands()`。`AgentRuntime` 新增 `ownsLease(lease)`，`AgentTurnIngressRoute.runManagementOperation()` / `clearAsCommand()` 用它校验命令交来的租约属于这个 Root 的真实 SnapshotStore，不属于就拒绝。调用方经显式 `operation` 自造资源视图、对租约令牌（id 可读）回答 `has` / `use` 的，拿不到租约；没有 Host 资源时同样不执行。需要分发租约的 Agent 管理命令（`models` / `health` / `tree` / `fork` / `compact` / `reset`）经插件转发（或自造 `operation`）时不执行，回复中英文提示请用户直接发送该命令（带这条消息的命令前缀，如「请直接发送 /reset。」）。
- `CommandIndex.dispatch`：调用方没传 `commandPrefix` 时用来源消息自身的 `commandPrefix`（帮助文本、命令里的 `formatCommand` 都带前缀）；显式传入消息自身的 `snapshot` 与不传等价——同样校验命令表、按 endpoint 过滤被关插件的命令（ADR 0050，之前显式传入会绕过）、拿到同样的资源；从来源消息读操作资源在执行策略计数之前，读取失败不占冷却额度。
- 结局如实：经插件转发（来源为框架消息、未传 `operation`）的命令以 UserFacingError 拒绝时，`CommandIndex.dispatch` 自己记这条消息的结局 `refused`（原因为命令的拒绝码，如 `direct_command_required`，阶段 `command`），不再只剩中间件的 `handler_replied`。`dispatch` 返回的 `value` 就是给用户的回复（含拒绝提示），中间件必须把它回复出去（文档示例改为 `return result.value`）；中间件不回复时用户收不到提示。`@zhin.js/feature-kit` 新增内部钩子 `operationInputOutcome` / `reportOperationInputOutcome()`，由框架消息实现。
- `createRuntimeManagementCommands()` 必须配合 Host 资源（同一个 `createHostOperationResources()` 实例的 `im` 端口与 `isDispatchLease`）。没有 Host 资源时（嵌入方没接），需要租约的管理命令即使用户直接发送也不执行，回复「管理命令在此实例不可用。」/「Management commands are not available on this instance.」，结局 `refused`（原因 `management_unavailable`，新增原因级结局说明，ADR 0061 表同步），不再误答「不能经插件转发执行，请直接发送」。
