---
sidebar: false
---

# ADR 0040：受控自我进化——变更草稿、审批生效与重启回报

状态：Accepted（2026-11-03，Fin 确认默认值，见文末「Fin 已确认的默认值」）

实现：MVP 切片 A–E2 已合入 main（[#1058](https://github.com/zhinjs/zhin/pull/1058) / [#1062](https://github.com/zhinjs/zhin/pull/1062) / [#1064](https://github.com/zhinjs/zhin/pull/1064) / [#1069](https://github.com/zhinjs/zhin/pull/1069) / [#1071](https://github.com/zhinjs/zhin/pull/1071) / [#1072](https://github.com/zhinjs/zhin/pull/1072) / [#1075](https://github.com/zhinjs/zhin/pull/1075) / [#1076](https://github.com/zhinjs/zhin/pull/1076)）；#1051 收口切片 F1 / F2 / F4 / F5 已合入（[#1136](https://github.com/zhinjs/zhin/pull/1136) / [#1131](https://github.com/zhinjs/zhin/pull/1131) / [#1137](https://github.com/zhinjs/zhin/pull/1137) / [#1138](https://github.com/zhinjs/zhin/pull/1138)），F6 为本文与用户文档收口；**F3（Console 详情 / diff 页与 IM 卡 diff 摘录）延后**，不在本 ADR 已交付范围内（见 §8a）。用户向说明见[让 Bot 改自己](../ai/self-change.md)，运行时细节见[默认行为规范](../ai/default-behavior.md)。

关联：[#1051](https://github.com/zhinjs/zhin/issues/1051)（Phase 2C 实现轨）、[#1030](https://github.com/zhinjs/zhin/issues/1030)（产品拍板与 P0 / MVP 方案定稿）。建立在 #1030 P0 之上：宿主配置与硬闸路径未批不可写（[#1041](https://github.com/zhinjs/zhin/pull/1041) / [#1048](https://github.com/zhinjs/zhin/pull/1048)，隔离 shell 只读挂载见 P0-c）；审批复用 ADR 0036 硬闸与 G6 IM 审批通道（[#1021](https://github.com/zhinjs/zhin/pull/1021)）。

## 背景

P0 之后，Agent **不能**未经人批改宿主配置、依赖与指令文件，但也就**只能**被拦下。主人真正想要的是：「你帮我加个指令 / 改个配置」——Agent 起草，主人点一次批准，Bot 自己生效（能热重载就热重载，不能就重启），重启回来在原会话说一句「已生效」或「失败，已回滚」。

现状缺三样：

- **变更没有对象**：Agent 要么直接写文件（现在被硬闸拦），要么只能把补丁贴给人。没有「一组文件改动 + 配置补丁」作为一个可预览、可审批、可回滚的单元。
- **生效没有闭环**：`InvalidationPlanner`（`packages/im/runtime/src/invalidation-planner.ts`）能判定一次改动是 `none` / `generation`（热重载）/ `process`（需重启），`RootRuntime.reload()` 能按计划热重载，exit 75 能受控重启（`basic/cli/src/plugin-runtime/start/process-supervisor.ts`）。但它们只服务于开发态文件监听；生产以 `--no-watch` 启动时没有入口，重启后也没人记得「是谁、为了什么、该回报给谁」。
- **自写代码没有试跑**：Agent 写的新指令 / 插件直接进生产目录，第一次运行就是在真实群里。

Fin 2026-10-27 拍板（#1030 / #1051）：

1. 能触发重启的变更：**批准一次 → 自动重启 → 回到原会话报告**成败。
2. Agent 自写插件 / 指令：**先沙箱 / 工作区试跑，通过后再发布**到生产约定目录。
3. bypass /「记住授权」**不能**放松硬闸或宿主安全配置。

## 决策

### 0. 总原则

1. **变更是一个对象**：一组文件写入 + 配置补丁 = 一个 `change`，整体预览、整体审批、整体生效、整体回滚。没有「批一半」。
2. **批什么就生效什么**：审批绑定变更的 `content_hash`（所有文件内容与补丁的规范化摘要）；批准后内容变了直接拒绝（沿用 ADR 0037 §0.3）。
3. **审批永远是新鲜人批**：`change` 的审批等同 `self` 类硬闸——`humanOnly`，bypass / 自动审核 / 主人自动放行 / 记住授权 / `danger-full-access` 都不能代批。
4. **生效前先落盘**：任何重启之前，先把「变更记录 + 回报目标 + 回滚快照」写进宿主状态，再动手。进程在任何时刻崩溃，下次启动都能接上。
5. **失败只回滚一次**：生效失败自动回滚一次；回滚后仍不健康 → 进控制面急停（ADR 0036 §2 `emergency_stop`），等人处理，不循环重启。
6. **Agent 不碰暂存区**：草稿由宿主写入 `.zhin/changes/`（P0 A 名单，Agent 文件工具与 shell 均不可写），Agent 只能通过工具提交内容。

### 1. 变更对象

宿主状态 `.zhin/changes/<id>/`：

| 文件 | 说明 |
|---|---|
| `change.json` | 元数据：`id`、`status`、`content_hash`、`files[]`（目标路径 + 摘要）、`configPatch`、`plan`、发起人、审批人、`report_target`、时间戳、`error` |
| `files/<目标路径>` | 草稿文件内容（暂存，不在生产目录） |
| `snapshot/<目标路径>` | 生效前的原文件（不存在的记为「原本不存在」），用于回滚 |

状态只前进：`draft` → `trialing` → `ready` → `pending` → `approved` → `applying` → `verifying` → `applied`；旁路 `trial_failed` / `rejected` / `expired` / `rolled_back` / `failed`。

- **可改的范围**（`files[]` 目标路径白名单）：插件约定目录（`commands/`、`middlewares/`、`handlers/`、`tools/`、`components/`、`skills/`、`agents/`，相对项目根或已安装的本地插件根）、根 `AGENTS.md`、`skills/**`。P0 B 名单里的根配置文件**不能**整文件写入，只能经 `configPatch`。
- **永远不能改**：P0 A 名单（`node_modules`、lockfile、`.zhin/**`、`.env*` 等）；`ai.agent.toolHardGate`、`ai.agent.execApprovalMode`、`ai.agent.masterShell`、`ai.agent.toolHardGate.imApproval` 等**放松安全**的配置键——补丁里出现这些键直接拒绝，不进审批（「模型不能自解禁」）。#1051 F2 起，这份名单由宿主 schema 的 `x-zhin-config.security` 标记与集中常量 `SELF_CHANGE_SECURITY_CONFIG_KEYS` 维护（含执行安全 / 执行审批 / 注入防护 / 配额豁免 / 定时安全、`ai.decisions.approval`、`http.token(s)`、`a2a.workroomRemoteExecutors` 等，完整名单见[默认行为规范](../ai/default-behavior.md)），守卫单测保证 schema 标记的键都在拒绝集里；生效前按当前名单再复核一次。
- **本地插件根**（#1051 F1）：「已安装的本地插件根」取当前 generation 源码归属中位于项目内、且真实路径不含 `node_modules` 的插件根；`node_modules` 里的插件不可写。
- **`configPatch`**：沿用 Console `config:patch` 的白名单路径与 `expectedRevision` 语义（字段级，#1030 MVP「字段级配置补丁」在此落地）。
- 依赖安装（`npm` 装插件）不在本期；需要新依赖的变更在预览里标为「需要人工安装」，不自动执行（后置，复用 Console `plugin:install` 事务）。

### 2. 起草与预览

- Agent 工具 `change_draft`（`risk: safe`，只能创建 / 更新自己发起的 `draft`）：入参为文件内容与可选 `configPatch`，宿主校验路径白名单后写入暂存区。
- **预览**由宿主生成，随审批卡一起展示：
  - 每个文件的 diff 摘要（新建 / 修改 / 删除，行数）。
  - **影响面**：把目标路径交给 `InvalidationPlanner.plan()`，得到 `none` / `generation`（列出将热重载的插件子树与能力槽）/ `process`（需重启，附原因）；`configPatch` 按配置项的重载级别并入判断。
  - 试跑结果（§3）。
- 只有 `ready`（试跑通过）的草稿能提交审批。

### 3. 试跑（沙箱 → 发布）

提交前宿主自动试跑，结果写进 `change.json`：

1. **静态检查**（必做）：TypeScript 语法 / 类型检查（strip-types 可加载）、约定目录文件的默认导出形状（`defineCommand` / `defineHandler` / `definePlugin` 等）、`check:plugin` 规则、禁止导入（直调 `bot.$sendMessage`、直接 import `koa` 等现有 harness 检查）。
2. **插件自带测试**（存在即跑）：在 P0-c 的隔离容器里运行，项目只读、暂存区可写、无网络。
3. **沙箱加载**（必做）：在一个只挂 sandbox adapter、无 IM 出站端点的**试跑运行时**里加载草稿后的插件树，确认装配成功（`PluginScopeAssembler` 不抛错）、声明的指令 / 工具可被发现；不调用模型、不连真实平台。

任一失败 → `trial_failed`，错误回给 Agent 修改草稿；不会弹审批卡。试跑通过才进 `ready`。

### 4. 审批

- 审批卡走 G6 `ToolApprovalQueue`，类别 `self`，`humanOnly`；同一时间每个发起会话最多 1 个 `pending` 变更，全实例最多 3 个（#1051 F4）。
- **起草人**（#1051 F4，Q3=B）：只有主人与 `toolHardGate.imApproval.approverIds`；其他人的回合里 `change_draft` 不出现在工具面，被调用也直接拒绝（`change_draft_forbidden`）。
- **无守护进程**（#1051 F1，Q6=A）：没有 `zhin start` 守护进程或以 `--once` 启动时，影响面为 `process` 的变更试跑通过后停在 `ready`、不提交审批（`change_restart_unavailable`）。
- **审批人**：主人（master）与 `toolHardGate.imApproval.approverIds`；渠道为 IM 私聊 / 审批群（G6 `delivery`）或 Console（权限 `ops:approve`）。**不在发起变更的业务群里结算**（#1030 定稿：禁业务群自批），即使发起人是主人——在业务群发起的变更，卡片投递到主人私聊。
- 审批卡展示 §2 预览；批准绑定 `content_hash`；默认 24 小时超时 → `expired`。

### 5. 生效

批准后宿主按顺序执行：

1. 复核 `content_hash` 与 `configPatch.expectedRevision`，不符 → `failed`（`change_hash_mismatch` / 配置冲突），不动任何文件。
2. 写回滚快照 `snapshot/`；把 `status=applying` 与 `report_target`（发起会话的 `ConversationRef` + 发起消息引用）**先落盘**。
3. 把暂存文件写入目标路径，应用 `configPatch`。
4. 按 §2 的影响面：
   - `none`：直接进 §6 校验。
   - `generation`：调用 `RootRuntime.reload()`（与开发态文件监听同一入口；生产 `--no-watch` 也可用）。重载返回需要重启时按 `process` 处理。
   - `process`：`status=verifying` 落盘后受控 exit 75，由进程监督者拉起。

### 6. 校验、回报与恢复

- **健康检查**（热重载后立即、重启后在启动完成时由 `recover()` 执行）：新一代运行时启动成功、变更涉及的插件已装配、无启动期错误；默认在 `60` 秒窗口内完成。
- **成功** → `applied`；在 `report_target` 会话回一句「已生效」（含变更摘要与是否重启）。
- **失败** → 用 `snapshot/` 回滚文件与配置，再按同样方式（热重载或再重启一次）恢复；恢复健康 → `rolled_back`，回报「失败，已回滚」与原因；**回滚后仍不健康** → `failed`，打开控制面 `emergency_stop`，回报到主人私聊与 Console，不再自动重启。
- **`recover()`**：每次启动扫描 `.zhin/changes/` 中 `applying` / `verifying` 的记录，按上面的规则继续；回报目标不可达（会话已不存在、Bot 不在群里）时改投主人私聊。
- 回报消息过控制面与 session-gate；被拦写审计但不影响变更状态。

### 6a. 暂存区清理与磁盘上限

`.zhin/changes/` 是宿主替用户占用的磁盘，必须有界：

- **终态即瘦身**：进入 `applied` / `rolled_back` / `rejected` / `expired` / `trial_failed` 时，立即删除 `files/` 暂存内容；`applied` 在健康检查通过后同时删除 `snapshot/`（已不再需要回滚）。终态只保留 `change.json`（不含文件正文，仅路径与摘要）。
- **元数据保留期**：终态 `change.json` 保留 `14` 天（与决策审计默认保留期一致，ADR 0036），之后删除整个目录；审计行另由 `ai_decision_events` 的保留策略管理，不依赖这里。
- **未完成的草稿**：`draft` / `ready` 超过 `24` 小时未提交、`pending` 超时 `expired`，都按终态清理。
- **`failed`（已急停）例外**：保留 `snapshot/` 与 `files/` 直到人处理（Console 标记已处理或手动回滚），这是排查现场；Console 与急停回报里显示其占用大小。
- **硬上限**：单个变更暂存内容 ≤ `5 MB`、文件数 ≤ `50`；整个 `.zhin/changes/` ≤ `50 MB`。`change_draft` 超限直接拒绝（`change_quota_exceeded`），不先写再删。
- **清理时机**：每次启动 `recover()` 结束后扫一次，之后每 `6` 小时一次；清理只删 `.zhin/changes/` 下、状态与时间都满足条件的目录，删除前校验路径仍在暂存区内（防 symlink 逃逸）。
- 试跑（§3）产生的临时目录放系统临时目录，试跑结束即删，不进 `.zhin/`。

### 7. 审计扩展

新增 `kind`：`self_change`（一次变更的每次状态迁移）。新增 `reason_code`：

| 分组 | 码 |
|---|---|
| 起草 / 试跑 | `change_drafted`、`change_quota_exceeded`、`change_pruned`、`change_path_forbidden`、`change_config_key_forbidden`、`change_trial_passed`、`change_trial_failed` |
| 审批 | `change_submitted`、`change_approved`、`change_rejected`、`change_expired`、`change_hash_mismatch` |
| 起草权限 | `change_draft_forbidden`、`change_pending_cap_reached`（#1051 F4） |
| 生效 / 恢复 | `change_applied_none`、`change_applied_reload`、`change_restart_requested`、`change_verified`、`change_rolled_back`、`change_failed_emergency_stop`、`change_report_sent`、`change_report_redirected`、`change_restart_unavailable`（#1051 F1：无守护进程或以 `--once` 启动，均无法自动重启） |

payload 记 `changeId`、文件列表（路径 + 摘要，不含内容）、影响面计划、审批人与渠道；不记文件正文与配置值中的密钥。

### 8. 实现切片（ADR 合入后按序做，每个切片单独 PR）

| 切片 | 内容 |
|---|---|
| A | 变更对象与暂存区：`.zhin/changes/` 存储、状态机、`content_hash`、路径白名单与禁止的配置键、**清理与磁盘上限（§6a）**、审计 kind / 码 |
| B | `change_draft` 工具与预览：diff 摘要、`InvalidationPlanner` 影响面、配置补丁重载级别 |
| C | 试跑：静态检查、隔离容器内插件测试、sandbox 试跑运行时加载 |
| D | 审批：G6 `self` 卡（禁业务群结算，改投主人私聊）、Console 列表 / 批准 / 驳回 |
| E | 生效与恢复：快照、先落盘、`RootRuntime.reload()` / 受控 exit 75、`recover()`、健康检查、回滚一次、失败急停、原会话回报 |

A → B → C → D → E 依次依赖；E 可先用只含 `none` / `generation` 的变更做集成测试，再补 `process` 重启路径。本 ADR 不含代码。

### 8a. #1051 收口切片

| 切片 | 内容 | 状态 |
|---|---|---|
| F1 | 本地插件根接线（起草 / 试跑 / 生效共用）；`restartSupported`：无守护进程或 `--once` 时 `process` 变更不提交审批，生效中途需重启则回滚 | 已合入 [#1136](https://github.com/zhinjs/zhin/pull/1136) |
| F2 | 禁改配置键补全：schema `x-zhin-config.security` 标记 + `SELF_CHANGE_SECURITY_CONFIG_KEYS` + 守卫单测；生效前复核 | 已合入 [#1131](https://github.com/zhinjs/zhin/pull/1131) |
| F3 | 审批可见性：Console 详情 RPC 与「自我变更」页（完整 diff）、IM 卡 diff 摘录 | **延后**（Q7=A 方向已定，未实现；按 Q9=A 不阻塞关闭 #1051，如需另开 issue） |
| F4 | 起草权限（主人 + IM 审批人，其他人工具不可见）、全实例待审 ≤ 3 | 已合入 [#1137](https://github.com/zhinjs/zhin/pull/1137) |
| F5 | Q2=B 残留 `approved` 1 小时时限（`resumeApproved`）；脚本化 harness eval（`packages/im/agent/evals/cases/self-change-*.case.ts`，6 例）与 `basic/cli` e2e（假守护进程 exit 75 → recover、回滚、急停、中途被杀、残留 `approved`） | 已合入 [#1138](https://github.com/zhinjs/zhin/pull/1138) |
| F6 | ADR 转 Accepted、默认值表、默认行为规范与用户文档 | 本次 |

## 验收标准

1. 主人私聊「加一个 `/ping` 指令回 pong」：Agent 起草 → 试跑通过 → 主人私聊收到带 diff 与「将热重载 1 个插件」的审批卡 → 批准后 `/ping` 立即可用，原会话收到「已生效」。
2. 改一个需重启的配置项：预览标「需要重启」；批准后进程自动重启，回来在原会话说「已生效（已重启）」。
3. 草稿里的指令有语法错误：`trial_failed`，不出审批卡，Agent 收到错误并能修改后重新提交。
4. 补丁试图改 `ai.agent.toolHardGate` 或写 `pnpm-lock.yaml`：直接拒绝，不进审批；bypass / 记住授权 / 主人身份均无效。
5. 生效后健康检查失败：自动回滚并回报「失败，已回滚」；人为制造回滚后仍失败：进入急停、回报主人，不循环重启。
6. 在业务群里由主人发起的变更：审批卡出现在主人私聊，群内不能结算。
7. 变更终态后 `.zhin/changes/<id>/` 只剩 `change.json`，14 天后整个目录消失；超过配额的草稿被拒绝。
8. 生效过程中强杀进程：重启后 `recover()` 接着完成校验或回滚，并完成回报。

## Fin 已确认的默认值

2026-11-03 经 Fin 确认（#1051 Q1–Q9）。Q1 = 除下表 Q2 / Q3 / Q4 另行拍板外，当时 ADR 与实现中的默认值全部按现值接受。

| 编号 | 事项 | 确认的默认值 | 落地 |
|---|---|---|---|
| Q1 | 暂存清理与配额 | 终态删 `files/` 与 `snapshot/`、元数据留 14 天；`draft` / `ready` / `pending` 闲置 24 小时 `expired`；单变更 ≤ 5 MB / 50 个文件，总量 ≤ 50 MB；启动后与每 6 小时清理 | 切片 A |
| Q1 | 草稿与试跑 | 配置值以 `value_json` 传；已试跑的变更不能再改，修正需重新起草；插件测试镜像 `node:22-bookworm-slim`（不联网拉取）、1 GB / 1 CPU / 256 进程 / 120 秒 | 切片 B / C |
| Q1 | 审批 | 每个发起会话最多 1 个待审，已有待审时不起草新变更；审批超时 24 小时；卡片**总是**投主人私聊（不受 `imApproval.enabled` 限制），业务群发起的也一样，业务群内不能结算 | 切片 D |
| Q1 | 生效与恢复 | 健康检查窗口 60 秒；只自动回滚一次，之后急停；`content_hash` 不符 → `failed` 且不急停、不动文件；`applying` 中途被杀一律按快照回滚；急停回报不受控制面拦截，回报不可达改投主人私聊 | 切片 E1 / E2 |
| Q2 | 启动时残留的 `approved` | **B**：批准后 1 小时内的自动生效；更早的转 `expired`、不动文件，并私聊主人「批准已过期，请重新起草」 | F5（`SelfChangeApplier.resumeApproved`，#1138） |
| Q3 | 谁能起草 | **B**：只有主人与 `toolHardGate.imApproval.approverIds`；其他人工具不可见，调用即拒（`change_draft_forbidden`）；另加全实例待审 ≤ 3 | F4 |
| Q4 | 试跑 `skipped` | **A**：不阻断；审批卡的试跑结论标出被跳过的检查（当前为「通过 (N skipped)」计数，逐项结论在 `change.json` 的 `trial`） | 切片 C / D |
| Q5 | 禁改配置键 | **B**：首批安全键全部纳入，经 schema `x-zhin-config.security` 标记 + 守卫单测维护 | F2 |
| Q6 | 无守护进程时的 `process` 变更 | **A**：不提交审批，告知本实例无法自动生效（`change_restart_unavailable`） | F1 |
| Q7 | 审批可见性 | **A**：Console 详情页看完整 diff + IM 卡 ≤ 40 行摘录——**F3 延后，尚未实现**；目前卡片只含路径、增删行数、配置路径、影响面与试跑结论 | F3（延后） |
| Q8 | 「发布另一步」 | **A**：试跑通过 → 一次人批 → 写入生产即发布，不设第二道审批；新建本地插件包（新 `package.json` + 入口）不在本期 | — |
| Q9 | 何时关 #1051 | **A**：F1 + F2 + F4 + F5 合入并完成本文档收口（F6）后关闭；F3 如需另开 issue | F6 |

可写范围（插件约定目录 + 根 `AGENTS.md` + `skills/**`，根配置只能走字段级 `configPatch`）与「业务群发起改投主人私聊」按上文 §1 / §4 维持不变。

## 非目标

- 无人批的生产根目录热改；Agent 拿到 `danger-full-access` 或沙箱外写盘。
- 自动安装 npm 依赖（后置，复用 Console `plugin:install` 事务）。
- 修改 zhin 框架自身（`node_modules` 里的包、`packages/**` 源码）。
- 多个变更的批量 / 事务合并；跨实例下发。
- 变更的可视化编辑器。
- 新建本地插件包（Q8）；Console 详情 / diff 审批页（F3，延后，非永久非目标）。

## 结果

- 「帮我加个指令 / 改个配置」第一次有了闭环：起草、试跑、一次人批、自动生效、原会话回报。
- 重启不再是失忆：变更记录与回报目标先落盘，崩溃也能接上。
- 失败有上限：回滚一次，仍失败就急停等人，不会把生产实例拖进重启循环。
