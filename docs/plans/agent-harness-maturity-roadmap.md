---
sidebar: false
---

# Agent Harness 成熟度补齐路线图

> 状态：已立项 · 2026-10-14 · 跟踪 Epic：#736 · 范围：plugin-runtime 回合路径（IM/QQ），即 `FullAgentTurnEngine`；旧的 `ZhinAgent` 路径不在范围内

## 0. 原则

1. **先评测和可观测，再加功能。** 后面每项改进都要用评测集证明“变好了”，用 trace 证明“为什么好”。今天在 QQ 上撞出来的每个问题，都要先变成一条评测用例，再去修。
2. **复用已有的底座，不新建平行体系。** 仓库里已经有 compaction、trace、渐进披露、三层记忆，但大多没有接进 plugin-runtime 路径，或者没有对外暴露。缺口主要在“接线”和“闭环”。
3. **每个里程碑都能单独合并。** 默认关闭（像 `subagentTurnMode: off` 那样），用配置打开，有评测指标兜底。

## 1. 现状盘点（基于代码）

| 维度 | 已有底座 | 缺口 |
|---|---|---|
| 评测 | `tests/platform-acceptance`（故障代理、探针）、各包的单元测试 | 没有“任务 → 期望行为”的 agent 级回归集，也没有打分和基线 |
| 可观测 | `plugin-runtime/agent-trace-runtime.ts`（只有测试和 host-port 在用）、`journal/persistent-turn-journal.ts`、TurnEvent 流 | trace 没有落盘到统一的按回合视图，Console 里看不到；排查要手翻 `bot.db` 和 journal |
| 上下文 | `memory/compaction-runtime.ts`、`ai/compaction/*`、`skill/progressive-disclosure.ts`（只有 deferred plan 在用）、`PromptAssemblyRegistry` | 每轮约 35k token 的固定开销没有拆账；工具和技能描述是全量注入；plugin-runtime 路径是否触发压缩没有验证；也不记得哪些信息已经告诉过用户 |
| 记忆 | `memory-layers.ts`（全局/平台/会话/每日，四层 Markdown，按字符预算截断）、`native-semantic-memory-tools.ts` | 不能检索（全量拼接），不会过期，不区分“用户事实”和“任务临时状态”，写入没有来源和置信度 |
| 长任务 | #718：同步子 agent、按进展延长预算、自动续跑 | 任务活不过本轮：没有后台执行、断点恢复、主动汇报进度，也不能中途插话、改向或叫停 |
| 防注入 | `untrusted_conversation_event`：背景事件按数据渲染 | 只有这一层；工具输出、网页、文件内容和群成员消息的信任级别没有分级，也没有“高危动作需要可信发起人”这条约束 |

## 2. 阶段与顺序

```
P0 评测底座 ──┬─> P1 可观测 ──┬─> P2 上下文瘦身 ──> P4 记忆分层
              │               └─> P3 防注入
              └────────────────────> P5 长任务（接 #718）
```

建议顺序是 **P0 → P1 → P3 → P2 → P5 → P4**。实际排期以第 3 节状态表为准：群聊临时收紧（#719）最先；P1 的最小切片（TurnTrace 加 `zhin trace last`，#722）和 P0 一起或紧随其后；Provider 韧性（#724）和普通回合并发（#725）放在 P3 之前。P3 的风险最高，而且只要群聊开放，风险就在线上；P4 依赖 P2 的预算框架。

---

### P0 · Agent 评测集（最大差距，最先做）

**目标：** 能在 CI 里跑一组固定的 agent 任务，重复跑结果稳定，还能和基线比较。

- **M0.1 脚本化模型评测框架**（#720）：新建 `packages/im/agent/evals/`。
  - 每条用例都是一个 YAML/TS fixture，包含：
    - 入站消息序列：群聊或私聊、发送者角色、背景事件；
    - 可用工具，以及 mock 的工具返回；
    - 断言：调用了或没调用哪些工具、出站文本里包含或不包含什么、是否请求审批、回合终止类型。
  - 驱动方式：直接构造 `TurnIngress` 跑 `FullAgentTurnEngine`。PR 门禁使用**按步骤脚本化的 fake 模型**测试 harness 行为，不使用请求哈希录制回放；真模型评测放在 nightly（M0.3），用语义断言加可选的 LLM judge。
- **M0.2 种子用例**：把最近在 QQ 上撞到的问题全部转成用例，至少 20 条。按标签分组：`long-task` / `context` / `memory` / `injection` / `tool-use` / `approval`。
- **M0.3 真模型 nightly**：同一套用例用真实 provider 跑，比如 minimax 预设或 Claude。
  - 每条用例跑 N 次，统计通过率、平均 token 和平均工具调用数。
  - 结果写成 JSON 报告，和上一次结果做 diff。
  - 不放进 PR 必过项，只作为趋势指标。
- **M0.4 流程约束**：在 `docs/contributing/development.md` 里加一条规则：修 agent 行为 bug 的 PR 必须附带一条评测用例。可以加一个 `check:agent-eval-coverage` 做软检查。

**验收：** `pnpm eval:agent` 本地 1 分钟内跑完脚本化评测集；CI 跑脚本化评测集；nightly 能产出趋势报告。

---

### P1 · 回合级可观测

**目标：** 出问题时，打开 Console 的一个页面，就能看到这一轮按时间排列的完整过程：调用了哪些工具、每一步花了多少 token 和时间、在哪一步失败。

- **M1.1 统一 Turn Trace 模型**：基于 `agent-trace-runtime.ts` 和 TurnEvent 定义 `TurnTrace`。
  - 字段：`turnId`、`sessionKey`、`principal`、prompt 分段 token 拆账、每次模型调用的输入/输出/缓存 token、每次工具调用的参数摘要/耗时/结果大小/错误、审批事件、终止原因。
  - 子 agent 用 `<parent>:subagent:<n>` 嵌套挂在父 trace 下。
- **M1.2 落盘**：复用 journal store，独立建表或建目录，带保留期（默认 7 天）和大小上限。敏感字段走 `data-governance` 的脱敏规则。
- **M1.3 Console 页面**：会话列表 → 回合列表 → 回合详情（瀑布图加原始消息）。由 `host-api` 提供只读接口。
- **M1.4 CLI**：`zhin trace <turnId|last>` 在终端里直接打印，方便排查线上问题。
- **M1.5 评测联动**：P0 的评测报告附带每条用例的 trace，失败时可以直接点进去看。

**验收：** 把今天那类问题重演一遍，排查时完全不用打开 `bot.db`。

---

### P2 · 上下文瘦身

**目标：** 固定开销从约 35k 降到 15k 以下，同时 P0 的评测通过率不下降。

- **M2.1 先量化**：用 P1 的 prompt 分段拆账，出一份清单，列出 system、工具 schema、技能目录、记忆、bootstrap 各占多少。没有这份数据，先不动手优化。
- **M2.2 工具按需加载**：常驻工具只保留一个小核心集（回复、bash/文件、记忆、搜索工具）。其余工具只暴露名称和一行描述，通过 `tool_search` / `load_tools` 拿到完整 schema，做法类似 Claude Code 的 deferred tools。复用 `deferred-capability-plan.ts`。
- **M2.3 技能渐进披露接入主路径**：`progressive-disclosure.ts` 接进 `FullAgentTurnEngine`。默认只注入技能名称和触发描述，正文在激活后注入。
- **M2.4 长对话自动压缩**：确认 `compaction-runtime` 在 plugin-runtime 会话上按阈值触发，比如窗口用到 70%。压缩摘要要保留：未完成事项、用户偏好、**已告知用户的结论**。
- **M2.5 “已告知”账本**：每轮从出站消息里抽取结论或承诺（规则先行，以后可以换成小模型），写进会话状态。下一轮作为短块注入，避免重复告知或前后矛盾。
- **M2.6 Prompt cache 友好**：稳定段放前面、易变段放后面，用 P1 观测缓存命中率。

**验收：** 固定开销降到 15k 以下；`context` 标签用例全部通过；P1 显示的缓存命中率提升。

---

### P3 · 防提示注入（群聊开放就是线上风险，优先级前移）

**目标：** 群里的任何人、任何工具输出，都不能让 agent 越权执行动作。

- **M3.1 信任分级**：给每段输入打来源标签，分四级：
  - `owner`：主人私聊；
  - `trusted_member`：配置的白名单；
  - `group_member`：群成员；
  - `external_content`：工具输出、网页、文件、转发消息。

  渲染时统一包成带来源的数据块，扩展现有的 `untrusted_conversation_event`。
- **M3.2 能力和发起人绑定**：一轮的权限取“回合发起人的信任级别”和“配置策略”的交集，延续 #718 `deriveSubagentPolicy` 的思路。
  - `group_member` 发起的回合默认不带 shell、文件写入和外发。
  - 工具输出里的指令永远不会提升权限。
- **M3.3 高危动作二次确认**：外发消息给第三方、执行 shell、改配置、调度定时任务这几类动作，如果触发链里有 `external_content`，就强制走 ApprovalPort，并在审批卡片上显示来源链。
- **M3.4 输出侧检查**：出站前检测是否泄露 system prompt、密钥、其他会话的记忆，作为 outbound middleware 接入，不绕开发送链。
- **M3.5 注入评测集**：在 P0 里加入 `injection` 标签用例，至少 15 条。覆盖：群成员冒充主人、网页里的隐藏指令、工具结果里的“忽略之前指令”、通过记忆写入的持久化注入。

**验收：** 注入用例 100% 通过；trace 中每个高危工具调用都能追溯到发起人和信任级别。

---

### P4 · 记忆分层

**目标：** 记忆分层、能检索、会过期，并且区分事实和临时状态。

- **M4.1 数据模型**：从 Markdown 迁到结构化存储，Markdown 保留为可读导出。每条记录包含：
  - `scope`：user / group / platform / global；
  - `kind`：`user_fact` / `preference` / `task_state` / `episodic`；
  - `source`：来源回合和信任级别；
  - `confidence`、`createdAt`、`expiresAt`、`lastUsedAt`。
- **M4.2 写入策略**：
  - `task_state` 绑定任务，任务结束或 TTL 到期后自动失效；
  - `user_fact` 只从可信来源写入（和 P3 联动，防止持久化注入），冲突时以新的为准，并保留历史。
- **M4.3 检索替代全量拼接**：每轮按当前消息检索 top-k（先用关键词/BM25，以后可接 embedding），只注入命中的条目。预算由 P2 的框架统一管理。
- **M4.4 管理面**：在 Console 里查看、编辑、删除记忆，用户也可以用命令查看或遗忘“关于我的记忆”。
- **M4.5 评测**：`memory` 标签用例覆盖跨会话回忆、过期不再出现、群成员无法篡改主人事实。

**验收：** 记忆注入 token 不再随条目数线性增长；`memory` 用例全部通过。

---

### P5 · 长任务（接 #718 之后）

**目标：** 任务可以在后台跑几十分钟，用户随时可以插话、改方向或叫停，进程重启后能接着跑。

- **M5.1 Detached Task 类型**：#718 里列为 out-of-scope 的那部分。
  - 新增一种后台任务，有自己的 `taskId`、持久化状态机（queued/running/waiting_approval/paused/done/failed/cancelled）、投递通道和审批通道。
  - 权限来自创建时冻结的 `turnPolicy` 快照，不借用当前的回合权限。`DeferredWorkerRunner` 已经预留了这个参数。
- **M5.2 断点恢复**：每次工具调用后把 step checkpoint 落盘（已有 `ai/agent-step-checkpoint.ts`），重启后从最后一个 checkpoint 继续执行。
  - 不可重放的副作用工具要标注幂等键，复用 workroom 的 effect ledger 思路。
- **M5.3 主动汇报**：按时间间隔或里程碑推送进度，通过发送链、带节流。任务完成时推送摘要。
- **M5.4 插话、改向、叫停**：用户在同一会话里发消息时，先由意图分类器判断（复用 `turn-intent-resolver.ts`）：
  - **叫停**：给任务发 abort；
  - **改向**：在下一个 step 边界注入 steering 消息；
  - **无关消息**：正常开新回合。
  - 再加命令 `/tasks`、`/task stop <id>`。
- **M5.5 评测**：`long-task` 标签用例包括：模拟重启后恢复、中途改向、叫停后没有残留副作用、进度消息有节流。

**验收：** 一个 30 分钟的任务，经过一次进程重启和两次插话后，仍然能正确完成；trace 可以完整回放整个过程。

---

### 本轮补充（已共识）

1. **P0 两层评测**：PR 门禁使用脚本化 fake 模型测试 harness 行为（#720/#721）；nightly 用真模型，加语义断言和可选的 LLM judge（#723）。不以请求哈希录制回放作为门禁。
2. **Provider 韧性**（#724）：限流、超时、重试、fallback 模型、按模型的 tool-calling 怪癖适配，以及模型能力矩阵评测。
3. **普通回合并发**（#725）：回合运行中到达的消息如何排队、合并或打断，尤其是群聊突发。排在 P5 之前。
4. **成本与滥用控制**（#727，归入 P3）：按用户、按群的 token 配额和速率限制。
5. **P3 注入来源扩展**（#726）：第三方插件/技能提示词和子 agent 报告，同样按 `external_content` 处理。
6. **配置面收敛**（#735）：编写《默认行为规范》文档；每个里程碑都要复审新增开关，决定删除或合并。
7. **M2.5“已告知”账本**（#730）：和 #718 的进度汇报记录共用数据。
8. **P1 最小切片**（#722）：M1.1 TurnTrace 加 M1.4 `zhin trace last`，和 P0 一起或紧随其后完成。


## 3. 持续推进机制

- **跟踪方式**：每个里程碑（M*.*）开一个 GitHub issue，用 `harness-maturity` 标签和 `P0`…`P5` 子标签。本文档只维护目录和状态，不写细节。
- **节奏**：每周看一次 nightly 评测趋势。凡是在 QQ 上新撞到的问题，先补用例，再排进对应阶段。
- **门禁**：从 P2 开始，每个合并的里程碑都要附上“评测通过率前后对比 + token 前后对比”。
- **状态表**：

| 里程碑 | 状态 | Issue | PR |
|---|---|---|---|
| P5 前置：同步子 agent、按进展延长预算、自动续跑、进度汇报 | 评审中 | — | #718 |
| 群聊 group_member 回合临时收紧 | 进行中 | #719 | |
| M0.1 脚本化评测框架 | 未开始 | #720 | |
| M0.2 种子用例（≥20 条） | 未开始 | #721 | |
| P1 最小 trace（M1.1 + M1.4） | 未开始 | #722 | |
| M0.3 nightly 加 M0.4 贡献规则 | 未开始 | #723 | |
| Provider 韧性加能力矩阵 | 未开始 | #724 | |
| 普通回合并发 | 未开始 | #725 | |
| M3.1/M3.2 信任分级与发起人绑定 | 评审中 | #726 | |
| M3.3–M3.5 二次确认、输出检查、配额限流、注入评测 | 评审中 | #727 | |
| M1.2–M1.5 trace 持久化、Console、CLI | 未开始 | #728 | |
| M2.1–M2.3 量化与按需加载 | 未开始 | #729 | |
| M2.4–M2.6 压缩、已告知账本、cache | 未开始 | #730 | |
| M5.1–M5.3 后台任务与断点恢复 | 未开始 | #731 | |
| M5.4–M5.5 插话、改向、叫停与 /tasks | 未开始 | #732 | |
| M4.1–M4.2 记忆模型与写入策略 | 未开始 | #733 | |
| M4.3–M4.5 记忆检索（BM25）、管理面、评测 | 未开始 | #734 | |
| 配置面收敛与《默认行为规范》 | 持续 | #735 | |

## 4. 已定决策（原待决问题）

1. 评测放在包内：`packages/im/agent/evals`，和 `turbo test` 的依赖一致。
2. nightly 真模型评测使用 Gemini（默认 `gemini-3.8-flash`，`GEMINI_API_KEY`），小预算，key 存在 GitHub Actions secrets。
3. 记忆检索第一版用 BM25，等评测证明不够再升级 embedding。
4. 群聊 `group_member` 回合立即临时收紧（不给 shell、不给文件写入、不向第三方外发），作为本轮第一个 PR（#719）。P3 信任分级（#726）落地后替换这个临时方案。
