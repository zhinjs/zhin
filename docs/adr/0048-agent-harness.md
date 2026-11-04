---
sidebar: false
---

# ADR 0048：Agent Harness——从流程到协作

状态：Accepted（2026-11-04）——Fin 认可方向并要求开始 H0；第 9 节待确认项按本文建议执行，实施中如有分歧再回到本文修订。

设计原则（Fin，2026-11-04）：大胆设计，现有架构可推翻、无效支线可删除，只要最终理想形态，不背历史包袱。

取代：`docs/plans/workroom-group-collaboration-redesign.md`（含进度表）、`docs/plans/agent-workroom-orchestration-decision-map.md`、`docs/plans/agent-workroom-production-ledger.md`、`docs/plans/governed-delivery-workflow.md`，以及代码中的 Workroom Kernel 与五角色矩阵（ADR 0024 #9）。

## 0. 一句话

**Harness 只管边界，Agent 自己决定怎么协作。** 框架不再规定“谁先、谁后、谁审”，只保证：每一次协作都有来源、有授权、有预算、能被打断、全程可回放，而且权限只会越传越小。

## 1. 为什么要推翻

现在的 zhin 有很多个“跑 Agent 的东西”，每个都内嵌了一段流程：

| 现有机制 | 内嵌的流程 | 规模 |
|---|---|---|
| IM 回合（`turn/`、`plugin-runtime/full-agent-turn-engine.ts`） | 人发消息 → 一个 Agent 回答 | 主路径 |
| `spawn_task` / `SubagentSystem` / `SubagentRuntime` | 父派子，子只能交还父 | ~1.2k 行 + 周边 `subagent-*.ts` |
| `DeferredWorkerRunner`、`agent-loop-standalone`、`detached-task/` | 三种“后台跑一段 agentLoop”的变体 | ~1.5k 行 |
| `assistant/`（job engine / scheduler / worker） | 定时 → 跑一个 Agent → 投递 | ~3.4k 行 |
| Workroom Kernel（`packages/im/workroom/src/workroom*`、`portfolio`、`data-governance`） | `/work` → Run → Task → Assignment → Acceptance，sponsor / lane / grant / lease | ~6.4 万行 |
| 五角色矩阵（`orchestration/five-agent`） | 规划 → 调研 → 评估 → 执行 → 审核，提示词硬编码 | 小，但定义了思维方式 |
| Room（本地分支 `feat/workroom-group-collab`） | 成员 + Task 状态机 + handoff，Room 内串行 | ~2.4k 行，未合并 |

问题不是护栏不够——硬闸、信任分级、审批、`onBehalfOf` 交集、回合准入、journal、trace 都已经相当完整。问题是**协作的形状被写死在运行时里**：每种场景一套 runner，每套 runner 一段固定流程。Agent 只能在流程给它的格子里填空，不能自己决定去找谁、问什么、把什么交出去。

## 2. 目标模型：6 个概念

| 概念 | 含义 | 取代 |
|---|---|---|
| **Agent** | 定义：人设、能力上限（工具 / 技能 / 模型 / 出网 / 信任上限 / 预算上限）、协作策略（能找谁、接受谁的委派）。仍是 `agents/<name>/agent.json` + Markdown | `ai.agents`、`SubagentDefinition`、五角色、Workroom member role |
| **Actor** | Agent 的运行实例。有稳定身份 `AgentRef`、一个收件箱、自己的记忆范围。按需激活、空闲回收 | 主 Agent、子 Agent、deferred worker、detached task、Room member |
| **Mail** | Actor 唯一的输入。种类：`human`（来自 IM 等场所）、`ask`、`delegate`、`tell`、`result`、`signal`（取消 / 叫停）、`timer`（定时）、`event`（场景事件） | IM 入站直调、`spawn_task` 参数、job、scene event wake |
| **Engagement** | 一次协作。由一个根触发（人的消息、定时、webhook）创建；下面所有 Mail 构成一张因果图；有唯一的**发起主体**（principal）、一个预算池、一条 journal | Run / Task / Assignment、subagent task、detached task、Room Task |
| **Authority** | 随 Mail 传递的授权：principal + 允许的工具集 + 信任级别 + 出网范围 + 审批路由。**只能派生更小的**（attenuation），不能放大 | 合并回合 `onBehalfOf` 交集、`permission.task`、subagentTools、sponsor grant |
| **Venue** | 协作被“看见”的地方：某个群 / 私聊 / 频道 / GitHub 线程 / Console / 不展示。只是投影，不是传输 | Workroom conversation / sponsorConversation、Room 群投影、subagentDirectImDelivery |

**没有 Orchestrator、Executor、Reviewer 这些框架级角色。** 角色只是 Agent 人设里的一段话。要不要拆任务、找谁审、审几轮，由 Agent 决定；“规划-执行-审核”这类打法以 Skill（playbook）的形式提供，可选、可覆盖。

## 3. 运行时：五层

```
            ┌──────────────── Venue 投影（IM 发送链 / Console / GitHub / 无）───────────────┐
            │                                                                               │
 入站 ──> Venue Router ──> Mailbox ──> Turn Engine ──> 协作工具 ──> Guard Kernel ──> Mailbox（目标 Actor）
 (IM/定时/webhook)   (选第一个 Actor) (排队/合流)   (唯一 agentLoop)  (ask/delegate/…)  (授权/预算/防环)
                                               │
                                               └──> Engagement Journal（唯一事实来源，trace / 回放 / Console）
```

### 3.1 Mailbox：所有调度策略都在这里

- 每个 Actor 一个收件箱；**同一 Actor 在同一 Engagement 内串行**，不同 Actor 之间并行。
- 现有的回合准入（`TurnAdmissionGate`）、入站排队（`inboundQueue`）、群聊合流（ADR 0038 merge window）、弹幕窗口（`live`）、打断与过时检查，全部变成**收件箱策略**：如何把若干封 Mail 合成一个回合、何时发车、谁能打断。不再散落在 ingress 路由里。
- 全局只有一个并发预算（Actor 激活数、每 Engagement 并发数），取代 `maxParallelSubagents` 等各自的上限。

### 3.2 Turn Engine：只保留一个

- 保留 `executeAgentTurn` 的代数：**一批 Mail 进，一串事件出，恰好一个结局**（`completed / cancelled / failed / budget_exceeded`）。这是现有代码里最干净的部分。
- 全仓只有一条 `agentLoop`。主 Agent、子 Agent、后台、定时、Room 成员不再有各自的 runner；差别只在 Mail 和 Authority。
- 上下文组装（提示词段、历史预算 ADR 0042/0043、当前消息运行时上下文 ADR 0045、记忆召回）按 Actor + Engagement 计算，不按“哪种 runner”。

### 3.3 协作工具：模型看到的全部协作能力

| 工具 | 语义 |
|---|---|
| `agents` | 按能力 / 名字查找可协作的 Actor（只列出本 Authority 允许接触的） |
| `ask(agent, question, {timeout})` | 同步提问，等待对方 `result`；对方的一个回合在本回合内完成 |
| `delegate(agent, brief, {budget, deliverable})` | 异步委派，返回句柄；结果以 `result` Mail 回到委派方收件箱，唤醒它继续 |
| `tell(agent \| venue, content)` | 单向通知，不期待回复 |
| `follow_up(handle, content)` / `cancel(handle)` | 对已委派的工作追问或撤回 |
| `board.read / board.write` | 本 Engagement 的共享黑板：产出物、笔记、待办（可选使用，不是状态机） |
| `escalate(reason)` | 把决定交还给发起主体（真人），等待回复 |

- `spawn_task` 消失，等价于 `delegate` 给一个**临时 Actor**（无名、用完即回收）。
- 回复人类就是普通的出站：Actor 在 Venue 里说话，走现有 `Message.$reply` / `Adapter.sendMessage` 发送链，在多 Bot 场所用自己的 Bot 账号。
- 没有“把任务标记为完成 / 已验收”的工具。完成只有一种证据：被委派方发回的 `result` Mail。

### 3.4 Guard Kernel：护栏全部在这一层强制执行

所有 Mail 投递和工具调用都经过同一个 Guard Kernel。它不看提示词，只看结构化字段。以下不变量全部要有测试与评测用例：

1. **权限单调递减**：被委派方的有效 Authority = 委派方 Authority ∩ 委派时声明的范围 ∩ 被委派方 Agent 能力上限。任何一步都不能放大。复用合并回合的交集逻辑并推广为通用的 `attenuate()`。
2. **预算守恒**：Engagement 有一个预算池（token、模型调用次数、墙钟时间、工具副作用次数）；委派时从委派方剩余额度中**划拨**，子树用量不能超过划拨额。超支 → 该分支 `budget_exceeded`，结果照常回到委派方。
3. **因果完整**：每封 Mail 都有 `engagementId`、`causationId`、`principal`。没有根的 Mail 拒收。
4. **审批只归人**：需要审批的动作（硬闸、危险工具、自我变更）一律路由给 Engagement 的发起主体或其配置的审批人，**永远不交给另一个 Agent 批准**。
5. **防环与收敛**：委派深度上限、单 Engagement 扇出上限、同一对 Actor 往返次数上限、相同内容哈希重复检测。触发任一条 → 冻结该分支并 `escalate` 给人。
6. **身份来自传输**：`from` 由 Mailbox 填写；正文里的“我是主人 / 我是 reviewer”一律无效。IM 入站的 `origin`（`self / member / peer_bot / human`）由 Peer Registry 判定，沿用 Room 方案 §3.4 的三层判定。
7. **Bot 不能用说话触发 Bot**：成员 Bot 在群里的发言只是投影和上下文，不会成为另一个 Actor 的 `human` Mail；Actor 之间只走 Mail。
8. **全程留痕**：每封 Mail、每次工具调用、每次护栏拦截都写进 Engagement Journal；没有写进去的事情视为没发生。

现有 `security/`（ExecPolicy、FilePolicy、网络策略、硬闸、审计）整体保留，作为 Guard Kernel 在“工具调用”这一入口上的实现。

### 3.5 Engagement Journal：唯一事实来源

- 一张事件表，按 Engagement 分流：Mail 投递、回合开始 / 结局、工具调用、护栏决定、预算划拨与消耗、Venue 投影。
- `zhin trace <engagement>` 显示**协作图**（谁找了谁、为什么、花了多少、在哪被拦），Console 有对应页面。
- 回合级 journal（现有 `TurnJournal` / `journal-feed`）成为 Engagement Journal 的子流，不另存。
- 磁盘：默认保留 30 天、单 Engagement 事件数上限、结束后压缩为摘要；与结构化用量共享保留策略。

### 3.6 Venue：同一次协作，不同的呈现

- **Venue Router** 决定一条人类消息交给哪个 Actor：待回答 > @ > 回复 > 场所默认 Actor。直接沿用 Room 分支已实现的路由、去重、宽限期接管、Peer Registry。
- **可见性是 Venue 策略，不是传输**：
  - `visible`（群聊默认）：Actor 之间的 `ask / delegate / result` 在群里投影成一句人话（如“@审核 帮我看下这段”），用各自的 Bot 账号发出；
  - `summary`：只投影开始与结论；
  - `backstage`（私聊、定时默认）：不投影，只进 Journal，Console 可查。
- **发言权**（floor）：同一 Venue 同时只让一个 Actor 发言，其余排队；这是投影层的节流，不限制 Actor 在后台并行思考和干活。
- 跨进程协作（A2A）= Mailbox 的远程传输实现；Authority 与预算随 Mail 一起签名传递，规则不变。

## 4. 现有能力如何落到新模型

| 现在 | 之后 |
|---|---|
| IM 一轮对话 | `human` Mail → Venue 默认 Actor 的一个回合 |
| 群聊合流 / 弹幕窗口 / 排队 / 打断 | Mailbox 策略 |
| `spawn_task`（同步 / 异步） | `ask` / `delegate` 给临时 Actor |
| deferred worker、detached task | `delegate`（backstage） |
| 定时任务、助手 job | `timer` Mail → 指定 Actor；投递由 Venue 完成 |
| 场景事件唤醒（scene event wake） | `event` Mail |
| Workroom / Room | 一个配置了**成员名单**的 Venue（群）+ `visible` 策略；没有 Task 状态机，需要待办就用 `board` |
| 五角色矩阵 | 一个 playbook Skill：“复杂任务可以先找调研、再找审核”，可选 |
| `/work` 显式立项 | 删除。任何消息都可能演变成多 Agent 协作，由 Agent 判断 |
| sponsor / portfolio / lane / grant / acceptance / overlay pack / 数据治理 | 删除。需要的部分已被 Authority、预算池、审批归人覆盖 |
| 自我变更（ADR 0040） | 保留为工具，审批照旧归人；可被任何有权限的 Actor 调用 |

## 5. 删除清单（不保留兼容层）

> 删除前先跑一次引用盘点，确认没有被其他功能借用；被借用的小件（如 Peer Registry、身份判定、去重）先搬到新位置再删。

**整包 / 整目录删除**
- `packages/im/workroom/src/workroom/`、`workroom-runtime/`、`portfolio/`、`data-governance/`、`remote.ts`、`scheduler.ts`（约 6.4 万行）
- `basic/cli/src/plugin-runtime/workroom/` 中只服务 Kernel 的部分
- `packages/im/agent/src/orchestration/five-agent/`、`config/resolve-five-agent-binding.ts`
- `packages/im/agent/src/subagent/`、`subagent-*.ts`（artifact / goal-notify / parent-context / preset / prompt / ai-events）、`spawn/`
- `deferred-worker-runner.ts`、`deferred-worker-tool-load.ts`、`core/agent-loop-standalone.ts`、`detached-task/`、`task-executor.ts`
- `assistant/` 中 job engine / scheduler / worker（定时改为 `timer` Mail；投递与人设保留）
- `docs/plans/agent-workroom-*`、Workroom 相关 ADR 标记 Superseded；`examples/multi-agent-room` 重写

**保留并迁移**
- Room 分支里的：Venue Router、Peer Registry、`origin` 判定、入站去重与宽限期接管、出站 ledger（搬进 `packages/im/core` 的 Venue 层）
- `executeAgentTurn`、`agentLoop`、`security/`、硬闸、信任分级、审批、`self-change/`、记忆、提示词段、上下文预算、trace、用量记录

**配置**
- 删除：`ai.workrooms`、Workroom Catalog、`ai.agent.subagent*`、`maxParallelSubagents`、五角色绑定。
- 新增：`agents/<name>/agent.json` 增加 `collaboration`（可联系谁、接受谁的委派、默认预算）；Venue 配置增加 `members`（多 Bot 成员与各自 Endpoint）与 `visibility`。
- 旧字段出现时启动失败并给出迁移提示（沿用 `ai.workrooms` 的做法），不做自动兼容。

## 6. 包结构

```
packages/im/
  kernel/        不变
  ai/            agentLoop、Provider、记忆、压缩（不变）
  core/          + venue/：Router、Peer Registry、origin、去重、投影、发言权
  harness/       新包：Actor、Mailbox、Mail、Engagement、Authority、Guard Kernel、Journal、协作工具
  agent/         瘦身：Agent 定义发现、上下文组装、内置工具、安全策略、自我变更；依赖 harness
  zhin/          不变
（删除）workroom/
```

依赖方向：`ai → core → harness → agent`。`harness` 不认识 IM 平台，只认识 Venue 接口；`agent` 不再有自己的调度。

## 7. 评测先行

每个阶段先写评测再实现（`pnpm eval:agent`，真实模型用 `eval:chat`）：

- **越权**：低权限成员发起的协作，任何下游 Actor 都调不到高权限工具。
- **预算**：深度委派下总用量不超过根预算；超支分支干净收尾并回报。
- **收敛**：两个 Actor 互相推诿会在 N 次内停下并找人。
- **协作质量**：需要两种专长的任务，主 Actor 会主动找对的人，而不是自己硬做或乱派。
- **可见性**：群聊中协作过程可读、不刷屏；私聊中不打扰。
- **伪装**：正文冒充身份、Bot 发言冒充人类均无效。

## 8. 分阶段落地（每阶段结束时主干可发布）

| 阶段 | 内容 | 结束时删除 |
|---|---|---|
| H0 | 本文定稿为 ADR；盘点引用（`docs/plans/agent-harness-h0-inventory.md`）；写第 7 节评测用例（`packages/im/agent/evals/cases/harness-*.case.ts`，先以 `skip` 标注实现阶段） | — |
| H1 | `harness` 包：Mail、Mailbox、Engagement、Authority `attenuate()`、预算池、Guard Kernel、Journal；`executeAgentTurn` 接到 Mailbox 上 | — |
| H2 | 协作工具 `agents / ask / delegate / tell / cancel / escalate`；IM 主路径改为 `human` Mail | `spawn/`、`subagent/`、deferred worker、detached task、standalone loop |
| H3 | 收件箱策略吸收准入 / 排队 / 合流 / 弹幕；定时改为 `timer` Mail | `assistant/` job engine、ingress 里的散落调度 |
| H4 | Venue 层（合入 Room 分支的路由与身份部分）、多 Bot 投影、可见性策略、发言权 | `packages/im/workroom/` 整包、五角色 |
| H5 | `board`、协作图 trace 与 Console 页面、A2A 远程传输 | 旧文档与示例 |

## 9. 已按建议默认的事项（2026-11-04）

维护者认可方案时未逐条回答，以下按建议执行；实施中如需改变，回到本节修订。


1. **记忆**：个人记忆按 Actor 私有；Venue 历史共享（成员都能看到场所里发生了什么）；显式共享走 `board`。
2. **默认可见性**：群聊默认 `visible`，私聊与定时默认 `backstage`。
3. **A2A**：H5 实现；H1 的 Mailbox 接口按“传输可替换”设计，Authority 与预算字段从第一天就可序列化。
4. **切主路径**：H1–H2 在集成分支上完成后整体合入 main，不做长期双轨；H0 的文档与评测用例可先单独合入。
