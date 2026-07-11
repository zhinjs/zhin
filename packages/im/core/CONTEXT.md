# Core IM Runtime

Core IM Runtime 负责平台无关的即时消息概念：适配器、消息、调度、命令/AI 路由和出站发送链。它存在的目的，是让平台适配器和上层 Agent 能力共享同一套运行时词汇。

## 语言

**Adapter**:
持有 Endpoint 实例，并把平台事件转换为 Core Message 的平台运行时。
_避免使用_：connector、transport、client

**Endpoint**:
由 Adapter 管理的平台账号实例；按 **Endpoint Capability**（`inbound` / `outbound`）实现 `InboundEndpoint`、`OutboundEndpoint` 或全双工 `FullEndpoint`。
_避免使用_：robot、session、connection

**Endpoint Capability**:
Endpoint 实例声明的 IO 能力子集（`inbound` 监听入站、`outbound` 发送出站），不可超出 Adapter 上限。
_避免使用_：mode、direction flag

**Message**:
带有发送者、频道、内容和回复行为的入站 IM 事件。
_避免使用_：event、update、packet

**Message Channel**:
Message 或 SendOptions 指向的会话身份。
_避免使用_：room、peer、scene

**SendOptions**:
传给 Adapter 用于实际发送的标准出站数据。
_避免使用_：job payload、send request、outbound event

**Inbound Runner**:
按顺序处理 `message.receive` 的 Core 模块，顺序为 dispatcher、lifecycle、adapter observers。
_避免使用_：middleware chain、receive hook

**Message Dispatcher**:
为入站 Message 执行 guardrail、路由、命令处理和 AI 处理的 Core 模块。
_避免使用_：router、middleware

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
非聊天入站的 IM 事件，分 **Notice**（只读通知）与 **Request**（可 `$approve`/`$reject`）。统一字段 `$foo_bar`；`$type` 仅存命名空间（`notice`/`request`），`$scene_id` + `$scene_type` + `$sub_type` 组合完整名。
_避免使用_：side event、notification event（泛指）

**Side Event Type**:
完整类型名由 `formatSideEventName(event)` 生成，格式 `${$type}.${$scene_type}.${$sub_type}`（如 `notice.group.member_increase`、`request.friend.add`）。消费者用 `matchesSideEventName(event, 'notice.group.recall')` 匹配。
_避免使用_：notice_type 字符串混用、在 `$type` 内嵌完整三段名

## 关系

- 一个 **Adapter** 持有零个或多个 **Endpoint**，并声明自身支持的 **Endpoint Capability** 上限。
- 仅有 `inbound` 能力的 **Endpoint** 为 **Inbound Runner** 产生 **Message**；仅有 `outbound` 能力的 Endpoint 不参与 `$connect`。
- **Inbound Runner** 先调用 **Message Dispatcher**，再触发 **Lifecycle Event**。
- **Message Dispatcher** 在命令或 AI 路由前可以运行一个或多个 **Guardrail**。
- **Message** 通过为自身 **Adapter** 生成 **SendOptions** 来回复。
- **Outbound Polish** 可以改写 **SendOptions**，但不能绕过 Adapter 发送链。
- 读取应用配置时使用 **Primary Config**，不要绑定具体文件名。

## 示例对话

> **开发者：** “这个插件应该用 `addMiddleware` 拦截 **Message** 吗？”
> **领域专家：** “不应该。真实 IM 入站会经过 **Inbound Runner** 和 **Message Dispatcher**；如果要阻止处理，用 dispatcher guardrail；如果只是观察，用 lifecycle。”

## 已标记歧义

- “middleware” 过去同时指命令路由和插件拦截。已决议：IM 入站由 **Inbound Runner** 和 **Message Dispatcher** 负责；middleware 只表示遗留或显式手动接入的路径。
- “channel”“scene”“room” 都曾表示会话身份。已决议：Core 使用 **Message Channel**。

