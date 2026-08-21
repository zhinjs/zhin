# Agent Runtime

Agent Runtime 在 Core IM 概念之上负责 AI 编排：ZhinAgent 回合、工具选择、技能、子代理、上下文预算和安全策略。它的边界是让 Agent 行为保持显式，同时不把 IM 语义下沉到 `@zhin.js/ai`。

## 语言

**ZhinAgent**:
消费 **Turn Ingress** 的 Agent 运行时，负责准备提示词、收集工具、运行模型回合，并产出 **Turn Outcome**；不接收或保存任何 IM `Message` 对象。
_避免使用_：assistant、bot brain、AI plugin

**Turn Ingress**:
Agent 唯一入站契约；由 IM、HTTP、A2A、Schedule 等入口在 composition root 构造。包含不可变的 origin、principal、content/media、session address、generation/trace/turn identity、policy context 和 cancellation signal，并注入 turn-scoped ports。网络能力必须由 policy context 显式授予；缺省为禁用，HTTPS/域名约束随 turn 固定。它属于 Agent 域，不是 IM Message 的别名。
_避免使用_：commMessage、synthetic Message、bridge message、Message.extra

**Turn Ports**:
仅在当前 turn 或明确派生 operation 内有效的能力端口，包括 `ReplyPort`、`DeliveryPort`、`ApprovalPort`、`QuestionPort`、`ActivityPort`；Agent 核心通过端口请求副作用，不持有 Adapter、Endpoint、Plugin 或 Message。`QuestionPort` 由入口把 origin-neutral `InteractionRouter` 绑定到已认证 principal 与 canonical session；回复在 IM middleware、Command 与 Agent fallback 前被 claim。Router 不保存原始 IM Message 或跨 turn 发送句柄，校验提示必须使用当前回复 operation 的 delivery authority。
_避免使用_：Message.$reply、Adapter.sendMessage、host Plugin、回调字段包

**Turn Context Envelope**:
从 canonical Turn 的 origin、principal 与 session address 生成模型可见的运行时上下文。它不解析 IM `Message`；IM 入口只能在最外层 adapter 将已认证的平台字段投影为 Turn，Schedule、HTTP、A2A 与 Internal 直接使用各自 origin。
_避免使用_：从 `$adapter/$endpoint/$channel/$sender` 读取上下文、为非 IM turn 伪造平台字段、Schedule 专用 prompt 分支

**Agent Prompt Profile**:
显式选择 `interactive | schedule` 的不可变 prompt 输入。Schedule profile 在进入公共 prompt assembly 前已固定 job、creator 与 security；公共层不得从 ALS 猜测执行域，也不得借用 synthetic IM identity 读取平台 prompt 或记忆。
_避免使用_：`getScheduleTurnContext()`、ambient prompt mode、Schedule 借用 IM file memory

**Turn Outcome**:
Agent 执行的唯一终态，判别为 `completed | failed | cancelled | budget_exceeded`，包含输出内容、usage、tool calls 与 terminal reason；每个 turn 恰好产生一次，并先进入 Event Journal，再由入口决定同步返回、流式投影或投递。
_避免使用_：string reply、throw-or-message 双轨、无终态 generator

**Agent Orchestrator**:
工具、技能、子代理、MCP 服务和 AI 生命周期 Hook 的注册表所有者。
_避免使用_：manager、registry bag、service locator

**Tool**:
面向 Zhin 运行时的可调用能力，带有元数据、权限级别和可选的上下文注入参数。
_避免使用_：function、command、action

**AgentTool**:
`@zhin.js/ai` 消费的、面向 Provider 的可调用形状。
_避免使用_：raw tool、model tool、function

**Tool Selection**:
把候选 Tool 转换为 AgentTool 的共享流程，包含规范化、权限检查、相关性过滤和 allow/deny 开关。
_避免使用_：tool collection、tool filtering

**Tool Runtime**:
在 Tool Selection 之后决定最终运行时工具列表、上下文工具注入和 Pre-executable Tool 路径的 Agent Runtime 模块。每次执行只接收 canonical Tool Execution Context（origin / principal / session / trace / signal / policy），不得读取 IM Message 第二参数。执行前必须统一经过 `runTurnToolPolicies`；文件 CRUD、敏感路径和 Bash 命令不得在 Tool 实现内另建策略链。网络 transport 的每个真实 hop 必须消费同一 context policy，禁止依赖 ALS 或执行域特判。
_避免使用_：tool glue、runtime helper

文件 Tool 的 workspace authority 属于 Turn policy。策略门面必须 canonicalize 现存目标、symlink 与不存在写目标的最近父目录，并把批准后的绝对路径交给 ToolFeature；实现不得重新读取 `process.cwd()`、展开 `~` 或用 shell 模拟 glob/grep。

网络 Tool 只使用 Turn-scoped `TurnNetworkClient`。它必须逐 redirect hop 授权 URL、解析并拒绝所有非公网地址，再把 HTTPS SNI/Host 保持为原域名而将 socket 固定连接到已审核 IP；禁止先检查后交给另一套 DNS resolver、`redirect: follow`、ALS network policy 或工具内手写 SSRF 分支。

TODO capability 以 canonical session key 为唯一地址，由 `TodoStore` 哈希命名并原子替换；模型输入不得包含 `chat_id` 或文件路径。`.zhin/` 是 runtime-private state，所有通用文件 Tool 必须拒绝读取或枚举，Journal、TODO 与其他 authority-owned 文件只通过各自深模块访问。

交互 Tool 只消费 canonical `QuestionPort`。Root-owned `InteractionRouter` 以 session + authenticated subject 作为唯一匹配键，一次 session 只允许一个待答问题；IM 只在 composition root 投影 address 与 delivery，`ask_user` 不得读取 Plugin、Adapter、Message、Prompt middleware 或模块级 generation store。unattended Turn 不提供 QuestionPort，调用必须 fail closed。

**Capability Feature**:
Plugin 侧可写能力表（Tool / Skill / Agent / MCP），承载装配与生命周期；**不是**回合执行时的运行时权威。
_避免使用_：tool service 真相源、双注册、registry bag

**ToolFeature** / **SkillFeature**:
Core IM 中的能力 Feature；插件与文件发现在装配期写入此处。
_避免使用_：Orchestrator 直写、回合 SSOT

**AgentFeature**:
Agent Runtime 中的专长 / 子代理预设 Feature（对齐 `*.agent.md`）；**不**替代配置里的主 Agent 选用。
_避免使用_：AgentPresetFeature（作为唯一对外名）、主绑定 SSOT

**MCPFeature**:
Agent Runtime 中的 MCP server **声明** Feature；不含已连接后的工具列表。
_避免使用_：已连接工具池、MCP host server

**Capability Ingress**:
把 Capability Feature（及常驻核心）按需装入 **Agent Orchestrator** 的 seam；Boot 装 reserved/builtin，入站按 `canAccessTool`（platforms / scopes / permissions）装载并按可达投影缓存；换出上一轮 on-demand 条目（有活动回合持有时延迟到 lease 释放再清除）。实现类为 `FeatureCapabilityIngress`（`src/ingress/`），与 `@zhin.js/agent/runtime` 的 Plugin Runtime `CapabilityIngress`（`src/plugin-runtime/`）区分。
_避免使用_：双写 bridge、mount 全量同步、作者侧第二套 adapter/scene/role 声明语言

**Tool Ingress**:
历史称呼；现由 **Capability Ingress** 覆盖 Tool 路径（作者写 Feature → Ingress → Orchestrator）。
_避免使用_：tool service、双注册、Feature 当回合 SSOT

**Permission Level**:
Tool 进入模型前用于比较调用者和工具权限的有序权限词汇；装载过滤复用 `platforms` / `scopes` / `permissions`。
_避免使用_：role、ACL、rank、独立的 adapter/scene_type/sender_role 轴

**Skill**:
面向任务的能力包，可以为用户请求浮现配套 Tool。
_避免使用_：plugin、prompt、recipe

**Subagent**:
用于更窄任务或角色的委派 Agent 预设（常来自 **AgentFeature**）。
_避免使用_：worker、child bot、helper

**Agent Binding**:
配置 `agents[].match` 解析出的主路径选用结果；入站选用权威在配置，不在 AgentFeature。
_避免使用_：Feature match、preset 当主绑定

**Context Budget**:
用于裁剪历史并配置底层 AI Agent 的已解析上下文窗口。
_避免使用_：max tokens、history size、window

**Pre-executable Tool**:
可以在模型回合前执行、用于收集新鲜上下文的 Tool。
_避免使用_：preload、setup action、preflight

## 编排（Orchestration）

**WorkroomKernel**:
以 versioned append-only Journal 为唯一事实源，使用 `append(runId, expectedSequence, events)` 提交 Run、Task、Assignment 与 Blocker 状态迁移。执行完成与验收是两个独立事实；Console、Scheduler 与 IM 都只能投影 replay 结果。
_避免使用_：orchestrator service、mission runner、dispatcher SSOT

**Run**:
Project 内一次版本化协作执行；必须携带显式 `projectId`，不得从 IM session、HTTP 调用或消息 metadata 猜测 Project。
_避免使用_：mission、job、pipeline run（非 Kernel 语境时）

**Task**:
Run 内有生命周期、验收条件和 stable task key 的逻辑工作项，可在不同 Plan/Task revision 中修订并委派给不同 Assignment。依赖引用 task key，由当前 Workflow Plan 解析 active revision，避免返工后下游仍指向废弃 execution id。
_避免使用_：subagent id、spawn id、job item

**Executor**:
通过 `AssignmentExecutorPort` 执行 Task 的 transport adapter（local / remote A2A），向 Kernel 提交 progress/heartbeat/checkpoint/report observation；本地与远程共用同一 Assignment lifecycle。
_避免使用_：worker、handler、直接改 task status

**Remote Executor**:
通过 A2A 执行 Assignment 的 transport adapter，遵守与 local 相同的 lease、heartbeat、checkpoint、Task Report 与 terminal event 契约。endpoint/Card/auth/extension capability 随 Assignment 固定；只有支持 idempotent dispatch、typed Completion Envelope 与允许 Workspace Provider 的端点可 claim。共同工作空间通过版本化 Workspace/Artifact Reference 表达，不假设共享本地文件系统；Kernel、Scheduler 与 Project Memory 不因远程拓扑改变状态模型。
_避免使用_：远程专用 Task 状态机、共享 host path、text-only A2A completed 直接完成 Task、A2A 绕过 Kernel

**Remote Execution Link**:
Remote Executor 的可重建 transport projection，映射 local Assignment/attempt/fence、持久 dispatch/message id、endpoint/Card snapshot、A2A remote task/context receipt、callback cursor、reconcile deadline 与 terminal receipt。它不拥有 Task status；Push/SSE 只是低延迟观察，重启恢复依赖 Journal outbox、callback inbox、poll snapshot 与 Kernel clock。
_避免使用_：A2A taskId 取代 Assignment ID、进程内 running map/poll timer 作为恢复依据、retry 生成新 message ID

**Remote Callback Inbox**:
authenticated A2A push/poll observation 在进入 Kernel 前的持久化去重边界，以 endpoint + event id + canonical payload hash 标识。重复同 hash 为 no-op，同 id 不同 hash fail closed，sequence gap 进入 bounded reconciliation；adapter 再校验 task revision/attempt/fence、remote link 与 typed schema，才能提出普通 Assignment event。transport auth 不等于 Task authority。
_避免使用_：HTTP callback 直接 update Task、按到达顺序覆盖、SSE 断开即失败、callback metadata 自报 authority

**Remote Completion Envelope**:
Workroom A2A extension 的 typed terminal payload，绑定 dispatch/Assignment identity、Task Report/Candidate/claims/Evidence，以及 Workspace receipt 的 immutable base/branch/head/PR hash。验证成功只产生 `assignment.execution_completed`，仍须独立 Acceptance；普通状态文本、discussion 或移动中的 PR 不能替代它。
_避免使用_：解析“done”文本、remote completed 即 accepted、PR URL 不固定 head SHA、callback 直接 merge

**Shared Workspace Reference**:
跨主机 Assignment 的版本化 workspace authority；GitHub 形式至少包含 canonical repository ID、integration binding、immutable base/checkpoint SHA、target ref、per-attempt branch、path scope、mode 与 fence，不包含 host path 或 credential。强 lease 由 capability gateway/短期 grant 与 branch protection 执行；takeover 使用新 fence + 新 branch，旧 branch/late push 永远 stale。
_避免使用_：A2A 传 GitHub token、多个 attempt 写同一 branch、以 PR latest head 代替 candidate hash、宽泛 repo write token 冒充 path/ref lease

**Agent Discussion**:
本地或 A2A Agent 之间的非权威交流，可用于澄清、建议和探索，但不能创建/完成 Task、改变 Workflow Plan、提升 authority 或更新 Project State。正式交接必须提交 Kernel RunEvent、Task Report 与稳定 Artifact/Workspace Reference。
_避免使用_：以 Agent 聊天驱动状态机、从聊天文本推断 Task completed、discussion 绕过 Plan Revision

**Agent Definition**:
稳定、可注册的团队角色定义，声明名称、职责、模型选择、能力与 authority 上限。Orchestrator 只能从当前 generation 中已注册且对 Run 可见的定义选择协作者，不能在运行中创造拥有未知权限的角色。
_避免使用_：一次执行实例、任意 system prompt、动态权限包

**Agent Assignment**:
把一个 **Agent Definition** 分配给具体 **Task** 后形成的执行实例；拥有独立状态、上下文、预算与审计身份，完成或取消后即可释放。Workroom 使用稳定角色名展示它，同时保留 assignment/task identity。
_避免使用_：永久 Agent 进程、把 Agent Definition 本身标成 running、无 Task 的后台 worker

**Assignment Capability Snapshot**:
Assignment 启动时按当前 generation capabilities、Workroom Profile、Agent Definition、execution role、Task requirements 与 authority/risk policy 取交集得到的版本化最小 Tool/Skill 集。Snapshot 随 Assignment 固定并进入 Journal；Profile/HMR 变化不得静默改变正在运行的能力。Skill 可声明所需 Tool，但不能授予 Tool authority。
_避免使用_：所有 Agent 携带完整 Tool/Skill、继承主 Session 全部能力、运行中无事件地扩权

**Capability Request**:
Executor/Reviewer 在执行中发现 Assignment Capability Snapshot 不足时提交的持久化请求。Profile 内低风险 Skill/只读 Tool 可按 policy 由 Orchestrator 自动批准；写入、网络、外部系统或 Profile 外能力必须形成 Plan/Profile Revision 或 Sponsor approval。批准产生新的 snapshot revision，不允许 Agent 自行加载整个目录。
_避免使用_：load_tool 即授权、模型自行安装永久能力、一次批准扩大所有后续 Task

**Workflow Plan**:
Orchestrator 针对一个 **Run** 动态提出、由 Kernel 版本化持久化的 Task DAG，包含目标、required/optional、active Task revision、依赖、预算与 approval gate。依赖默认只由 `accepted` 满足；串行、并行、条件分支只能作为纯 Plan builder primitive，旧执行型 `runPipeline` / `runParallel` / `route` 已删除，不能成为另一套执行或状态权威。
_避免使用_：固定 pipeline 即 SSOT、只存在 prompt 中的计划、绕过 Kernel 直接 spawn

**Workroom Inbox**:
进入 Project 的持久化工作请求队列；每项保存 principal/authority、Sponsor priority lane、intent、scope、deadline 与来源 conversation event。Orchestrator 消费 Inbox 并提出 Plan Revision，但不能删除请求、伪造 Sponsor lane 或直接 dispatch；planned/rejected/deferred 由 Kernel event 结算。
_避免使用_：进程内消息数组、每条消息直接 spawn、让 Orchestrator 自报 priority authority

**Workflow Control Plane**:
独立于 Agent/Executor 执行面的 Kernel 控制能力，保证 Sponsor 在任何非终态 Run 上都能查询阻塞原因，并执行 resume、replan 或 cancel。每个等待/阻塞状态必须保存 owner、reason、deadline 与合法后继；Executor lease/heartbeat 过期必须进入可恢复状态。取消是幂等、分层传播且不依赖被取消 Agent 继续响应，重启后仍能从持久化事件恢复控制。
_避免使用_：等待无期限 Promise、只有 Agent 能解除的阻塞、进程内 cancel flag、无法识别 owner 的 pending

**Workroom Scheduler**:
消费 Kernel facts 的无状态、确定性决策器。多实例对同一 sequence 必须产生相同 decision，并以 `append(expectedSequence, events)` 竞争提交；dispatch 通过 event outbox/Assignment id 幂等交付。排序依次考虑 Kernel control、安全 reservation、starvation bound、Sponsor lane、deadline、lane 内 rank/aging、enqueue sequence 与 task key。Orchestrator 只可在 lane 内调 rank；跨 lane 必须提交带 owner/deadline/approve/reject/rebase/cancel 的 Approval Gate。capacity、aging、starvation 与 preemption 阈值作为 Run 的 Scheduler Policy Snapshot 持久化，HMR 不得改变旧 Journal replay。
_避免使用_：模型上下文里的隐式队列、FIFO 即全部策略、无限期饿死低优先级 Task

**Portfolio Admission**:
位于多个 Project 之上的持久化资源准入控制面。它只比较各 Workroom Scheduler 已选择的不透明 Capacity Request，按 Sponsor Portfolio Policy、预算、Pool capacity/rate、weighted dominant service 与 starvation reservation 决定是否发放 Capacity Grant；不能读取 Project Context/Memory、重排 Project 内 Task、修改 Plan，或直接完成/暂停/取消 Task。Sponsor Room 是 Portfolio facts/commands 的 projection，不是状态 writer。
_避免使用_：全局总 Orchestrator、合并所有 Project queue、进程内 semaphore 即资源权威、Portfolio 直接改 Task status

**Capacity Request**:
Workroom Scheduler 为已在 Project 内选中的工作提交的资源请求，只含 Project/request identity、opaque Run ref、scheduler order、Profile digest、deadline/preemptibility 与原子 Resource Bundle demand。它禁止携带 prompt、消息、Task title、Context、Memory、Artifact、Evidence 或 Tool 参数；Portfolio priority 只能来自可信 Sponsor policy/override。
_避免使用_：把完整 Task 复制到全局队列、Agent 自报 urgent、按请求数量争抢份额、分池逐个申请导致部分持有

**Capacity Grant**:
Portfolio 对一个 exact Capacity Request 签发的 fenced Resource Bundle reservation/lease，固定资源、预算、rate、Portfolio/Project policy revision、offer/lease expiry 与递增 fence。Grant 只授权使用已由 Profile/Assignment Snapshot 允许的共享资源；Workroom Kernel 仍独占 Assignment claim 与 Task/Run 状态。未消费 offer 可过期退款，已消费且结果未知时只释放物理 capacity，预算保持 reconciliation blocker。
_避免使用_：capacity token、Grant 即 Task dispatch、Grant 扩大 Tool authority、失联即按零费用重试、旧 fence 继续执行

**Capacity Reclaim**:
Portfolio 为更高优先级或 starvation reservation 请求拥有 Workroom 归还 checkpointable Grant 的两阶段控制协议。Workroom 在安全点 checkpoint 并确认后才释放；atomic 工作只能完成或 lease 失效。Portfolio pause/reclaim 不等于 Workroom cancel，不能由 Portfolio 越权中止 Assignment。
_避免使用_：全局 scheduler 直接 abort Task、把 preempt 当 cancel、无 checkpoint 仍宣称可恢复、无限续租压住 starvation reservation

**Task Preemption**:
高优先级工作插队时对运行中 Task 发出的持久化控制请求。Assignment 在安全点写入 checkpoint/artifact、释放 lease 并进入 paused；不可中断外部动作完成当前原子步骤后再让出。恢复时使用保存的 workspace、预算与 Context View revision。它不同于 cancel。
_避免使用_：粗暴 abort 后宣称可恢复、丢失 workspace 的 pause、绕过 Plan Revision 的临时 spawn

**Approval Gate**:
Workflow Plan 中显式、持久化的风险关卡。低风险内部工作可按 Workroom policy 自动推进；写入、外部发送、部署、付费或其他高风险动作暂停在 Gate，由 Run Sponsor 或获授权角色批准、拒绝、修改或取消。Gate 固定 candidate hash、Contract/Policy revision、scope、owner、deadline 与合法后继；candidate/target/scope 改变后旧 Gate stale。过期默认不批准，但必须可重新发起、rebase、replan 或 cancel。Gate 自身不能占用 Executor。
_避免使用_：工具调用中临时等待聊天回复、未入 Journal 的 approval、批准后扩大整个 Run 的 authority、无 deadline 的永久 pending

**Execution Workspace**:
Agent Assignment 执行 Task 时由可信 Workspace Provider 挂载的隔离空间。可变 Task 默认使用 per-Assignment worktree、overlay 或 sandbox volume，只读 Task 使用 immutable snapshot；worktree 隔离并发写但不是安全沙箱，仍需 container/process、filesystem、network 与 credential policy。Executor 只看到 opaque mount ref，不能自行创建/删除 workspace 或写 canonical target；共享写空间必须在 Plan 中显式串行化。
_避免使用_：多个 Agent 默认写同一目录、把 host cwd 当 authority、Task 完成即自动合并

**Workspace Lease**:
Kernel 为一个 Assignment attempt 签发的 workspace authority，固定 project/run/task revision、assignment/attempt、backend、base revision、mount ref、mutable scope、expiry 与 fencing token。checkpoint/pause/lost 后由新 Assignment/attempt 以递增 fence 接管，旧 writer 立即失效；Turn filesystem root 必须来自该 lease，不能使用 Project root。
_避免使用_：path 字符串即授权、恢复后两个 writer 同时有效、Agent shell 管理 worktree 生命周期

**Change Set**:
Assignment 从 Workspace seal 的不可变交付 Artifact，保存 base revision、path/mode/delete manifest、content/patch refs、producer、hash、Evidence/test refs 与风险，不保存 host 绝对路径。Task Acceptance 可以接受 Change Set，但不会自动 merge、复制到共享目录、push、deploy 或改变外部系统。
_避免使用_：直接把 workspace 当交付物、Agent 完成即自动 merge、无 base/hash/provenance 的 patch 文本

**Integration Task**:
Plan 中专门消费 accepted Change Sets 的 Task。它在新的隔离 workspace 按持久化顺序 apply/rebase、发现 path/semantic/upstream conflict、运行组合检查并产出新的 candidate；冲突形成 Blocker/新 revision，producer Task 不因此变为失败。candidate 验收后仍需 target revision CAS 与 #7 风险策略授权才可写 canonical target。
_避免使用_：按完成顺序合并、last-writer-wins、producer 自行合并、force push 绕过 stale target

**Effect Ledger**:
外部副作用的只追加事实链：先记录带 capability/operation、idempotency key、preconditions、risk、reversibility 与 approval decision 的 Effect Intent，再记录 `committed | failed | outcome_unknown` receipt。取消只能阻止尚未开始的 intent；调用开始后 Abort 不代表副作用没发生，未知结果必须进入 reconciliation blocker。
_避免使用_：工具返回前无 intent、Abort 即回滚、对 outcome_unknown 盲目重试、用 IM 消息当 effect receipt

**Compensation Plan**:
Workflow 对 confirmed committed effect 声明的可选补偿路径。未发布的隔离变更只需 discard；已提交动作只能调用 capability 预先声明、消费原 receipt 的 typed compensate operation，并作为新 Effect 记录 `compensated | compensation_failed | compensation_unknown`。Git 使用新 revert Change Set，部署可重新部署旧 release；原事件永不删除。没有补偿能力的动作必须在执行前标注 irreversible 并进入 Approval Gate。
_避免使用_：承诺通用 rollback、用删除日志冒充撤销、由模型临场猜测反向操作

**Context View**:
从 immutable Workroom Facts 按 Role-bound Execution Envelope、Plan/Task revision、context policy 与 token budget 构造的可审计 prompt projection，不等同于共享聊天历史。Orchestrator View 包含目标、可信 Sponsor directives、当前 Plan、Inbox disposition、全局阻塞/预算与 Task Report 摘要；Executor View 只含 Task contract、applied TaskInput、相关 accepted Project facts、直接依赖 Report/Artifact；Reviewer View 只含 acceptance contract、candidate Report/Artifact、风险策略与可下钻 Evidence。每次构造记录 selected/excluded fact IDs、source sequence、policy version 与预算；mandatory authority/acceptance 内容超预算时必须阻止执行，不能静默裁剪。
_避免使用_：所有 Agent 共用同一 messages 数组、把群聊全文塞进每个 prompt、用裁剪顺序代替权限边界

**Workroom Fact**:
由 canonical ingress、Kernel Journal、accepted Project State、Task Report 或 Artifact registry 产生的不可变、带 provenance 数据单元；至少保存 project/run/task/assignment scope、actor/principal、authority、intent、disposition、source event、revision 与 visibility。Fact 记录“谁说了/发生了什么”，不代表其内容自动为真或有权改变状态；Context View 与 Project State 都只是其不同投影。
_避免使用_：把聊天正文当事实真值、无 source event 的 prompt 片段、摘要覆盖原始记录

**Data Descriptor**:
绑定 Data Object 的正交治理元数据：tenant/Project、Confidentiality Class、Data Category、allowed purpose、subject linkage、residency、Retention Window、lineage 与 policy revision。任何 summary、Digest、Report、Artifact 或 hand-off 都必须从 source Descriptor 保守派生，不能靠模型自报降级。
_避免使用_：单一 privacy level、消息 metadata 自分类、摘要即匿名化、无 lineage 的复制正文

**Confidentiality Class**:
数据正文允许传播范围的有序等级 `public | project_internal | confidential | restricted | unknown`；它只表达保密性，不表达数据类别、法律基础、地域、保留期限或风险总分。`unknown` 必须 quarantine 并 fail closed。
_避免使用_：sensitive 万能标签、regulated 作为保密等级、用 risk tier 代替数据治理

**Disclosure Decision**:
当前 Data Governance Policy 对 exact Descriptor、Envelope/principal、purpose、channel、Processing Destination/recipient snapshot 与 approvals 的唯一判定，结果只能为 full、metadata-only、trusted transform required、exact approval required 或 deny。Context View、Evidence Port、IM/Console projection 与 A2A 共享此判定，不得各自放宽。
_避免使用_：引用即授权、sink 本地过滤、Sponsor 可越过 tenant/credential hard deny、缓存旧受众决定

**Trusted Minimizing Transform**:
受信、版本化、可验证的 typed redaction/deidentification 操作；它产生带 input/output hash 与 lineage 的新 Data Object，不覆盖 source。Masking/pseudonymization 仍保持 subject linkage，只有经过 policy/verifier 证明的 deidentification 才能移除。
_避免使用_：让 LLM 看原文后自行匿名、正则打码即无个人数据、修改 source、transform 名称即证明

**Disclosure Manifest**:
一次已 materialize 披露的不可变审计契约，绑定 source/output hash、purpose、channel、principal/Assignment、destination contract/recipient revision、policy、Governance Journal approval、expiry 与删除/再披露约束。它授权 exact output delivery，不授权其他数据、Tool 或后续转发。
_避免使用_：opaque manifest ref、request metadata 自带批准、一次批准覆盖整个 Run、发送后删除审计冒充未披露

**Payload Vault**:
保存敏感正文/chunk 的受治理存储面；不可变 Journal 只保存 content-free header、hash、provenance 与 lifecycle receipts。Payload Vault 的 location manifest 使 expiry/erasure 能覆盖 primary、index、cache、replica 与 backup，而不破坏事件审计。
_避免使用_：敏感正文永久写入 Journal、软删除即 purge、没有副本清单的删除

**Retention Window**:
Data Object 的最早允许清理时间与最晚计划清理时间；baseline/Profile/lineage 对窗口取交集。minimum obligation、active Hold 和 maximum minimization 是不同约束，不能压成一个 TTL。
_避免使用_：越短永远越合规、只按创建时间删消息、派生物比 source 活得更久

**Retention Hold**:
阻止 exact Data Object 在 window 到期后被 purge 的受信治理事实，固定 owner、reason、reviewAt 与显式 release。Hold 只影响 lifecycle，不授予 disclosure；review overdue 形成 blocker 而非自动释放。
_避免使用_：无限期无 owner 保留、Hold 即可读权限、模型自行解除、到期自动放行

**Purge Plan**:
针对 Payload Vault location manifest 的持久化多位置删除计划；只有所有 authenticated receipt confirmed 后正文/密钥才视为 purged，unknown outcome 保持 reconciliation。最小 content-free header 与原披露审计继续保留。
_避免使用_：删除单表即完成、Abort 即已删除、清除 Journal 历史、忽略外部副本

**Context Digest**:
针对 consumer role + task scope + Plan revision 生成的非权威派生缓存，保存 source fact IDs、source hash、actor/disposition 摘要、anchor 与 context policy version。Digest 不能包含被拒绝/越权输入，不能摘要 Digest，不能更新 Project State；source/revision/policy 任一变化即 stale，并从原始 Facts 重建。
_避免使用_：递归摘要旧摘要、丢失参与者归因、把摘要结论升级为 accepted fact

**Evidence Reference**:
Task Report claim 或 Artifact metadata 指向原始证据的稳定、内容寻址引用。Context View 默认只暴露 ref、来源、classification 与简短 metadata；正文必须通过 Evidence Port 按当前 Execution Envelope/Policy 重新授权后下钻，并仍作为 untrusted data 注入。Reviewer 不读取 Executor 私有思维链，只核查 contract、Report、Artifact 与 Evidence。
_避免使用_：把完整 tool output 塞进共享 prompt、引用即授权、把 chain-of-thought 当验收证据

**Workroom Message Semantics**:
人类消息通过 authority、intent、scope 三个正交维度解释：谁有权提出改变、消息希望产生什么效果、影响整个 Run 还是具体 Task/Agent。authority 决定是否能改变状态，relevance 决定是否进入某个 Context View，Sponsor lane 决定调度；三者禁止折叠成一个 message weight。Sponsor 闲聊不自动覆盖正式目标，普通参与者建议可成为 untrusted context，但不自动成为约束。
_避免使用_：单一数值 message weight、仅按 sender role 推断 intent、把 relevance 当 permission

**Plan Revision**:
Orchestrator 对 Sponsor 正式要求、关键新事实或执行反馈提交的 Workflow Plan CAS proposal，携带 base revision、provenance、diff、原因、影响范围、Task 暂停/取消/重跑集合与预算变化。Kernel 将其结算为 `applied | approval_required | rejected | stale`；新 revision 应用后旧 proposal 自动 stale，必须 rebase，不能形成永远无法批准的阻塞。运行中 Task 不能被静默替换，必须先 preempt/checkpoint；依赖通过 stable task key 跟随新的 active Task revision。
_避免使用_：静默改 prompt、直接向所有 Agent 广播新要求、没有 diff 的 replan

**Task Report**:
Agent Assignment 的结构化交接产物，至少包含状态、摘要、claims、evidence/artifact refs、confidence、decisions、unresolved questions、risks 与 recommended next actions。关键结论没有证据时只能标为 hypothesis；不能单独触发高风险 Plan Revision。Orchestrator 默认消费 Report，需要争议处理或审计时才沿引用下钻原始记录。
_避免使用_：只有自由文本结果、把模型语气当置信度、复制完整执行 transcript 作为交接

**Task Acceptance**:
把 `execution_completed` 的 Task Report/Artifact 验收为项目事实的显式状态迁移。Task revision 固定 versioned Acceptance Contract 与 Risk Policy Snapshot；Orchestrator 只能请求确定性 policy projector 求值，不能由模型自行声明通过。低风险且全部 criteria 可机器验证时由 policy 自动验收；medium 或含 judgment criterion 才创建独立 Reviewer Assignment；high/critical 的关键副作用或决策还需绑定精确 candidate hash 的 Sponsor Gate。失败、返工或尚未集成的产出不得更新 Project State，返工必须形成可审计的 Task revision。
_避免使用_：执行结束即验收、Agent 自证完成、未记录 acceptance criteria/reviewer

**Risk Acceptance Policy**:
消费不可变 Candidate、Acceptance Contract、Risk Assessment、trusted Check Result、Reviewer Verdict 与 Sponsor Gate 的纯决策器。Risk Assessment 由 Kernel 从可信 capability/Plan/Artifact/Effect 元数据生成并绑定 candidate hash，不能由 Executor 随产物自报；风险按 side effect、reversibility、data class、blast radius、capability tags 与 uncertainty 的最高维度保守分级，不使用可被 Agent 操纵的加权总分。missing/failed/error/expired check、缺失 trusted assessment 或未知风险 fail closed；低风险机械检查可自动验收，medium/判断性标准需要 Reviewer，high/critical 需要 Sponsor，二者可串联。Workroom Profile 只能追加 Reviewer/Sponsor tier 或 deny capability，不能降低 baseline；policy snapshot 固定于 Contract，HMR 不改变在途 replay。
_避免使用_：Executor 自报 risk facts/score、Sponsor 豁免硬检查、latest policy 改写旧 Run、每个 Task 固定 Reviewer

**Reviewer Assignment**:
由 Kernel 按 Risk Acceptance Policy 创建的独立只读 Assignment，producer/reviewer principal 必须不同。Reviewer View 仅含 Contract、Candidate、相关 baseline、Risk 与 Evidence index，不继承 producer workspace、tool/effect authority；Verdict 逐 criterion 标记 `passed | failed | needs_evidence`，并逐 claim 记录 accepted/rejected 与 Evidence。Verdict 只是 policy 输入，不能直接写 `task.accepted`。
_避免使用_：Executor 自审、Reviewer 继承写权限、自由文本 LGTM 直接完成 Task、所有小任务都复核

**Acceptance Record**:
Kernel acceptance policy 产生的不可变审计事实，固定 candidate/Contract/policy/hash、risk tier/route、Check Results、Reviewer Assignment/Verdict、Sponsor Gate/decision、accepted/rejected claim IDs、acceptor 与 source sequence。Task/Integration acceptance 只接受交付物，不自动发布；Effect approval 只把精确 Intent 标为 authorized，执行结果仍由 Effect Ledger receipt 结算。
_避免使用_：把 Sponsor approve 当 effect committed、一次批准覆盖整个 Run、没有 candidate hash/claim disposition 的验收

**Accepted Source**:
唯一允许 Project Memory projector 消费的不可变输入：Task Acceptance 绑定的原始 Report/Artifact/Evidence、accepted Decision/conflict resolution，以及 Kernel clock/validity fact。Acceptance 必须逐个记录 accepted/rejected claim IDs、acceptor/policy、source event 与 sequence；Task 整体 accepted 不会把所有自由文本自动升级为 verified。消息、discussion、execution_completed、rejected report、Context Digest 与普通 memory upsert 都不是 Accepted Source。
_避免使用_：从最新聊天总结提取项目真相、把模型 confidence 当 acceptance、没有 source sequence 的人工改库

**State Patch**:
由 Accepted Source 针对 versioned Project Memory Schema 确定性生成的声明式事实变更，保存 base state revision、acceptance/report/claim provenance、Evidence refs、`verified | assumed`、validity 与精确 supersedes。Projector 以 Kernel sequence/CAS 幂等应用；冲突产生 disputed，不能按时间或置信度覆盖。
_避免使用_：LLM 直接 upsert Project State、无 schema 的任意 key、Plan revision 自动撤销既有事实

**Task Memory**:
Task accepted 后直接从原始 Task Report 与 Acceptance Record 生成的可重建交接记忆，记录 project/run、Plan/Task revision、accepted claims、decisions/unresolved、Artifact/Evidence refs 与 source hash。其摘要只覆盖明确 accepted claims，不能复制可能包含 rejected claim 的自由文本 summary，也不能再次摘要旧 Task Memory。
_避免使用_：Task 完成即写长期记忆、摘要的摘要、清理后只剩无 provenance 文本

**Project State Memory**:
由 Accepted Source 派生的版本化 Project Fact 与 Current State Snapshot。Fact 标记 `verified | assumed | disputed | stale`：不同 accepted values 进入 disputed；只有 accepted resolution 或 accepted rework 的精确 supersedes 才将旧事实置 stale；assumption 可由持久化 validity event 过期。Snapshot 是可丢弃 cache，必须按 source sequence 从 accepted sources 重建一致结果，不能成为下一轮摘要 source。它与普通 chat 的 Session/Semantic Memory 分离。
_避免使用_：反复摘要旧摘要、把 execution_completed 写成项目事实、清理 Journal/Artifact、无来源的长期记忆

**Execution Context Release**:
仅在 Task Memory 创建与 State Patch 投影成功后发生的资源回收点。允许驱逐 hot prompt、临时 tool trace 与工作 buffer；必须保留 Kernel Journal、Acceptance、Task Memory、Artifact/Evidence、workspace checkpoint 与审计记录。后续按 Project State/Task Memory refs 召回并重新授权 Evidence，而不是恢复整段旧 transcript。
_避免使用_：验收前清理、删除重建 source、把释放上下文解释为删除工作产物

**RunEvent**:
Run/Task 的只追加事件流，供快照与投影消费。
_避免使用_：log line、debug 输出

**Projection**:
从 Kernel 状态派生的只读视图（Console API、REST、IM 进度文案）。
_避免使用_：dispatcher 内存缓存、recordResult

**Agent Workroom**:
与一个 **Project** 一一对应、把其多个 **Run** 的协作活动投影给人类参与者的可观察工作空间；可以绑定到真实 IM group/channel，也可以由 Console 展示。它同时是项目记忆、artifact namespace、队列、预算与 policy 的隔离边界，呈现具名 Agent 的当前任务、进度、交接、结论与失败，但不是 Agent 间通信或编排状态的事实源；所有事实仍来自 **WorkroomKernel RunEvent** 与 Runtime Journal。
_避免使用_：Agent 群聊、用 IM 消息驱动 Task 状态、把原始模型 token/tool trace 全量刷进群

**Interaction Space**:
一条完整 canonical conversation address（含 endpoint、parent、thread/topic）在 Agent trigger 前被显式绑定的产品场景：`chat | workroom | sponsor_room`。每个 address 同时最多绑定一种 Space，未绑定时默认 `chat`；切换必须产生 binding revision 与 conversation sequence anchor，anchor 之前的延迟/replay 消息不能按新场景解释。private/group/channel 只是 transport scope，不能决定 Interaction Space。绑定由持久化 Project registry 与当前 operation view 解析，不得依据消息文本、参与人数或模型分类临时猜测。
_避免使用_：群聊即 Workroom、触发词决定空间、Agent 自行判断当前是不是项目群

**Role-bound Execution Envelope**:
Kernel/Host 为每次模型执行签发的不可变身份与 authority，至少包含 `executionRole: orchestrator | executor | reviewer`、project/run/task/assignment、Plan/Task revision、Capability/Policy Snapshot 与 Context Policy version/fact anchor。只有 Orchestrator 能消费 Workroom 人类 ingress 和提出 Workflow 变更；Executor/Reviewer 只消费 Kernel Assignment/TaskInputEvent。Envelope 是 Context View、Evidence 下钻、Tool filtering、Task lease 与隔离 workspace 的共同授权输入，不能靠 prompt 自觉遵守，也不能由消息 metadata 伪造。
_避免使用_：所有角色共用主 Turn、system prompt 充当权限、specialist 直接接收普通 Workroom Turn

**Task Input Event**:
Workroom 中定向回复或 `@Agent` 产生的非终态 Workroom Fact，保存 source conversation event、principal/actor、authority decision、intent、target task/assignment、Plan/Task revision、附件 refs 与 `accepted_context | applied_control | rejected | stale` disposition。Executor 只收到目标匹配的 accepted_context（明确标为 untrusted data）与 applied_control；Reviewer 只收到会改变 acceptance contract 的 applied_control；rejected/stale 仅供 Orchestrator routing/audit。它永远不直接启动拥有 Orchestrator authority 的 specialist Turn。
_避免使用_：@Agent 即切换主 binding、把定向消息广播给所有 Agent、绕过 Kernel 启动 specialist

**Project**:
一个长期协作目标及其 Project State Memory、Artifact、Run、调度与 authority policy 的所有者；与 Agent Workroom 一一对应。一个 Project 可按阶段产生多个 Run，但 Run 不得跨 Project，共享群也不得导致项目上下文串线。
_避免使用_：一个 Workroom 多项目、用 session 猜 project、跨项目共享可变 memory

**Workroom Profile**:
Project 的版本化专业配置，精确绑定 Charter revision、Capability Pack digests 与 Project-local Profile Overlay。Run 固定一个 Profile Revision；通用 Kernel 不读取领域名称来改变状态语义。
_避免使用_：每个领域复制 Runtime、把专业知识硬编码进 Kernel、仅靠一段 system prompt 定义领域

**Capability Pack**:
可跨 Project 复用、不可变且 content-addressed 的专业供应物；Profile 只能引用精确 `id/version/digest`。Pack 提供 available capability，不直接向 Agent 或 Assignment 授权。
_避免使用_：一个 Tool 只能属于一个领域、按 Workroom 复制 Tool/Skill、把 integration 或 policy 混成 domain 名称

**Domain Pack**:
声明领域 Glossary、Memory Schema、Agent Definitions 与典型 Workflow Strategies 的 Capability Pack；多个 Domain Pack 可组合，但语义冲突必须显式解决。
_避免使用_：领域专属 Kernel、把外部凭据或审批权放入 Domain Pack

**Competency Pack**:
声明可跨领域复用工作方法与 Skills 的 Capability Pack，例如研究、架构、写作、测试或审核；Skill requirement 不授予 Tool authority。
_避免使用_：复制每个领域的同一 Skill、把 Tool grant 藏在 Skill 文本中

**Integration Pack**:
声明 Tool implementation、外部系统 binding 类型与 operation 的 Capability Pack；被 Profile 选择仍不等于某个 Assignment 已获外部访问权。
_避免使用_：安装即授权、把 credential 写进 Pack、Integration 自己维护 Task 状态

**Policy Pack**:
声明 deny、风险/Reviewer floor、验收与披露约束的 Capability Pack；它可加严 core baseline，不能授予自身放宽安全策略的权力。
_避免使用_：可覆盖 Kernel safety 的配置、Agent 自报 policy、自动审批等同无审批

**Profile Overlay**:
Project-local、随 Profile Revision 固定的专业增量，保存该 Project 的 accepted 术语、可选 Memory field、Workflow 参数与已授权 capability selection。它不会原地修改共享 Capability Pack。
_避免使用_：全局自修改 Pack、从聊天摘要生成权威配置、无 provenance 的 prompt patch

**Profile Revision**:
Workroom Profile 的不可变版本，保存 parent、compiled digest、accepted source refs 与语义化治理结果。激活影响新 Run；rollback 也创建新 Revision，不能删除历史或改写已固定的 Run。
_避免使用_：模型静默改 system prompt、从一次成功自动扩大权限、无法回退的自我修改

**Sponsor Room**:
Sponsor 与 Orchestrator 查看跨 Project 汇报、看板、风险和待审批事项的独立投影空间。它聚合 Project 的只读摘要，并允许明确指向 `projectId/runId/taskId` 的跨项目调度、审批与控制；目标不唯一时只能查询或要求澄清。它不拥有或合并各 Workroom 的 Project State Memory。
_避免使用_：管理群即 Project Workroom、跨项目群聊全文进入 Agent Context、无 projectId 的跨项目状态修改

**Agent Identity Projection**:
把稳定 Agent Definition 与具体 Assignment 身份投影到 Workroom 消息。核心保存 `project/run/task revision/agentDefinitionId/assignmentId/source event IDs`，默认可由一个 Zhin Endpoint 代发并显示逻辑角色；logical alias 由 Project Agent Directory 唯一解析，缺失或重复时必须澄清。多个真实 Bot 账号只是可选 Delivery Projection，不参与 execution role、任务路由、authority、能力或状态判断。
_避免使用_：以 Bot 账号作为 Agent SSOT、靠消息文本前缀反查 Task、多平台强制多账号

**Workroom Projection Outbox**:
把 Kernel observable facts 按 sink policy 转成 IM/Console 展示的持久化队列。Item 保存 idempotency key、source fact IDs/sequence、binding/projection policy version、logical Agent identity、精确 target、payload、attempt 与 Delivery Receipt；Console 保留经 disclosure 的完整 observable timeline，IM 只发送状态、固定窗口 progress digest、milestone、blocker、approval、report 与 conclusion。IM 必须走统一 outbound chain，投递失败/重试/重复不回写 Kernel 状态。
_避免使用_：Kernel 同步等待发群、projector 直调 Adapter、消息发送成功即 Task 完成、用进程内 debounce 丢失重启一致性

**Projection Message Index**:
将成功投递的 platform MessageRef 映射回 projectionId、binding revision、source events 与 project/run/task revision/assignment/agent target 的 durable index。reply 依靠它生成 TaskInput proposal；聚合、多目标、跨 Project 或历史 Assignment 必须澄清或降级为 rework discussion。Endpoint self identity 与此 index 同时用于 projection echo 抑制，用户复制文本或 metadata 不能伪造 provenance。
_避免使用_：解析消息前缀猜 Task、回复旧消息直接 steer 已结束 Assignment、Bot 回声重新触发 Agent

**Run Sponsor**:
发起并监督 **Run** 的人类 principal，拥有查看协作过程以及在授权范围内暂停、纠偏、取消或批准关键决策的产品角色。它不自动等同于 IM 群主，也不把 Sponsor 的工具 authority 委托给任意 Agent。
_避免使用_：老板（契约字段）、session owner、默认继承 master 权限

**Workroom Intent**:
人类消息希望如何影响 **Agent Workroom** 的显式意图：普通 discussion 只贡献上下文；`steer_task`、任务创建、重规划、暂停、取消与批准必须指向具体 Run/Task，并经过 principal policy。普通参与者默认只能讨论和补充信息，只有 **Run Sponsor** 或明确授权角色能改变目标或执行状态；所有结果记录 `principal → intent → run/task → action`。
_避免使用_：把群内每条消息都当指令、按自然语言暗中提升 authority、直接修改 Dispatcher 内存状态

## 调度（Schedule）

**Schedule Tools**:
`schedule_*` 是原生 `AgentToolDefinition`，创建者与 IM notify 目标只从 canonical invocation principal/origin 派生。每组 definitions 闭包绑定当前 generation 的 `ScheduleManager`，禁止模块级“最新 manager”注册表。
_避免使用_：`ZhinTool`/`Message` 第二参数、跨 generation manager lookup、无 IM origin 时静默把 IM notify 降为 silent

**Schedule Execution Plan**:
预演确认后固化的 prompt / tools / skills 快照，经 `addScheduleJob` 持久化到 `schedule-jobs.json`；到点执行时由 **Schedule Execution Domain** 直接解析并装载，完全跳过 deferred snapshot 与 meta tools。
_避免使用_：optimizePrompt、extra 上的 executionPlan

**Schedule Turn**:
`TaskExecutor` 只依赖 `ScheduleTurnPort`；composition root 将任务映射为带 `schedule` execution profile 的 **TurnRequest**，由 generation-owned `AgentRuntime` 获取固定快照并交给唯一 `FullAgentTurnEngine`。该 profile 使用 stateless context、direct capability plan、统一 `TurnToolRuntime`/Journal；没有 synthetic IM 载体，也不继承会话历史或回复能力。输出经 Schedule audit/validation 后再由 `NotificationRouter` 作为独立 delivery operation 投递。
_避免使用_：synthetic Message、ambient scheduleContext、scheduleContext 兼容分支、mutate Message.extra

**Passive Group Context**:
群/频道未触发 Agent 的消息先作为 canonical `ConversationEvent` 持久化；后续 Turn 只读取 `(session cursor, current message sequence]` 的稳定窗口，并在 durable terminal 成功后把 cursor 精确推进到当前消息。窗口不得读取当前消息之后的并发事件，也不得以进程内 buffer、TTL 或 pipeline reset 充当事实源。
_避免使用_：进程内 passive buffer、drain 后丢失事实、提前消费 future event、从 IM Message 重建旁听上下文

## 智能家居（Home Assistant）

**HaHomeBackend**:
Home Assistant REST 客户端：别名解析、读状态、调用服务。当前唯一 smart-home 后端。
_避免使用_：HomeBackend、多 provider 工厂、Native 适配器

**HomeFacade**:
交互式控制门面：别名 + 权限（master / confirmServices）+ 意图方法（turnOn、setBrightness 等）；返回判别联合供 tools 映射。
_避免使用_：在每个 home_* tool 内重复 guard、把鉴权塞进 HaHomeBackend

**Home Tool**:
`home_*` 是原生 `AgentToolDefinition`，只从 canonical `ToolExecutionContext.principal` 读取已认证角色，参数校验后委托 **HomeFacade**。
_避免使用_：旧 `Message` 第二参数、直接调 REST、暴露 entity_id、在 Home 域重新推断平台身份

**HomeStateWatch** / **HaWsTransport**:
可选状态推送：Transport 负责 HA WebSocket 鉴权/订阅/重连；Watch 负责别名过滤、防抖与 NotificationRouter 投递。
_避免使用_：经 HomeFacade 鉴权推送、createEndpointLifecycle 硬套 HA 客户端

**Agent Turn Session Key**:
`resolveAgentTurnSessionKey`（transport + 可选 `pipeline:{runPrefix}:`）为 turn 级 SSOT；Conversation Event cursor / auto-continue depth / persist 共用。
_避免使用_：私有 `resolveTurnSessionKey`、snapshot 与 cell 双轨 key

`agent_sessions` 只持有 origin-neutral session key / epoch / model / status；IM platform、endpoint、scene 仅属于 `ConversationEventStore` 的 IM origin projection。HTTP、A2A、Schedule 与 Internal turn 不得伪造 IM session address。
Session lifecycle 写权威只有 `ContextRepository`；archive 不得再代理后重复调用底层 Store。持久化异常不是 Not Found，入口必须 fail closed。

## 关系

- 插件与文件发现向 **Capability Feature** 写入；**Capability Ingress** 在 Boot（常驻核心）与入站（命中 **Agent Binding** 作用域）把能力装入 **Agent Orchestrator**；回合只读 Orchestrator。
- **ZhinAgent** 通过 **Agent Orchestrator** 发现已装载的 **Tool**、**Skill**、**Subagent** 与 Hook；MCP **声明** 在 **MCPFeature**，generation 激活时连接，入站再按 **Agent Binding** 的 `mcpServers` 过滤；工具以 `${qualifiedServer}__${tool}` 的 owner-qualified 名称并入工具池。
- 主路径 Agent 选用由配置 **Agent Binding**（`agents[].match`）决定；**AgentFeature** 仅提供专长 / **Subagent** 预设。
- **Tool Selection** 在 **Permission Level** 检查后把 **Tool** 转换为 **AgentTool**；装载过滤与 Selection 共用 `platforms` / `scopes` / `permissions`。
- **Tool Runtime** 基于 **Tool Selection** 的结果补充上下文工具，并决定 **Pre-executable Tool** 是走快速路径还是完整 Agent 路径。
- **Skill** 可以在通用相关性过滤前贡献 Tool。
- **Context Budget** 同时约束提示词历史裁剪和底层 `@zhin.js/ai` Agent 配置。
- **Pre-executable Tool** 在主模型回合前产出上下文。
- **Subagent** 使用与父级 Agent Runtime 相同的 Provider 和预算词汇。
- **Schedule Turn** 在 turn-pipeline 中顺序执行 resolve → preload → capture before → rehydrate skills；预演 delta 由 `getLastTurnToolSnapshot` 采集本 turn 新增 tools/skills。
- IM、HTTP、A2A、Schedule 只在 composition root 适配为 **Turn Ingress**；从该边界起，Session、Tool、Policy、Event、Subagent 与 Agent Core 不得读取 IM `Message`、`Plugin`、`Adapter` 或 `$adapter/$endpoint/$channel/$sender` 字段。
- 每个启用 Agent 的 generation 必须在 root resources 提供唯一 `AgentTurnEngine`；`AgentRuntime` 只从当前 turn 所持 snapshot 解析它。缺失时 fail-closed，禁止构造器捕获 runner、进程全局 runner 或跨 generation fallback。
- `DeferredCapabilityPlan` 只消费 generation Tool/Skill descriptors 与 session snapshot；`discover/load_tool/load_skill` 本身也是 turn-owned capability。禁止回退到 classic SkillRegistry、文件读取、ALS active-controller 或一次性暴露全量 schema。
- `PromptController` 直接调度 canonical `TurnEvent` stream；Promise/collector 只是兼容内部调用形态，不得为 streaming ingress 建第二套队列或绕过 steering / supersede / cancellation。
- Prompt contributor 与 PromptController 只消费 canonical platform / session identity；不得接收或保存 IM `Message`。平台 Prompt 仅对 IM origin 生效，其他 origin 不伪造 IM 载体。
- Passive Group Context 只按 canonical session key 记录与 drain；IM adapter 在边界外解析 session、sender 后提交 observation，Session System 不保存 `Message`。
- 入站媒体处理只消费 `TurnMedia[]`；平台 segment / opaque file id 到 canonical media 的投影只存在于 ingress adapter，STT、物化与模型注入不得反向读取 IM `Message`。
- 完整 Agent Core 只依赖必需的 `ToolExecutionAuthority`；policy、approval、journal 与实际执行由每个 Turn 的 authority 独占。Core 禁止自行创建 ToolRuntime，canonical 与 classic 执行不得双审批或双记账。
- Engine 异常、取消或漏发终态时，执行权威必须合成并提交恰好一个 durable terminal fact；未写入 Journal 的 success/failure/cancellation 都不是可公开的 TurnOutcome。
- Tool call/result/denial 是 required facts；其 Journal commit 失败属于 `TurnJournalCommitError`，必须中止模型循环，禁止伪装成可由模型自愈的普通工具结果。
- Conversation append、session touch、metrics 与同步 ReplyPort 都是 terminal 后 projection：只在 durable terminal 提交成功后执行；projection 失败进入独立 diagnostic，不能倒写或伪造 terminal outcome。
- Agent Core 的模型循环只发出 canonical `TurnEvent`，工具 Hook 只接收 `TurnContextView`；不得从 Core 发射旧 Plugin AI lifecycle 事件、注入 `Message`，或在 Core 内做 owner-confirm / Message-shaped 安全判断。
- 同步 IM 回复由 snapshot-bound `ReplyPort` 完成；HTTP 流由 Event Journal projection 完成；主动或延迟投递持久化为 `DeliveryIntent`，以带 `parentTurnId` 的新 operation 执行，不偷偷重新获取 current generation 后冒充原 turn。

## 示例对话

> **开发者：** “我可以直接注册一个模型函数作为 **AgentTool** 吗？”
> **领域专家：** “装配期写入 **ToolFeature**（或 `defineAgentTool` 发现）。**Capability Ingress** 再装入 **Agent Orchestrator**；**Tool Selection** 负责权限检查、上下文注入，以及转换为 **AgentTool**。”

## 已标记歧义

- “tool” 过去同时指 Zhin 运行时工具和 Provider 工具。已决议：**Tool** 是面向 Zhin 的契约；**AgentTool** 是 `@zhin.js/ai` 的契约。
- “maxTokens” 过去混用了生成预算和上下文容量。已决议：**Context Budget** 表示历史/模型窗口；生成限制仍属于模型或 Provider 选项。
- **MCP Client vs Server**：Client（`mcp-client/`）消费外部 MCP 工具；`packages/host/mcp` 为 MCP **Server**（向外暴露 Zhin 工具）。SDK 为可选 peer；已配置 server 激活失败会使候选 generation 整体失败，旧代继续服务。
- **Kernel 唯一权威**：旧 `OrchestrationService`、mutable Repository、`AgentDispatcher`、remote mesh poller 与 Session→Run 隐式创建均已删除。普通 `spawn_task` 只是非 Workroom 子任务；它不能创建或修改 Workroom facts。Workroom 只能由显式 Project-scoped command 驱动。

## 模块化重构（理想蓝图映射）

> SSOT：本文件中的边界、不变量与领域语言。实施采用 breaking replacement：新纵向链闭合即删除旧权威，不保留 adapter、双写、双读、deprecated API 或 fallback。未入库的 prototype/历史计划只提供实验依据，不构成兼容迁移约束。

### 层级边界契约

```
@zhin.js/ai          stream / agentLoop / Context / Memory / Compaction
       ↑ 仅类型与循环，无 Message / Plugin / Endpoint
@zhin.js/agent       TurnIngress / TurnOutcome + 8 理想模块 + Orchestration + Security
       ↑ 不依赖 Message / Plugin / Adapter；副作用仅通过 Turn Ports
zhin.js + hosts      IM / HTTP / A2A / Schedule ingress adapters 与 delivery projections
```

| 理想模块 | 包内路径 | 主要落层 | 与下层关系 |
|----------|----------|----------|------------|
| Agent Core | `src/core/` | agent | **委托** `@zhin.js/ai` `agentLoop`；禁止自有 LLM 迭代（ADR 0009） |
| Tool System | `src/tool/` | agent | 包装 orchestrator + builtin + MCP 生命周期 |
| Session System | `src/session/` | agent | origin-neutral session store + explicit transport-provided `ApprovalPort` |
| Event System | `src/event/` | agent | Agent turn 域事件 + **AgentStreamBus**（per-orchestrator egress）；不替代 Kernel RunEvent 或 plugin `before.*` |
| Skill System | `src/skill/` | agent | 包装 `SkillRegistry` + discovery |
| Memory System | `src/memory/` | agent → port → ai | `MemoryStore` 适配 `ContextRepository`；压缩委托 ai compaction |
| Subagent System | `src/subagent/` | agent | `SubagentSystem` spawn/cancel；`ResultSink` 对接 outbound |
| Context System | `src/context/` | agent | 只读 canonical Turn 的 prompt-assembly / turn-user-message builder 链；IM `Message` 投影仅存在于外层 ingress adapter |
| Workroom Kernel | `src/workroom/` | agent | versioned Journal + pure replay/decision；不并入 Subagent |
| IM 装配 | `basic/cli` Plugin Runtime | composition root | canonical Turn ingress / reply Delivery；不承担 Agent 间通信 |

### 现状 → 理想模块映射

| 理想模块 | 实现路径 | 公开入口 |
|----------|----------|----------|
| Agent Core | `src/core/` | `@zhin.js/agent/core` |
| Tool System | `src/tool/` | `@zhin.js/agent/tool` |
| Session System | `src/session/` | `@zhin.js/agent/session` |
| Event System | `src/event/`（含 `event-emitter.ts`、`session-events.ts`） | `@zhin.js/agent/event` |
| Skill System | `src/skill/`、`orchestrator/skill-registry.ts` | `@zhin.js/agent/skill` |
| Memory System | `src/memory/`、`ContextRepository`（ai） | `@zhin.js/agent/memory` |
| Subagent System | `src/subagent/`、`SubagentSystem` | `@zhin.js/agent/subagent` |
| Context System | `src/context/` | `@zhin.js/agent/context` |
| Prompt | `src/prompt/` | `@zhin.js/agent/prompt` |
| Turn | `src/turn/`（`turn-pipeline`、`turn-complete`） | `@zhin.js/agent/turn` |
| Config | `src/config/` | `@zhin.js/agent/config` |
| Workroom Kernel | `src/workroom/` | 包根 export；Journal / command / read projection 分权 |
| IM 组合 | `src/init/`、`zhin-agent/`（门面） | 包根 export；IM ingress / delivery 在 `basic/cli` |
| Host 契约（包内） | `src/internal/agent-host.ts`、`as-private.ts` | 不对外 export |

各模块 `contracts.ts` 承载蓝图接口并与实现对齐（注明已实现 / 未实现项）；`index.ts` re-export 公开 API。ideal 模块仅依赖 `internal/agent-host` 类型与 `asPrivate()`，不 import `zhin-agent/` 实现。

### 事件总线分工

| 总线 | 职责 |
|------|------|
| **EventSystem**（蓝图，`src/event/`） | Agent turn：`turn_start`、`tool_call`、`chunk`、`turn_end` |
| **ZhinAgentEventEmitter** | 现有 IM 活动反馈订阅方；composition-root adapter 只投影已解析的 Schedule activity address |
| **WorkroomKernel RunEvent** | Run/Task/Assignment 的 versioned Journal 事实流；**不合并** |
| **Runtime Event Journal** | ingress / delivery / failure 的事实源；IM/Console/日志只做投影 |

### ADR 对齐确认（阶段 0）

| ADR | 约束 | 模块化重构符合性 |
|-----|------|------------------|
| [0009](../../../docs/adr/0009-pi-aligned-ai-agent-core.md) | 唯一 LLM 入口 `stream` / `agentLoop` | `AgentCore.runText()` AsyncGenerator + `runTextTurn` collector |
| [0004](../../../docs/adr/0004-normalize-queue-outbound-fields-before-im-send.md) | 出站不得旁路统一 delivery pipeline | ReplyPort / DeliveryPort 是唯一入口；Agent 不直接依赖 Message / Adapter |
| [0027](../../../docs/adr/0027-agent-run-orchestration-kernel.md) | Kernel 为 Run/Task/Assignment 事实 SSOT | 由 `src/workroom/` 的 Journal + replay state machine 实现；无 Dispatcher |
| [0019](../../../docs/adr/0019-install-size-layering.md) | agent 可选 peer、依赖扁平 | 迁移期单包 + 子目录；阶段 5 前不拆 8 个 npm 包 |

**公开 API**：`ZhinAgent` 实现 `config/agent-interfaces.ts` 四接口（`IAgentTurnProcessor` 等）；`@zhin.js/agent` 与 `@zhin.js/agent/config` 均可 import 类型。
