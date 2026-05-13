# Queue Contract

Queue Contract 负责队列模式事件和出站 detail 在进入 IM 适配器前的字段词汇。它存在的目的，是让队列生产者和 IM 发送方在不共享同一条运行时路径的情况下，对字段含义保持一致。

## 语言

**Queue Envelope**:
携带事件 kind、type、detail 和可选标识符的队列消息外层包装。
_避免使用_：event、payload、job

**Queue Detail**:
Queue Envelope 内部的业务载荷。
_避免使用_：body、data、params

**Outbound Detail**:
描述一条待通过 IM 适配器发送消息的 Queue Detail。
_避免使用_：send job、outgoing payload

**Normalized Outbound Detail**:
字段别名解析后的标准队列出站形状。
_避免使用_：SendOptions、payload

**Ready SendOptions**:
已经经过 Field Contract 或等价内部构造、可以直接交给 Core Adapter 的出站发送数据。
_避免使用_：normalized payload、send job

**Field Alias**:
为了迁移或适配器兼容而接受的队列侧备用字段名。
_避免使用_：synonym、fallback key

**Field Contract**:
队列字段与 Core IM 字段之间可阅读、可执行的映射规则。
_避免使用_：schema、conversion helper

**Claimed Outgoing**:
被生产者侧 worker 领取并准备执行的出站队列项。
_避免使用_：locked message、dequeued job

**Outbound Execution**:
把 Claimed Outgoing 转换为适配器发送动作的队列侧操作。
_避免使用_：delivery、send pipeline

## 关系

- 一个 **Queue Envelope** 只包含一个 **Queue Detail**。
- **Outbound Detail** 是一种 **Queue Detail**。
- **Field Contract** 把 **Field Alias** 解析为 **Normalized Outbound Detail**。
- **Normalized Outbound Detail** 在 **Outbound Execution** 前转换为 Core **SendOptions**。
- **Ready SendOptions** 可以直接进入 Core Adapter，但不能再被当作待规范化的 **Queue Detail**。
- **Claimed Outgoing** 应该走队列出站路径执行，而不是进入 Core IM 入站路径。

## 示例对话

> **开发者：** “生产者发的是 `channelId`，适配器期待的是 `id`，哪个优先？”
> **领域专家：** “由 **Field Contract** 决定别名优先级，并先产出 **Normalized Outbound Detail**，再转换成 Core `SendOptions`。”

## 已标记歧义

- “payload” 曾同时表示整个 envelope 和 detail 对象。已决议：**Queue Envelope** 是外层包装；**Queue Detail** 是内部业务对象。
- “outgoing” 可能表示 IM `sendMessage`，也可能表示队列执行。已决议：队列文档使用 **Outbound Detail**、**Claimed Outgoing**、**Outbound Execution**。

