# Core IM Runtime

Core IM Runtime 负责平台无关的即时消息概念：适配器、消息、调度、命令/AI 路由和出站发送链。它存在的目的，是让平台适配器和上层 Agent 能力共享同一套运行时词汇。

## 语言

**Adapter**:
定义平台身份、能力、消息规范化与 Provisioning 规则的平台集成模型；不拥有跨 generation 的连接生命周期。
_避免使用_：connector、transport、client

**Endpoint**:
一个稳定的平台账号身份；其连接与 generation 视图分别由 **Endpoint Transport** 和 **Endpoint Binding** 表达。
_避免使用_：robot、session、connection

**Endpoint Transport**:
Process Host 为一个 Endpoint 持有的真实平台连接；普通 generation reload 不替换它，影响连接身份或实现的变化要求进程重启。
_避免使用_：generation Endpoint、hot-reload connection

**Endpoint Binding**:
一个 generation 内对 Endpoint 身份、能力与消息规范化规则的不可变视图；入站操作通过它进入该操作持有的 generation。
_避免使用_：live connection、mutable Endpoint registry

**Transport-affecting Change**:
改变 Endpoint 凭据、账号、连接地址或 transport implementation，因而不能作为普通 generation reload 原子应用的变化。
_避免使用_：Adapter slot reload、connection hot swap

**Endpoint Capability**:
Endpoint 实例声明的 IO 能力子集（`inbound` 监听入站、`outbound` 发送出站），不可超出 Adapter 上限。
_避免使用_：mode、direction flag

**Inbound Envelope**:
Gateway 边界归一化后的不可变 IM 输入；由 `ConversationRef`、`ActorRef`、`MessageRef` 与 canonical `Segment[]` 构成。纯文本只能从 Segment 确定性投影，不能作为第二事实源。
_避免使用_：classic Message、`$` 字段、content/segments 双事实源、packet

**Runtime Message View**:
一个入站 operation 在固定 **Generation View** 上得到的只读便利视图；回复能力通过 snapshot-bound port 提供。它不得跨 operation 保存，也不得转换成 Agent 的 synthetic Message。
_避免使用_：Message.from、createSyntheticMessage、bridgeRuntimeMessage

**Message Channel**:
Message 或 SendOptions 指向的会话身份。
_避免使用_：room、peer、scene

**SendOptions**:
传给 Adapter 用于实际发送的标准出站数据。
_避免使用_：job payload、send request、outbound event

**Ingress Pipeline**:
对 **Inbound Envelope** 执行 normalize、policy、typed middleware、Command Route、Agent Route 与 terminal journal 的单一深模块；每条 ingress 恰好一个 typed terminal outcome。
_避免使用_：Inbound Runner、lifecycle broadcast、unmatched setter

**Ingress Route Index**:
generation snapshot 中不可变的 owner-bound 路由投影。Command 返回 `not_found | forbidden | executed | failed`；只有 `not_found` 可继续进入 Agent route。
_避免使用_：Message Dispatcher、setAIHandler、setUnmatchedHandler、dual mutable route

**Guardrail**:
命令或 AI 处理前用于放行或停止 Message 的 dispatcher 阶段。
_避免使用_：filter、validator

**Lifecycle Event**:
dispatch 后触发的 Plugin 事件，用于让观察者响应运行时活动。
_避免使用_：middleware、handler

**Outbound Polish**:
Dispatcher 作用域内的回复润色逻辑，但仍必须流经 `before.sendMessage`。
_避免使用_：send shortcut、adapter override

**HTML Segment**:
出站 `type: 'html'` 等 Rich Segment：registry + policy + optional capability loader；增 kind 用 `registerRichSegmentKind`，增转码能力用 `registerRichSegmentCapabilityLoader`。
_避免使用_：双格式 text+html 回退；Endpoint 层重复做 semantic 转换

**Primary Config**:
由配置服务标记的主应用配置，运行时通过默认约定和用户差异 deep merge 得到。
_避免使用_：zhin.config.yml、raw config file

**Side Event**:
非聊天入站的 IM 事件，分 **Notice**（只读通知）、**Request**（可 `$approve`/`$reject`）与 **System Event**（Endpoint 生命周期/登录等系统信号）。统一字段 `$foo_bar`；`$type` 仅存命名空间（`notice`/`request`/`system`），`$scene_id` + `$scene_type` + `$sub_type` 组合完整名。
_避免使用_：side event、notification event（泛指）

**Side Event Type**:
完整类型名由 `formatSideEventName(event)` 生成，格式 `${$type}.${$scene_type}.${$sub_type}`（如 `notice.group.member_increase`、`request.friend.add`）。消费者用 `matchesSideEventName(event, 'notice.group.recall')` 匹配。
_避免使用_：notice_type 字符串混用、在 `$type` 内嵌完整三段名

## 关系

- 一个 **Adapter** 描述零个或多个 **Endpoint**，并声明自身支持的 **Endpoint Capability** 上限。
- **Process Host** 为已配置的 **Endpoint** 独占 **Endpoint Transport**；generation 只发布对应的 **Endpoint Binding**。
- **Transport-affecting Change** 要求显式进程重启；不影响 transport 的 Binding、命令、路由与渲染变化可以 generation reload。
- 仅有 `inbound` 能力的 **Endpoint** 为 **Ingress Pipeline** 产生 **Inbound Envelope**。
- **Ingress Pipeline** 只从所持 generation snapshot 读取 **Ingress Route Index**；shadow candidate 不得通过 setter 接管现有流量。
- Command `forbidden` 是终态，绝不降级为 Agent fallback。
- IM → Agent 只在 composition root 构造 Agent-owned `TurnIngress`；Core 不生产 synthetic/classic Message。
- **Outbound Polish** 可以改写 **SendOptions**，但不能绕过 Adapter 发送链。
- 读取应用配置时使用 **Primary Config**，不要绑定具体文件名。

## 示例对话

> **开发者：** “这个插件应该用 `addMiddleware` 拦截 **Message** 吗？”
> **领域专家：** “不应该。真实 IM 入站会经过 **Inbound Runner** 和 **Message Dispatcher**；如果要阻止处理，用 dispatcher guardrail；如果只是观察，用 lifecycle。”

## 已标记歧义

- “middleware” 过去同时指命令路由和插件拦截。已决议：路由属于 **Ingress Route Index**；middleware 只能返回 typed continue/suppress/reject/transform，after 阶段只能观察 terminal outcome。
- “channel”“scene”“room” 都曾表示会话身份。已决议：Core 使用 **Message Channel**。
- classic `Plugin` / `Adapter` / `Endpoint` / `Message` / `Dispatcher` / `Feature` 执行世界已决议整体删除；不保留 deprecated 出口、throwing stub 或新旧转换桥。
