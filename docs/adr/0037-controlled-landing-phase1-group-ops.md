---
sidebar: false
---

# ADR 0037：受控落地第 1 期——群运营闭环

状态：Proposed

关联：[#1009](https://github.com/zhinjs/zhin/issues/1009)；建立在 [ADR 0036](./0036-controlled-landing-phase0.md)（第 0 期，[#999](https://github.com/zhinjs/zhin/pull/999)）之上。前置均已合入 main：[#1001](https://github.com/zhinjs/zhin/pull/1001) 审计 schema、[#1003](https://github.com/zhinjs/zhin/pull/1003) 写路径埋点、[#1005](https://github.com/zhinjs/zhin/pull/1005) + console#34 决策回放、[#1008](https://github.com/zhinjs/zhin/pull/1008) 控制面四开关、[#1006](https://github.com/zhinjs/zhin/pull/1006) 危险工具硬闸、[#995](https://github.com/zhinjs/zhin/pull/995) 会话画像 / session-gate、[#997](https://github.com/zhinjs/zhin/pull/997) scene event 唤醒

## 背景

第 0 期让 Bot 的每个决定可解释、可一键止损、危险动作不批不做。第 1 期在这块地基上做**一个社团群真正用得上的运营闭环**：新人进群有人欢迎、活动到点有人提醒、公告由人批了再发、群管动作有人审且不会被连点。

现状的问题：

- 欢迎新人只能靠模型临场发挥（`turn-envelope` 里的「welcome a newcomer」提示），没有模板、不能预览、不能关。
- 发公告只有 `send_group_notice` 这类危险工具，模型起草即提交审批；没有「草稿 → 人改 → 人批 → 发送」的流程，失败后也没有结论。
- 群里冷场时，旁听仍会一条条判定，ambient 一直拒绝却持续消耗判定预算。
- 现有 `schedule-manager` 是 cron 型任务（面向助手 / 订阅），没有「某会话某天几点有个活动，提前 N 分钟提醒」的会话级事件。
- 踢 / 禁 / 改名片已经走硬闸审批卡，但同一会话可以被反复触发同一动作，审批卡会刷屏。

第 1 期只做这三块：**运营剧本、日程、群管协同**。所有对外发送仍先过控制面（ADR 0036 §2）与 session-gate（#995），全部决定写 `ai_decision_events`。

## 决策

### 0. 总原则

1. **模板优先，模型可选**：欢迎、退群记录、日程提醒默认走模板渲染，不调模型；需要模型润色的留作后续开关，默认关。
2. **出站一律过闸**：任何本期新增的出站都按 `control_gate → speak_gate → 发送` 的顺序判定，被拦即 `skip` 并写审计，不排队补发。
3. **人批的东西，发什么就是什么**：审批绑定内容摘要（`content_hash`），审批后内容变了必须重新审批。
4. **失败不盲重试**：发送失败写 `outcome=error` 的审计并把对象置为失败态；只允许运营者在 Console 手动「重发」，重发是一次新的、需写审计的人工动作。
5. **枚举只追加**：新增 `kind` 与 `reason_code` 进 `decision-events.ts` 的集中码表并配测试；不拼临时字符串当码（沿用 ADR 0036 §1 规则）。
6. **默认全关**：本期所有能力按会话显式开启；实例级只提供默认模板与默认参数。

### 1. 运营剧本

#### 1.1 入群欢迎 / 退群记录

配置挂在会话配置上（按 `platform + scene_id`，与会话画像 `sceneKey` 同口径），不写进 `ai_session_profiles` 的画像字段（画像是观测结果，配置是运营意图，分开存放）：

| 字段 | 说明 | 默认 |
|---|---|---|
| `welcome.enabled` | 是否发送欢迎 | `false` |
| `welcome.template` | 模板文本，变量见下 | 实例默认模板 |
| `welcome.mergeWindowMs` | 窗口内多人入群合并为一条欢迎 | `60000` |
| `welcome.maxPerHour` | 每会话每小时欢迎条数上限 | `10` |
| `leave.record` | 退群是否写审计 | `true`（只写审计，不发消息） |
| `leave.notify` | 退群是否在群里发消息 | `false` |

- 模板变量白名单：`{members}`（@ 新成员，合并时为列表）、`{nickname}`、`{group}`、`{rules_url}`；未知变量原样保留并在预览里标红，不报错。
- **预览**：Console 提供「预览」按钮，用最近一次真实入群事件（无则用示例成员）渲染，不发送，不写审计。
- **发送**：入群事件 → 合并窗口 → 渲染 → 控制面 → session-gate → 出站。被拦写 `skip`；超出 `maxPerHour` 写 `skip` / `welcome_rate_limited`。
- 欢迎不再交给模型临场发挥：会话开启 `welcome.enabled` 后，scene event 唤醒对入群事件（`sub_type=member_increase`）不再触发模型回合，避免双发。未开启的会话行为不变。

#### 1.2 公告：草稿 → 审批 → 发送

新表 `ai_announcements`（每条公告一行，状态只前进）：

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `platform` / `scene_id` | 目标会话 |
| `content` / `content_hash` | 正文与摘要；改正文必须回到 `draft` |
| `status` | `draft` → `pending` → `approved` → `sent`；旁路 `rejected` / `expired` / `failed` |
| `created_by` / `created_via` | 起草人；`console` 或 `model` |
| `approved_by` / `approved_at` | 审批人（Console 用户） |
| `revision` | 乐观并发，与控制面 `expectedRevision` 同约定 |
| `error` | 失败原因（≤ 200 字符） |

- **起草**：运营者在 Console 写；或模型调用新工具 `announcement_draft`（`risk: safe`，只能建草稿，不能提交审批、不能发送）。
- **提交 / 审批**：运营者在 Console 提交为 `pending`，具有审批权限的人批准或驳回。审批默认 24 小时超时 → `expired`。
- **发送**：只在 `approved` 时执行，内部调用平台公告接口。这次调用仍经过硬闸（ADR 0036 §3），但**以该公告的审批记录作为硬闸批准**，不再弹第二张卡；`content_hash` 不符直接拒绝。
- **失败**：写 `kind=announcement`、`outcome=error`、`reason_code=announcement_send_failed`，置 `failed`，**不自动重试**；Console 显示错误与「重发」（需再次具备审批权限，写新审计行）。
- 模型直接调用 `send_group_notice` 等发布类工具的路径保留，但仍受硬闸；运营推荐走草稿流程。

#### 1.3 冷场 → 会话临时 `mention_only`

| 参数 | 说明 | 默认 |
|---|---|---|
| `coldField.enabled` | 是否启用 | `false` |
| `coldField.threshold` | 连续 N 条未 @ Bot 且 ambient 判定为不参与 | `20` |
| `coldField.durationMs` | 临时 `mention_only` 持续时长 | `1800000`（30 分钟） |

- 计数：仅统计群消息；任意一条 @Bot / ambient 参与 / Bot 主动发言都清零。
- 命中后给该会话加一条**临时覆盖** `mention_only`，带 `expires_at`、`actor=policy`，写 `control_change` / `cold_field_mention_only_on`。到期自动撤销，写 `control_change` / `cold_field_mention_only_expired`。
- 临时覆盖与运营者的手动覆盖**分开存放**：只有更严没有更松；运营者手动设置的开关不会被策略撤销；运营者手动关掉 `mention_only` 时同时清除临时覆盖。
- 临时覆盖不进 `control.set` 的 revision（不与运营者写入冲突），但在 `control.get` 返回里可见（标注来源与到期时间）。

### 2. 日程：会话级事件与到点唤醒

新表 `ai_session_events`：

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `platform` / `scene_id` | 所属会话 |
| `title` | ≤ 60 字符 |
| `at` | 事件时间（ms，UTC 存储；展示按实例时区） |
| `remind_before` | 提前提醒偏移数组（ms），如 `[86400000, 3600000]`；空数组 = 只在 `at` 提醒 |
| `template` | 提醒模板，变量 `{title}` `{at}` `{in}`；空用实例默认 |
| `status` | `scheduled` / `done` / `cancelled` |
| `fired` | 已触发的偏移，防重复 |
| `created_by` / `revision` | 同上 |

- 创建：Console 或模型工具 `session_event_create`（`risk: safe`，只能为**当前会话**建事件；修改 / 取消他人建的事件只能在 Console）。
- 调度：复用现有 job-scheduler 的计时基础设施，但领域独立，不写进 `schedule-jobs.json`。
- 到点：按 scene event 风格唤醒——生成一条 `inbound_wake`（`reason_code=schedule_wake_fired`），之后**依次过控制面与 session-gate**；放行则渲染模板发送（默认不调模型），被拦写 `skip` 且该偏移记为已触发，**不补发**。
- 宕机补偿：重启后发现错过的提醒，若晚于 10 分钟（`schedule.graceMs`）则不发，写 `skip` / `schedule_wake_missed`；在宽限内则正常发送。
- 同一会话同一分钟内多个提醒合并为一条。

### 3. 群管协同

- **踢 / 禁 / 改名片**沿用 ADR 0036 切片 E 的硬闸审批卡（`member` 类危险工具），本期不改判定逻辑。改名片（`set_group_card` 等）目前**不在** `CORE_DANGEROUS_TOOLS`（现有 `set_title` 归 `member`，`set_nickname` 归 `identity` 且指 Bot 自身），本期补上改他人群名片类工具，归 `member` 类。
- **审批人 = Console 权限**：审批卡只能由具备相应 Console 权限的用户处理；与 `control:write` 分开，新增权限点（如 `ops:approve`，名称实现时定）。公告审批复用同一权限点。
- **冷却**：同一 `platform + scene_id + 动作`（动作 = 工具本地名，如 `kick_member`）在 `ops.cooldownMs`（默认 `60000`）内只允许一次进入审批；命中冷却**直接 fail closed，不生成新审批卡**，给模型的结果说明「冷却中」，写 `kind=ops_cooldown`、`outcome=deny`、`reason_code=ops_cooldown_hit`，`payload` 记动作、目标、剩余毫秒。
- 冷却计时从**审批卡创建**开始，不论最终批准与否；被驳回的动作同样冷却，避免模型换参数刷卡。
- 冷却判定位于硬闸之前：先冷却、再硬闸，两者审计都写，可在回放里串成一条链。

### 4. 审计扩展

新增 `kind`（追加到 `DECISION_EVENT_KINDS` 末尾）：

| kind | 何时写 |
|---|---|
| `member_lifecycle` | 入群 / 退群事件被记录，以及欢迎是否发送 |
| `announcement` | 公告状态迁移（起草、提交、批准、驳回、过期、发送、失败、重发） |
| `schedule` | 会话日程的创建、修改、取消与到点触发结果 |
| `ops_cooldown` | 群管动作命中或通过冷却 |

冷场临时 `mention_only` 复用已有 `control_change` / `control_gate`，不新增 kind。实际出站仍另写一行 `outbound`，与上表的行共享 `turn_id`（无回合时为本次运营动作生成一个）。

新增 `reason_code`（追加到 `DECISION_REASON_CODES`）：

| 分组 | 码 |
|---|---|
| 欢迎 / 退群 | `welcome_sent`、`welcome_merged`、`welcome_rate_limited`、`welcome_disabled`、`member_leave_recorded` |
| 公告 | `announcement_drafted`、`announcement_submitted`、`announcement_approved`、`announcement_rejected`、`announcement_expired`、`announcement_sent`、`announcement_send_failed`、`announcement_resend`、`announcement_hash_mismatch` |
| 冷场 | `cold_field_mention_only_on`、`cold_field_mention_only_expired`、`cold_field_mention_only_cleared` |
| 日程 | `schedule_event_created`、`schedule_event_updated`、`schedule_event_cancelled`、`schedule_wake_fired`、`schedule_wake_missed`、`schedule_wake_merged` |
| 群管 | `ops_cooldown_hit`、`ops_cooldown_passed` |

被控制面 / session-gate 拦下的情况沿用现有 `control_*` / `cannot_speak_*` 码，不另造。

### 5. Console

本期 Console 只加**运营所需的最小页面 / 区块**：

- 会话运营配置：欢迎 / 退群 / 冷场参数 + 模板预览。
- 公告：草稿列表、编辑、提交、审批、失败重发。
- 日程：会话事件列表、新建、取消。
- 审批卡与冷却状态复用切片 E 已有展示。
- 回放：新 kind 进入现有决策回放过滤器即可（切片 C），不另建页面。

**不做** Console 四开关操作页（见非目标）；四开关的读写仍走切片 D 的 RPC。

### 6. 实现切片（ADR 合入后按序做，每个切片单独 PR）

| 切片 | 内容 |
|---|---|
| A | 欢迎 / 退群：会话运营配置、模板渲染与预览、合并窗口与小时上限、`member_lifecycle` kind 与码、对 `member_increase` 唤醒的去重 |
| B | 公告：`ai_announcements` 表、状态机与 revision、`announcement_draft` 工具、Console 审批、以审批记录作硬闸批准、失败不重试与手动重发 |
| C | 冷场：计数器、临时 `mention_only` 覆盖（`expires_at`、与手动覆盖分存）、`control.get` 展示来源 |
| D | 日程：`ai_session_events` 表、`session_event_create` 工具、调度与到点唤醒、宕机补偿、提醒合并 |
| E | 群管协同：`ops_cooldown` 冷却、`ops:approve` 权限点、改名片补入 `member` 类、审计链对齐 |

A / C / E 互不依赖，可并行；B 依赖 E 的权限点（可先用 `control:write` 占位）；D 独立。本 ADR 不含代码。

## 验收标准（第 1 期）

1. 真实社团群：新人入群后按模板收到欢迎（多人同时入群合并为一条），退群在审计里可查。
2. 建一个活动事件，提前与到点各提醒一次；`muted` / `emergency_stop` 期间到点的提醒不发、不补发，审计可见原因。
3. 公告从起草到发送全程需人批；改动批准后的正文会被拒；发送失败不自动重试且在 Console 可见。
4. 同一会话 60 秒内重复触发同一群管动作只出一张审批卡，其余命中冷却并留审计。
5. 任何一次误操作（误欢迎、误提醒、误发公告、误踢）都能从决策回放按 `turn_id` / 时间定位到触发源、判定链与操作人。

## 待 Fin 确认的默认值

以下按「Proposed 默认」写入，Fin 可在评审时改：

- 冷场阈值 `20` 条、临时 `mention_only` `30` 分钟、默认关闭。
- 欢迎合并窗口 `60` 秒、每小时上限 `10` 条；退群默认只写审计不发消息。
- 公告审批超时 `24` 小时；模型可建草稿但不能提交。
- 日程错过宽限 `10` 分钟；提醒默认模板直发、不调模型。
- 群管冷却 `60` 秒，从审批卡创建起算，驳回也计入。
- 入群 / 退群事件口径：side-event 的 `member_increase` / `member_decrease`。
- 新 kind 走「粗粒度 kind + 细粒度 reason_code」（如 `announcement` + `announcement_approved`），而非每个状态一个 kind。

## 非目标（第 1 期）

- **Console 四开关操作页**（`emergency_stop` / `muted` / `read_only` / `mention_only` 的可视化开关页），暂缓。
- 转人工、B 站评论审核加深、场景包。
- 模型生成欢迎词 / 提醒词（留开关，默认关，本期不实现）。
- 全自动踢人 / 禁言 / 发公告；跨会话批量运营动作；循环日程（RRULE）。

## 结果

- 社团群的欢迎、提醒、公告有了可配、可预览、可审批的确定流程，不再依赖模型临场发挥。
- 冷场时自动降噪，减少无效旁听判定。
- 群管动作有冷却，审批卡不刷屏；每一步都进审计、可回放。
- 代价：新增两张表与若干码；运营配置增加，需要 Console 承载；欢迎与日程依赖平台入群事件与计时器的可靠性。
