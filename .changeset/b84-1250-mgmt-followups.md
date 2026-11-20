---
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/command": patch
---

#1250 第 84 批：收尾第 83 批（Agent 管理命令改为 Root 命令）的复审问题。

- 命令只回应人：命令分发统一过滤非人类来源。消息的可信来源 `origin`（或没有可信来源时适配器自报的 `metadata.origin`）不是 `human` 时，这条消息不进任何命令——不执行、不回复无权限（permit 拒绝）、不给近似指令提示，对所有插件命令都生效；结局 `ignored_bot`（原因 `non_human_origin`，阶段 `command`）。过滤分两层：入站分类器判出的可信来源 `self` / `member` / `peer_bot` 在入站阶段就丢弃（结局 `ignored_self` / `ignored_bot`，阶段 `ingress`），中间件、事件处理器和命令都收不到；命令分发层的过滤是兜底，只对没有可信来源、靠 `metadata.origin` 自报的消息生效，这类消息中间件与事件处理器照常收到。「只回应人」只覆盖 PeerRegistry 里登记过的 zhin 机器人（以及出站台账认得出的本实例消息）：不在 PeerRegistry 里的第三方机器人会被分类器判成 `human`，命令照常响应。Agent 管理命令里各自的来源判断随之删除（结局由 `filtered_by_policy` 改为 `ignored_bot`）。
- `@zhin.js/core`：新增导出 `isNonHumanOrigin()`（`@zhin.js/core/runtime`，Agent 入站复用同一判定）；`InboundOutcomeSink` 新增可选 `reportCount()`；`ImOperationResourcesInput` 新增可选 `conversationSequence`（这条消息在会话里的序号）。
- 结局如实：指令什么都没返回、什么都没发，且执行期间自己记了结局时，分发层不再追加 `command_replied`（它的优先级会压过静默结局）。没有聊天角色的人发 `reset` 却没有清空时，结局记 `not_addressed`（原因 `clear_command`：群里未 @、AI 不回应他等）、`filtered_by_policy`（原因 `outbound_stopped`：控制面停了出站），直播间里记 `not_addressed`（原因 `live_room_clear`）；清空了但冷却期内没有再发确认时记 `cleared`。新增两条原因级结局说明（ADR 0061 表同步）。
- 直播间里没有聊天角色的人发 `reset`：保持静默，不清空也不进 AI 回合（文档写明）。
- `reset` 的清空路径带上这条消息的会话序号，发言闸门把截至这条消息的场景事件（如刚被禁言）折叠进来再判断。
- 分发租约只给 Root 拥有的命令操作（Agent 管理命令）：插件命令 / handler 的操作资源里不再有分发租约，深路径导入内部令牌也拿不到，无法钉住旧快照代。操作的 owner 由框架绑定，不由调用方自报：交给插件的消息视图只能为它自己的作者创建操作，自称 Root（`owner: snapshot.root`）或把消息改绑到 Root 再创建都会被拒绝；`CommandIndex.dispatch` 从来源消息读操作资源时改从命令作者的视图读取。
