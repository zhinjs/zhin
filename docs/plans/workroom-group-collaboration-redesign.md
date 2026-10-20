---
sidebar: false
---

# Workroom 重构方案：群内多 Bot 角色协作

状态：Draft（阶段 A 进行中，已落地 A1/A2a；方案内容仍以本文为准）

## 目标

> 多个 bot 在群里根据自己的角色不同，协同完成工作。

后续所有取舍都以这句话为准。凡是这句话用不到的机制，默认移出主路径。

## 1. 现状

### 1.1 规模

`@zhin.js/agent` 共 106,787 行 `src`，约占全仓库源码的一半。Workroom 相关代码分布如下：

| 位置 | 行数 / 文件 | 内容 |
|---|---|---|
| `agent/src/workroom/` | 32,510 / 90 | 事件溯源 Kernel、remote dispatch outbox / callback inbox、profile registry、acceptance、scheduler、legacy migration |
| `agent/src/plugin-runtime/workroom-*`（A1 后位于 `agent/src/workroom-runtime/`） | 约 19,000 / 61 | 接入 Runtime 的组装层：authority、data-governance、portfolio、acceptance composition。其中 `github-*`、`self-delivery-*`、`database-overlay-*` 同样属于 Workroom，已在 A1 一并移走 |
| `agent/src/plugin-runtime/` 其余文件 | 约 5,200 / 24 个文件（通用 Agent runtime） | **通用** Agent runtime：turn engine、capability ingress、native tools。这部分与 Workroom 无关 |
| `agent/src/data-governance/` | 6,670 / 12 | 加密 payload vault、披露授权、生命周期 |
| `agent/src/portfolio/` | 4,323 / 8 | 跨项目容量、admission、sponsor |
| `basic/cli/src/plugin-runtime/workroom/` 及命令 | 约 6,400 / 23 | CLI 侧 coordinator、`agent-workroom` 命令、legacy payload 命令 |

Workroom 体系合计约 **7.5 万行**。真正的 Agent 核心（turn、tool、prompt、security、session 与通用 plugin-runtime）约 4.3 万行（106,787 − 约 63k ≈ 43k）。

### 1.2 目录级依赖图（`agent/src` 内部）

```mermaid
graph LR
  subgraph Core[Agent 核心]
    turn; tool; init; config; routing; decision; event; security
  end
  subgraph W[Workroom 体系]
    PR[plugin-runtime<br/>通用 + workroom 混合]
    WR[workroom]
    DG[data-governance]
    PF[portfolio]
  end
  PR -->|248| WR
  PR -->|36| DG
  PR -->|23| PF
  PF -->|10| WR
  WR -->|17| DG
  DG -->|15| WR
  WR -->|3| PF
  PR -->|19| turn
  PR -->|10| decision
  init -.->|反向 12| WR
  init -.->|反向| DG
  init -.->|反向| PF
  config -.->|反向| WR
  routing -.->|反向| WR
```

注意：`agent` 入口文件对 workroom 符号的 re-export（`packages/im/agent/src/index.ts` 中的 `export * from './workroom/...'`、`./workroom-runtime/...` 等）是兼容层，由 A4 处理，不在本依赖图的边数里。

结论：

1. **`workroom` 本身几乎不依赖 Agent 核心**，它是一个纯领域层，可以整体搬出。
2. **反向依赖只有 6 处**（origin/main 原有的核心文件），都可以机械修复；A2a 之后只剩 `plugin-runtime/deferred-capability-plan`，留待 A2c：

   | 文件 | 依赖 | 修法 |
   |---|---|---|
   | `init/define-ai-database-models.ts` | Workroom / portfolio / data-governance 的 DB model | 改为由 Workroom 插件在自己的 setup 里注册 model |
   | `init/activate-ai-database-storage.ts` | Workroom journal / catalog、semantic memory | 同上；semantic memory 移入核心 |
   | `config/index.ts` | `validateWorkroomDefinitions` | 移到 Workroom 包的 config 子路径 |
   | `routing/workroom-bot-identity.ts` | `catalog-definition` | 整个文件移入 Workroom 包 |
   | `plugin-runtime/agent-host-port.ts` | Workroom 端口 | 随 A2 拆出 Workroom Host 端口（`workroomHostToken`） |
   | `plugin-runtime/deferred-capability-plan.ts` | Workroom 相关类型 | A2c 处理（A2 后唯一剩余） |

   注：`tool/*` 依赖通用 `plugin-runtime` 是核心依赖通用代码，不算反向依赖。当前 DB model 由 CLI 持久化协调器分两组注册（`defineAiDatabaseModels` + `defineWorkroomDatabaseModels`），属过渡做法。

3. **`data-governance` 与 `workroom` 互相依赖**（17 / 15），形成循环，拆包前必须先断开。
4. **`plugin-runtime/` 混放了两类东西**。它通过 `@zhin.js/agent/runtime` 对外导出，有 68 个外部文件在用，`index.ts` 里有 72 行 workroom 导出。所以通用 runtime 被 Workroom 绑住了。
5. `basic/cli` 的测试直接测 workroom 内部的 coordinator，内部重构会被测试锁死。

## 2. 与目标的错位

这一节最重要。现有设计在几个关键前提上与目标相反：

| 目标需要 | 现有设计（出处） |
|---|---|
| 多个 Bot 账号在群里各自发言 | `examples/multi-agent-room/README.md`：“不需要多个 Bot 账号，也不通过群内 `@` 或文本 task ID 传递 Agent 工作” |
| 群聊就是协作现场 | 同一 README：“IM 只负责用户输入和结果投递，不承担 Agent 间通信”；`docs/plans/agent-workroom-orchestration-decision-map.md`：“Agent discussion 与 IM 消息不是协作协议” |
| 群成员能直接找某个角色 | 同一决策地图：“Workroom 人类消息只进入 Orchestrator” |
| 拉几个 bot 进群就能开始 | 首次 `/work` 之前要配置 Console principal、sponsors、`trustedPackPublishers`，重启后再“初始化规划能力”、发布 Profile 与 Planning Policy |

现有体系是一个**企业级工作流引擎**：sponsor、跨项目 portfolio 容量、抢占、风险分级验收、远程执行 outbox/inbox、加密数据治理、overlay pack 发布。群聊只是它的展示端。目标要的是**群聊原生的角色协作**。这不是代码质量问题，是产品模型不同。

所以本方案不是“整理现有 7.5 万行”，而是**换一个更小的核心，把现有能力降级为可选扩展或删除**。

## 3. 目标模型

### 3.1 概念（只保留 5 个）

| 概念 | 含义 |
|---|---|
| **Room** | 一个群 / 频道，绑定一组成员 |
| **Member** | 一个 Bot Endpoint + 一个 Agent 定义 + 一个角色（role）。每个成员用自己的 Bot 账号在群里发言 |
| **Role** | 角色说明（prompt）、工具集、可以接哪类任务、可以把任务交给谁 |
| **Task** | 群里可见的工作项：谁负责、状态、结果 |
| **Handoff** | 一个成员把任务 / 问题交给另一个成员，并在群里可见 |

现有 `WorkroomDefinition`（`workroom/catalog-definition.ts`）的结构已经接近这个模型：`members[].agent`、`role`、`messageRoute`（每个成员独立的 Bot Endpoint）、`conversation`（群绑定）。**定义层可以保留并简化。**

### 3.2 消息怎么流

```
人类在群里发言
  └─> Room Router（同进程）
        ├─ @了某个成员 / 回复某个成员 → 交给该成员
        └─ 否则 → 交给 coordinator 角色（可配置；没有就按 role 匹配）
成员 Agent 跑一个 turn
  ├─ 在群里回复（走正常的 Adapter.sendMessage 发送链，用自己的 Bot 账号）
  └─ 调用 handoff / task 工具
        └─> Room Bus（同进程事件）
              ├─ 在群里投影一条可见消息，例如“@reviewer 请审一下 #3”
              └─ 唤醒目标成员的 turn
```

**Router 入口是去重的**：同一条人类群消息会到达 N 个成员 Endpoint；仅对已确认属于某个启用 Room、且接收 Endpoint 是该 Room 成员的群会话（Room 成员端口 `hasRoom`），ingress 按 (adapter, conversation, sender, message id) 在 60 秒内只保留第一个到达的，其余只作为聊天记录保存，不再路由。没有平台消息 id 的消息、私聊和非 Room 群不去重（非 Room 群在 B2b Router 上线前保持每个 Endpoint 各自处理：@ 判定与 interaction/prompt 都相对接收 Endpoint，全局去重会让被 @ 的后到 Bot 永不回复）。胜出的 Endpoint 是任意的，所以 Router 必须根据消息内容和 Registry 决定 @ / 回复目标，不能依据“哪个 Endpoint 收到了它”（`mentioned` 是相对接收 Endpoint 而言的）。`hasRoom` 的实现必须与 B2b Room Router 一起上线，不得先于 Router 单独实现；Router 必须对所有成员 Endpoint（而不只是去重胜出的 Endpoint）解析 @ / 回复目标，以及待回答的 interaction / prompt（落败 Endpoint 只记录不路由，它上面挂起的 interaction / prompt 与 @ 只有 Router 才能代为解析）。

**Router 已实现（B2b）**：`RoomMembershipPort` 的 `hasRoom` 与可选的 `route` 成对提供（workroom 里只有 `createRoomMembershipPort` 这一个工厂，测试断言“有 `hasRoom` 就一定有 `route`”）。core 在去重位置用可信数据构造路由输入（`mentionTargets` 取自 mention segment，`replyToEndpointId` 取自出站 ledger，`pending` / `accountOf` / `isAvailable` 三个探针分别来自 interaction 状态、Peer Registry 的账号与就绪状态），调用同步、无副作用的 `route`，由 Router 决定目标 Endpoint：
- 优先级固定为 待回答 > @ > 回复 > coordinator > 按 role 匹配（无 coordinator，或 coordinator 不可用时）；多个 @ 取文中第一个被 @ 的成员（平台 mention segment 先于文本 `@别名`）；每一步都跳过不可用的 Endpoint，顺位降级，全都不可用时返回 `undefined`，回退到先到先得去重。
  - 只 @ 了非成员账号（mention segment 指向的账号都不属于成员，且无文本 `@别名` 命中；非成员账号也包括群内其他人类用户，人类 @ 人类时 coordinator 不插话）时没有目标：Router 返回 `undefined`，不交给 coordinator / role，退化为先到先得去重，成员副本保持原有 `mentioned` 语义，不强制 mentioned。已被 @ 的成员不可用时仍按原顺位降级。
- **决策按消息缓存**（同 平台+会话+发送者+消息 id，60 秒）：第一个到达的副本算一次 `route`，其余副本复用结果，否则先被消费掉待回答状态的 Endpoint 之后，另一个副本会重算出不同结果而双重处理。`route` 返回目标之外还带 `fallbackEndpointIds`（其余可用成员，按 generalist → chat/general → 声明顺序）。`route` 返回 `undefined` 或抛错（warn 日志）时退化为先到先得，不丢消息。
- **目标优先 + 宽限期接管**：core 无法预知哪些 Endpoint 会收到副本（例如 Telegram 开启 privacy mode 时，未 @ 的消息只投递给部分 Bot）。因此：目标 Endpoint 的副本立即处理，强制 `mentioned=true`（`mentioned` 相对接收 Endpoint，否则 AI ingress 不触发）；目标已到达后其余副本只记录，不路由，不 publish。非目标副本若先于目标到达，且本 Endpoint 在 `[目标, ...fallbackEndpointIds]` 中，则等待目标副本（宽限期默认 2 秒，等待期间持有 snapshot lease，此时尚未写入历史）；宽限期内目标没到，优先级最高的已到达成员副本接管（debug 日志 `room_target_missing_takeover`，同样强制 `mentioned=true`），其余等待者只记录。目标副本晚到则判 duplicate，只记录。`hasRoom` 按接收 Endpoint 的成员关系判定，只有成员 Endpoint 收到的副本才走 route / 去重；同群里的非成员 Bot 按普通群处理（处理自己的副本，不 claim、不仲裁、不强制 mentioned）。不在 `[目标, ...fallbackEndpointIds]` 中的成员副本（例如路由时尚未就绪的成员）作为最低优先级的接管候选，同样等待宽限期；若它接管成功，打 warn 日志 `room_unlisted_member_takeover`（另有 debug `room_target_missing_takeover`）。结果：只要至少一个成员 Endpoint 收到副本，这条 keyed 的 Room 人类消息就恰好被处理一次；代价是目标没收到副本时有一个宽限期的延迟。
- **平台按钮回调绕过 Room 路由**：带 action 段的入站（如 Telegram `callback_query` 被 adapter 转成带 action 段的群消息）只投递给发出键盘的那个 Bot，只有它的 Endpoint 持有该键盘的 JSX registry / fallback。这类入站视为发给接收它的 Endpoint：不 route、不去重（不 claim、不缓存、不强制 mentioned），永远由接收它的 Endpoint 处理。action 段只由 adapter 从平台回调结构生成，普通文本消息无法携带。bot 来源（member / peer_bot）照旧只记录。
- **unkeyed 保持逐 Endpoint 处理**：没有消息 id、没有发送者或私聊的消息无法仲裁，不 route、不丢弃，每个 Endpoint 各自处理自己的副本（已知限制：可能重复处理，但不丢消息）。
- **待回答仅内容相关**：`pending(endpointId)` 只在“本条消息能解析到该 Endpoint 的某个按钮（action 段且 payload 属于该会话存活键盘，或标签 / 序号文本命中），或该发送者在该 Endpoint 上有待回答的 claim”时为 true；仅仅“发过键盘”不会让所有人类消息被它截走。探针对 AdapterIndex 不认识的 Endpoint 返回 false，不会让整条消息 fail closed。
- 已知限制：`inboundClaim` 这类进程级 prompt 需要宿主通过 `ImRuntimeOptions.inboundClaimPending(conversation, senderId)` 告诉 core 哪个 Endpoint 上有待回答项；仓库内目前没有生产实现，缺省按 false（即这类 prompt 不参与 Room 路由，只在被选中的目标 Endpoint 上被 `inboundClaim` 看到）。
- 文本 `@别名` 需要别名后面有分隔符（空格或标点），边界按 Unicode 判断：`@研究` 不匹配 `@研究员`，但 CJK 无空格连写（`@研究员帮我`）也不匹配；可靠路径是平台 mention segment。

关键设计点：**群消息是展示，同进程 Room Bus 才是传输**。原因：

- Telegram Bot 永远收不到其他 Bot 的消息（平台限制，不是默认配置可改）；其他平台多数也收不到或不可靠。依赖“Bot 读 Bot 的群消息”来协作不可靠。
- 所有成员在同一个 zhin 进程内，直接走进程内事件更可靠，也方便做循环保护。
- 人看到的群聊记录和实际发生的交接一一对应，可追溯。

这和原决策地图“IM 不是协作协议”在**传输**上一致，区别在于：协作要**完整地发生在群里、被人看到**，人也能直接参与。

### 3.3 必须有的护栏

- **防循环**：每个 Room 有 handoff 深度上限和每分钟 turn 上限；同一任务在两个成员之间来回超过 N 次，就停下来 @ 人类。
- **发言串行**：同一 Room 内一次只跑一个成员的 turn（或按任务串行），避免多个 bot 抢话。
- **角色权限**：Role 声明的工具集就是这个成员的上限，复用现有 security policy，不另起一套。
- **人类优先**：人类可以打断和取消，但按 §3.7.5 授权：打断当前 turn 只限发起人或 master（与 #725 一致）；取消 Task 只限 Task 创建者、成员 Endpoint 的 master 和配置的人类账号。

### 3.4 发言者身份判定（防止把 Bot 当真人）

前提：成员 Bot 往往是普通个人账号（例如 QQ 协议号），平台不会标记“这是机器人”。成员之间**能**看到彼此的群消息。如果不处理，A 的发言会被 B 当成人类请求再执行一遍，形成循环，或者被冒充越权。

原则：**身份由入站时的可信元数据决定，绝不由消息正文或模型判断决定。** 分三层：

1. **身份层（决定性判断）**：建一个进程级的 **Peer Registry**，记录本进程所有 Endpoint 登录后的平台账号 id，外加配置里声明的外部 Bot 账号。每条群消息在进入 Agent 之前，由 ingress 打上 `origin` 标签：

   | origin | 含义 | 处理 |
   |---|---|---|
   | `self` | 本 Bot 自己发的 | 丢弃 |
   | `member` | 同一 Room 的其他成员 Bot | **不进入人类入口**；成员间协作只走 Room Bus，这条群消息只作为聊天记录保存 |
   | `peer_bot` | 本进程的其他 Bot，或配置声明的外部 Bot | 不触发任何 turn，只记录 |
   | `human` | 以上都不是 | 正常路由 |

   这里需要每个 Endpoint 暴露自己的平台账号 id。目前 `EndpointIdentity`（`packages/im/adapter/src/endpoint-contract.ts`）只有配置层的 id，需要补一个登录后上报的 `selfUserId`。Registry 还没就绪的 Endpoint，它所在的 Room 不开始协作（fail closed）。

2. **关联层（兜底）**：Room 发出的每条消息都记进 outbound ledger（平台返回的 message id，加上内容摘要和时间）。入站消息如果命中 ledger，就判为 `member` 或 `self`。这一层用来覆盖账号 id 对不上的情况，例如同一账号多端登录、平台回显的 id 格式不同。

3. **上下文层**：Agent 看到的历史里，每条消息的发言人标签由 `origin` 生成，例如 `[human:张三]`、`[member:researcher]`。现有的 `[sender:...]` 标签（`packages/im/ai/src/memory/user-message-presentation.ts`）可以扩展这个字段。正文里写“我是真人”“我是管理员”一律无效。另外，`stripUserSpoofedSenderPrefix`（`packages/im/core/src/built/roles.ts`）目前只剥离**开头**的伪造前缀，需要改为对正文中所有类似标签做转义。

入站去重发生在 origin 判定之后，只作用于 `human`：同一条人类消息在其他成员 Endpoint 上的重复投递只记录、不路由，也不推送到控制台消息流。去重判定出错时 fail closed（仅记录、不路由，打 warn 日志，并照常推送到控制台消息流以便运维发现；只有确认的重复才不推送）。语义是“不重复路由”，该条消息本身不会被任何 Endpoint 处理，但不会静默消失；私聊中的平台消息 id 可能是账号级的，不跨 Endpoint 信任。同 §3.2：`hasRoom` 必须与 B2b Room Router 一起上线，Router 要覆盖所有成员 Endpoint 的 @ / 回复 / interaction / prompt，这是 B2b 的不变量（B2b 已实现：有 `route` 时，落败 Endpoint 上待回答的 interaction 由 Router 路由到持有它的 Endpoint 并被消费；只实现 `hasRoom` 而没有 `route` 时仍是 B2 的先到先得，落败 Endpoint 上的状态不会被消费，测试固定了这一回退行为）。

剩下的风险是**不在 Registry 里的外部 Bot**（别人拉进群的机器人）会被当成人类。缓解办法：

- 配置里可以声明外部 Bot 账号；
- 默认防循环护栏（§3.3）仍然生效；
- 敏感操作（取消任务、改角色）只接受配置里列出的人类账号。

### 3.5 状态

Task 状态用小型事件溯源：`created → assigned → in_progress → done / blocked / cancelled`，外加 `handoff` 事件。现有 `workroom/kernel-state.ts` 的 `decide / evolve / replay` 模式可以借用，但状态机要大幅缩小（去掉 lease、preempt、acceptance revision、scheduler clock）。

持久化复用 `@zhin.js/database`，一个 Room 一条事件流就够了。

**B3 已实现**（`packages/im/workroom/src/room/room-task*.ts`、`database-room-task-journal.ts`，与旧 Workroom 并存，未接入运行时）：

- 状态 6 个：`created / assigned / in_progress / done / blocked / cancelled`，`done`、`cancelled` 为终态；没有 lease、preempt、acceptance revision、scheduler clock。
- 转移：`assign` 可用于 created / assigned / blocked（in_progress 必须先 block 或走 handoff）；`start` 仅 assigned / blocked 且为当前 assignee；`block`、`complete` 仅 in_progress 且为 assignee（reason / result 必填）；`cancel` 任何非终态、不限 actor；终态后任何命令都显式报错。
- `assign` 对 assigned / blocked 的 Task 是仅 lead 可用的重新指派：`authorize` 必须限制；指派给当前负责人会被拒绝。
- `handoff`：仅 assigned / in_progress / blocked，由当前 assignee 发起，`to !== from`；evolve 后 assignee 变为 `to`，状态**回到 assigned**（原 in_progress 的任务由新负责人重新 start），`handoffCount + 1`。
- 命令带 `commandId` 幂等键；同 id 同内容重放不产生新事件，同 id 不同内容报冲突。replay 重新校验每条事件的转移合法性，任何违例 fail closed。
- 一个 Room 一条事件流（sequence 从 0 连续，CAS 追加）；DB 表 `room_task_events`（行含 canonical JSON、event digest 与 row binding digest，损坏行读写都拒绝）。表尚未并入 `defineWorkroomDatabaseModels`，由 C1 接线。
- 成员是否在 Room 内、`role.handoffTo` 是否允许等授权不在状态机内，由调用方通过 `authorize` 钩子（C1 工具层 / Bus）负责；B3 也不接 RoomBus、不投影群消息，handoff 的群内可见投影仍由 room-bus 负责，C1 再组合。
- RoomTaskService 的订阅者在 Room 串行区之外被派发，可能交错；订阅者须按 event.sequence 排序或去重（可复用 createRoomEventSequencer）。

### 3.6 与 Generation Projection 里程碑的关系

下一阶段是 Generation Projection → Tool Runtime → 可持久化 Journal 里程碑。新模型应该直接搭在上面：

- 成员的 turn 就是一个 generation。取消任务等于取消该 generation，工具调用会一起取消。
- handoff / task 工具是普通的 Tool Runtime 工具，不需要 Workroom 专用的执行通道。
- Room 事件流就是那个可持久化 Journal 的一个消费者，不再单独实现 `workroom/journal/`、`portfolio-journal`。

**建议顺序**：先做拆包（不依赖里程碑），再按里程碑推进；新 Room 核心最后搭在 Tool Runtime 上。

### 3.7 `room` 执行模式契约（2026-10-15 维护者确认 C1 选项 C；同日按维护者审查修订）

成员的 turn 用 agent 包里新增的 `room` 执行模式运行。agent 包只定义纯数据类型，不 import `@zhin.js/workroom`，A5 的边界规则不变。本契约必须与 main 上已合并的 harness 机制对齐，**不另起平行机制**：信任分级（#726，`security/trust-level.ts`）、同会话 admission（#725，`turn/turn-admission-gate.ts`）、记忆写入策略（#733，`memory/memory-write-policy.ts`）、后台任务与 `/tasks`（#731 / #732，`detached-task/`）、TurnTrace（#722 / #728）、评测框架（#720 / #758，`packages/im/agent/evals/`）。

**发版约束**：所有 changeset 只用 **patch**，包括 `@zhin.js/agent` 与 `@zhin.js/tool` 的公开类型新增，不破例。

#### 3.7.1 触发范围（D1）

所有成员 turn 都走 `room` 模式：人类 @ 或回复成员触发的 turn，以及 handoff / assign 唤醒的 turn。两种入口用同一套工具与权限规则。

#### 3.7.2 类型

`TurnExecutionProfile` 新增：

```ts
| Readonly<{
    kind: 'room';
    roomId: string; taskId: string; memberId: string; role: string;
    trigger:
      | { kind: 'human_message' }
      | { kind: 'handoff'; fromMemberId: string; eventSequence: number; causeTurnId: string }
      | { kind: 'assign'; by: string; eventSequence: number; causeTurnId?: string };
    brief: string; // 任务标题 + 最近的交接说明，作为 prompt 段注入
  }>
```

`@zhin.js/tool` 的 `ToolInvocationOrigin` 新增 `{ kind: 'room'; roomId; taskId; memberId }`。

#### 3.7.3 信任与权限（修订：防止 handoff 放大权限）

问题：`resolveTurnTrustLevel` 把所有非 IM 来源映射为 `trusted_member`。如果 `room` 来源直接走这个分支，群成员创建的 Task 交接到下一个 bot 时，权限会被放大。

规则：
- `resolveTurnTrustLevel` 为 `origin.kind === 'room'` 增加**显式分支**，不走“非 IM 即 trusted_member”的默认分支：
  - 人类消息触发：按该人类的 roles 定级，与 IM 完全一致。
  - handoff / assign 唤醒：按 **Task 创建者在创建时冻结的角色快照**定级。快照里有 `master` 才是 `owner`，有 `trusted` 才是 `trusted_member`，**其余一律（包括快照缺失）为 `group_member`**。
- policy = 角色声明的工具与安全上限 ∩ `narrowPolicyForTrust(…, level)`。沿着 handoff 链只能缩小，不能扩大。
- 其他 bot 发的群消息（origin 为 `member` / `peer_bot`）以及 handoff 的交接说明，如果要进入 prompt，一律用 `renderExternalContent` 渲染为 `external_content`，不能发起 turn，也不能提升权限。
- 唤醒 turn 的 principal 是合成入口，不设 `origin`。`subjectId` 为 `room:<roomId>/member:<memberId>`，**不冒用 Task 创建者的身份**；创建者只作为 `onBehalfOf` 记录在 trace 和 Room 事件里。
- `unattended: false`。回复端口用该成员自己的 Endpoint 在群里发言，走正常发送链。

#### 3.7.4 审批（D3）

- 审批人**只能**是这个成员 Endpoint 的 master，即 `endpointRoles.resolveOwner(adapter, endpoint)` 解析出的账号。全局 `ai.trigger.masters` 不算审批人。
- 审批请求在群里 @ 这个 master，只接受它的回复。
- master 未配置、不在该群、或者无法确认（拿不到群成员列表或查询失败）时，一律不提供审批端口。需要审批的工具直接拒绝，返回 `approval required but ApprovalPort unavailable`（fail closed）。

#### 3.7.5 排队、打断与取消（修订：与 #725 对齐）

- **只有一层排队**：成员 turn 进入 main 的 `TurnAdmissionGate`，session key 用 `room:<roomId>`（一个 Room 一个 admission 会话），所以“每个 Room 同时只跑一个 turn”由 gate 保证。删除 Room 自己的串行队列，B4 中的串行护栏改为断言 gate 已生效，不再自己排队。每个成员在每个 Task 上的对话上下文仍然各自独立，存放在 `room:<roomId>:task:<taskId>:member:<memberId>` 下；这个 key 只用于上下文存储，**不参与 admission**。
- **打断规则照搬 #725**：只有当前 turn 的发起人或 master 能打断或叫停，其他人的消息按 FIFO 排队。唤醒 turn 的发起人是合成 principal，因此只有 master 能打断。
- **取消 Task 不同于打断 turn**：取消 Room Task（并 abort 它正在运行的 turn）只允许 Task 创建者、成员 Endpoint 的 master、以及配置里列出的人类账号。原方案 §3.3 的“任何人都能取消”作废。
- **清空排队**：清空一个 Room 的排队只有 master 能做，其他人只能撤回自己排队中的消息（与 gate 现有语义一致）。
- 取消通过 `signal` 传到正在执行的工具调用。

#### 3.7.6 记忆（修订：归属与回忆开销）

- **人类消息触发的 turn**：照常按 #733 归属给这个人类，使用这个人类的信任级别。
- **唤醒 turn**：写入的 trust level 用 3.7.3 定出的级别（默认 `group_member`），归属为 `room:<roomId>/member:<memberId>`，并记录 `onBehalfOf = Task 创建者`。**不写入 Task 创建者的 `user` 范围**，只允许写 `session` 范围或绑定 `taskId` 的 `task_state`，Task 结束后过期。
- **回忆开销**：唤醒 turn 默认只回忆当前 Task 的 `task_state` 和 Room 会话范围的条目，并单独设置预算（默认 150 token，可配置，0 表示关闭），不再在每一跳都带上完整的用户回忆（约 400 token）。

#### 3.7.7 Room Task 与后台任务 / `/tasks` 的关系（修订：先定边界）

- Room Task 是**群内协作工作项**，状态唯一来源是 `room_task_events`。成员 turn 是普通前台 turn，**不是** detached task。
- C1 范围内，room turn 不创建 detached task。如果以后要让成员在后台长时间工作，创建的 detached task 必须带 `parent = { roomId, taskId }`，权限沿用 detached task 的冻结 policy 规则，并且不能高于 3.7.3 的级别。
- `/tasks` 仍然只列 detached task。在 Room 群里另外提供只读的 `/room tasks` 查看 Room Task；取消一律走 3.7.5 的授权规则。两套任务不互相投影状态。

#### 3.7.8 Room 工具

- 放在 workroom 插件的 `tools/*.ts` 中，只在 `execution.kind === 'room'` 时出现：`room_handoff` / `room_block` / `room_complete` / `room_assign`（只有 lead 能用）。
- 授权复用 `createRoomRoleAuthorizer` / `createRoomRoleAssignAuthorizer`。
- 幂等键 `commandId = <turnId>:<toolUseId>`，turn 重放时不会重复写事件。
- `room_task_events` 并入 `defineWorkroomDatabaseModels`。

#### 3.7.9 Journal 与 Trace（D2；修订：能看到整条链）

- `room_task_events` 仍是 Task 状态的唯一来源，turn journal 照常记录工具调用。两边用 `turnId` / `commandId` 互相引用，不合并成同一张表。这一点偏离了 §3.6，留到 Journal 持久化里程碑完成后再收敛。
- TurnTrace 增加 room 字段：`roomId`、`taskId`、`memberId`、`trigger`、`causeTurnId`、`onBehalfOf`、信任级别。`zhin trace` 与 Console trace 页面支持 `--room <roomId> --task <taskId>`，按 `causeTurnId` 把一条 handoff 链上的所有 turn 串成一棵树显示。

#### 3.7.10 重启与宽限期（修订：#742 未覆盖的窗口）

问题：非目标副本在 2 秒宽限期内等待目标副本时，消息还没写入历史。此时进程重启，这条人类消息既没有被处理，也没有被记录。

规则：
- 关停开始时，所有处于宽限期的等待者立即结算：如果运行时还接受 turn，由已到达副本中优先级最高的一个立即接管；否则把消息写入聊天记录，标记为 `interrupted_by_stop`，打 warn 日志，并推送到控制台消息流。**不静默丢弃**。
- 重启后不自动重放这些消息（避免重复回复），由 trace 和控制台暴露给运维。

## 4. 现有模块去留（建议，待确认）

| 模块 | 建议 | 理由 |
|---|---|---|
| `catalog-definition`、`catalog`、`validate-catalog` | **保留并简化** | 就是 Room / Member 定义 |
| `interaction-space-router`、`interaction-space-binding-*` | **保留并简化** | 群绑定与路由 |
| `kernel-state`（decide / evolve / replay） | **保留模式，重写状态机** | 状态机要缩小一个数量级 |
| `role-capability-snapshot`、`profile-compiler` | 简化为 Role 的工具集声明 | |
| `human-ingress*`（约 2,000 行） | 简化为 Room Router | 意图分类（discussion / work_request / control）可以保留为轻量规则 |
| `workroom-kernel.ts`（1,857 行） | 拆解后基本删除 | 主要是 plan admission、scheduler commit、remote issuance |
| `remote-dispatch-*`、`remote-callback-*`、`remote-assignment-*`（约 4,500 行） | **移出主路径**，以后作为 A2A 扩展 | 同进程多 Bot 用不到 |
| `portfolio/`、`workroom-portfolio-*`、`workroom-scheduler-*`、`workroom-preemption*` | **移出 / 删除** | 跨项目容量与抢占，目标用不到 |
| `acceptance-*`、`workroom-risk-acceptance-*`、`workroom-acceptance-*`（约 5,000 行） | 简化为可选的 reviewer 角色 | “审核”就是一个 reviewer 成员，不需要独立的验收引擎 |
| `data-governance/`、`workroom-data-*`、`workroom-payload-*` | **移出主路径**，作为可选插件 | 加密 vault 与披露授权和目标无关 |
| `legacy-*-migration`、`agent-legacy-payloads` 命令 | **删除** | 旧格式迁移；确认无线上数据后删除 |
| `overlay-pack-promotion*`、`github-*`、`self-delivery-*` | **移出**到自交付相关插件 | 这是 zhin 自己的 GitHub 自交付场景，不是通用 Workroom |
| `plugin-runtime/` 中的通用文件（turn engine、capability ingress、native tools） | **移入 Agent 核心** | 本来就不属于 Workroom |

“删除”的前提是确认没有线上数据、没有外部用户依赖。这一点需要你来确认。

## 5. 分阶段计划

每一步都是一个独立 PR，都必须通过 `pnpm check:all`。

### 阶段 A：拆包，不改行为

1. **A1 分离 `plugin-runtime/`**：`workroom-*` 文件移到 `agent/src/workroom-runtime/`，通用文件留在 `plugin-runtime/`。`@zhin.js/agent/runtime` 的导出保持不变，外部 68 个文件不用改。
2. **A2 修 6 处反向依赖**（A2a 已完成，仅剩 `deferred-capability-plan`，由 A2c 处理）：DB model 注册改为由 Workroom 自己注册；`validateWorkroomDefinitions` 和 `workroom-bot-identity` 移走。
3. **A3 断开 `data-governance ↔ workroom` 循环**：抽出两边共享的类型到一个 contract 文件，方向固定为 workroom → data-governance。
4. **A4 新建 `packages/im/workroom`（`@zhin.js/workroom`）**：把 workroom、portfolio、data-governance 整体搬过去。agent 不再依赖它，CLI 改为可选加载。
5. **A5 加架构检查**：`check:architecture` 增加规则 `@zhin.js/agent` 禁止导入 `@zhin.js/workroom`。CLI 测试改为通过公开接口测试。

阶段 A 结束后：agent 包约 4.3 万行，Workroom 成为可选包，行为完全不变。

### 阶段 B：新 Room 核心（在新包内）

1. **B1 定义与身份**：Room / Member / Role 定义与校验，从现有 catalog 简化而来；Endpoint 上报 `selfUserId`，建立 Peer Registry 和入站 `origin` 标签（§3.4）。
2. **B2 Room Router + Room Bus**：入站去重（已选定“按消息 id 去重、先到先得”，否决了“每个 Room 选举一个入站 Endpoint”，因为选举依赖 Room 成员状态）；人类消息路由、handoff 事件、群内可见投影（走正常发送链）。
3. **B3 Task 状态机**：小型事件溯源 + 持久化。
4. **B4 护栏**：防循环、发言串行、取消。
5. **B5 示例**：重写 `examples/multi-agent-room` 为“3 个 Bot（如 coordinator / researcher / writer）在一个群里协作”，作为端到端验收。

B 阶段与旧 Workroom 并存，通过配置选择。

### 阶段 C：切换与清理

1. 新 Room 搭到 Tool Runtime / Generation 上（跟随里程碑）。
2. 默认切到新 Room；旧机制按第 4 节的去留表，逐个移入可选插件或删除。
3. 更新 `docs/plans/agent-workroom-orchestration-decision-map.md`，把与新目标冲突的“已确认边界”标记为 Superseded，并补一份 ADR。

## 6. 已确认的决定（2026-10-13）

1. **没有线上数据。** 现有 Workroom Journal / Catalog / 加密 vault 都不需要迁移；legacy 迁移代码可以直接删，data-governance 移出主路径。
2. **首批平台是 QQ 个人号（ICQQ / OneBot）。** 成员 Bot 互相看得到消息，§3.4 的身份层必须先做。端到端验收先用 Sandbox 模拟多 Bot。
3. **coordinator 可选，reviewer 可选。** 有 coordinator 时，没有 @ 的人类消息交给它；没有时按角色匹配。reviewer 只是普通角色，不强制审核。
4. **不做 A2A 远程执行。** remote dispatch / callback / issuance 相关代码冻结，阶段 C 移出主路径。
5. 执行过程只在本地提交，不推送、不开 PR，由维护者审阅后再决定。

进度记录在 [workroom-group-collaboration-progress.md](./workroom-group-collaboration-progress.md)。
