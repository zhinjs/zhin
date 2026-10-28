---
sidebar: false
---

# ADR 0040：受控自我进化——变更草稿、审批生效与重启回报

状态：Proposed

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
- **永远不能改**：P0 A 名单（`node_modules`、lockfile、`.zhin/**`、`.env*` 等）；`ai.agent.toolHardGate`、`ai.agent.execApprovalMode`、`ai.agent.masterShell`、`ai.agent.toolHardGate.imApproval` 等**放松安全**的配置键——补丁里出现这些键直接拒绝，不进审批（「模型不能自解禁」）。
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

- 审批卡走 G6 `ToolApprovalQueue`，类别 `self`，`humanOnly`；同一时间每个发起会话最多 1 个 `pending` 变更。
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

### 7. 审计扩展

新增 `kind`：`self_change`（一次变更的每次状态迁移）。新增 `reason_code`：

| 分组 | 码 |
|---|---|
| 起草 / 试跑 | `change_drafted`、`change_path_forbidden`、`change_config_key_forbidden`、`change_trial_passed`、`change_trial_failed` |
| 审批 | `change_submitted`、`change_approved`、`change_rejected`、`change_expired`、`change_hash_mismatch` |
| 生效 / 恢复 | `change_applied_none`、`change_applied_reload`、`change_restart_requested`、`change_verified`、`change_rolled_back`、`change_failed_emergency_stop`、`change_report_sent`、`change_report_redirected` |

payload 记 `changeId`、文件列表（路径 + 摘要，不含内容）、影响面计划、审批人与渠道；不记文件正文与配置值中的密钥。

### 8. 实现切片（ADR 合入后按序做，每个切片单独 PR）

| 切片 | 内容 |
|---|---|
| A | 变更对象与暂存区：`.zhin/changes/` 存储、状态机、`content_hash`、路径白名单与禁止的配置键、审计 kind / 码 |
| B | `change_draft` 工具与预览：diff 摘要、`InvalidationPlanner` 影响面、配置补丁重载级别 |
| C | 试跑：静态检查、隔离容器内插件测试、sandbox 试跑运行时加载 |
| D | 审批：G6 `self` 卡（禁业务群结算，改投主人私聊）、Console 列表 / 批准 / 驳回 |
| E | 生效与恢复：快照、先落盘、`RootRuntime.reload()` / 受控 exit 75、`recover()`、健康检查、回滚一次、失败急停、原会话回报 |

A → B → C → D → E 依次依赖；E 可先用只含 `none` / `generation` 的变更做集成测试，再补 `process` 重启路径。本 ADR 不含代码。

## 验收标准

1. 主人私聊「加一个 `/ping` 指令回 pong」：Agent 起草 → 试跑通过 → 主人私聊收到带 diff 与「将热重载 1 个插件」的审批卡 → 批准后 `/ping` 立即可用，原会话收到「已生效」。
2. 改一个需重启的配置项：预览标「需要重启」；批准后进程自动重启，回来在原会话说「已生效（已重启）」。
3. 草稿里的指令有语法错误：`trial_failed`，不出审批卡，Agent 收到错误并能修改后重新提交。
4. 补丁试图改 `ai.agent.toolHardGate` 或写 `pnpm-lock.yaml`：直接拒绝，不进审批；bypass / 记住授权 / 主人身份均无效。
5. 生效后健康检查失败：自动回滚并回报「失败，已回滚」；人为制造回滚后仍失败：进入急停、回报主人，不循环重启。
6. 在业务群里由主人发起的变更：审批卡出现在主人私聊，群内不能结算。
7. 生效过程中强杀进程：重启后 `recover()` 接着完成校验或回滚，并完成回报。

## 待 Fin 确认的默认值

- 健康检查窗口 `60` 秒；回滚只自动一次，之后急停。
- 每个发起会话同时最多 1 个待审变更；审批超时 24 小时。
- 可写范围 = 插件约定目录 + 根 `AGENTS.md` + `skills/**`；根配置只能走字段级 `configPatch`。
- 永不可改的配置键：`ai.agent.toolHardGate.*`、`ai.agent.execApprovalMode`、`ai.agent.masterShell`（可按需追加）。
- 业务群发起的变更一律改投主人私聊审批（与 #1051「群内或私聊」的表述不同，按 #1030 定稿「禁业务群自批」）。

## 非目标

- 无人批的生产根目录热改；Agent 拿到 `danger-full-access` 或沙箱外写盘。
- 自动安装 npm 依赖（后置，复用 Console `plugin:install` 事务）。
- 修改 zhin 框架自身（`node_modules` 里的包、`packages/**` 源码）。
- 多个变更的批量 / 事务合并；跨实例下发。
- 变更的可视化编辑器。

## 结果

- 「帮我加个指令 / 改个配置」第一次有了闭环：起草、试跑、一次人批、自动生效、原会话回报。
- 重启不再是失忆：变更记录与回报目标先落盘，崩溃也能接上。
- 失败有上限：回滚一次，仍失败就急停等人，不会把生产实例拖进重启循环。
