---
sidebar: false
---

# ADR 0039：动态群管规则——批准一次的违规阶梯

状态：Proposed

关联：[#1029](https://github.com/zhinjs/zhin/issues/1029) B 部分（A 部分「连续输入合流」见 [ADR 0038](./0038-continuous-input-merge.md)）。**修订 [ADR 0037](./0037-controlled-landing-phase1-group-ops.md) 的一条非目标**：「全自动踢人 / 禁言」改为「全自动踢人」（见 §7）。依赖 0037 切片 E 的 `ops_cooldown` / `ops:approve`（[#1031](https://github.com/zhinjs/zhin/pull/1031)）与切片 C 的计数器形状（[#1034](https://github.com/zhinjs/zhin/pull/1034)），以及 ADR 0036 硬闸与 G6 IM 审批通道（[#1021](https://github.com/zhinjs/zhin/pull/1021)）。

## 背景

群主想要的是一句话就能立规矩：「有人发广告，先提醒，再犯禁言 10 分钟」「同一句话刷三遍就禁言」。现在做不到：

- **没有「规则」这个对象**。模型临场判断要不要禁言，每一次都过硬闸、弹审批卡，拼不成「批准过的规则自动执行」。
- **唯一的阶梯写死在插件里**：`plugins/utils/content-moderation/src/group-moderation.ts`，固定两类（广告 / 辱骂）、固定三档（提醒 → 警告 → 禁言 600 秒）、固定 30 分钟冷静期，只能按群开关，不能改档位。
- **现有阶梯绕过了硬闸**：它直接调 `management.moderateGroupMember` 禁言，且对入群 10 分钟内发广告的新人**直接踢出、无人审批**。这与 ADR 0036「危险出站动作无人批 = 零执行」不一致，也与本期 Fin 拍板「踢人仍每次审批」冲突。
- **没有反刷屏**：`repeater` 插件是跟着复读，不是检测复读。

Fin 2026-10-27 拍板（#1029 B）：

1. 规则被批准一次后：**禁言自动执行；踢人仍每次审批**。
2. 谁能下发规则：**群主 / 管理员**（不仅 master）。
3. 在哪批：**群内审批卡确认**即可，不必强制 Console。

## 决策

### 0. 总原则

1. **批的是规则，不是某一次处罚**：规则内容（触发、条件、阶梯、时长）绑定 `content_hash`；改一个字都回到草稿、重新审批（沿用 0037 §0.3）。
2. **自动执行只限禁言**：规则批准即视为对「该规则命中时禁言」的**预先人批**；踢人永远是每次新鲜的人批（ADR 0036 `humanOnly`），规则只能「建议踢并出卡」。
3. **自动不等于越闸**：自动禁言照旧过控制面（`emergency_stop` / `read_only` 拦；`muted` 不拦管理动作，同 0036）、`ops_cooldown`、审计；只免掉逐次审批卡。
4. **模型可起草，不能生效**：模型只有 `rule_draft`（`risk: safe`）；提交、批准、停用都是人。
5. **一处阶梯**：content-moderation 的写死阶梯迁成默认规则模板，不保留两套并行逻辑。

### 1. 规则对象

新表 `ai_group_rules`（每条规则一行，状态只前进）：

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `platform` / `scene_id` | 生效会话（只能是群） |
| `trigger` | 违规类型：`advertising` / `abuse` / `flood`（复读刷屏），见 §2 |
| `ladder` | 阶梯数组，每档 `{ action: remind \| warn \| mute \| suggest_kick, durationSec? }`；`mute` 时长 60–86400 秒 |
| `window_ms` | 冷静期：超过此时长无再犯，阶梯归零（默认 `1800000`） |
| `exempt` | 豁免：群主 / 管理员默认豁免；可加白名单 |
| `content` / `content_hash` | 规则的人读摘要与上述字段的规范化摘要 |
| `status` | `draft` → `pending` → `active`；旁路 `rejected` / `expired` / `disabled` |
| `created_by` / `created_via` | 起草人；`im` / `console` / `model` |
| `approved_by` / `approved_at` / `approved_via` | 审批人与渠道（`im` 群内卡 / `console`） |
| `revision` | 乐观并发，与控制面 `expectedRevision` 同约定 |

- 每群每个 `trigger` 同时最多一条 `active`；新规则批准时，旧规则自动 `disabled` 并写审计。
- 每会话每个成员的阶梯进度存在规则运行态（`rule_id + member_id → { stage, lastViolationAt, notifiedAt }`），沿用 content-moderation 现有「已通知前的消息不推进阶梯」的语义。

### 2. 违规类型

| trigger | 判定 | 来源 |
|---|---|---|
| `advertising` | 无请求的商业推广 / 交易招揽 / 拉人去别群 | content-moderation 现有 LLM 审核（`GROUP_REVIEW_RULES`） |
| `abuse` | 辱骂、人身攻击 | 同上 |
| `flood` | **新增**：同一成员在 `flood.windowMs`（默认 `60000`）内发送规范化后相同或高度相似的消息达 `flood.threshold`（默认 `3`）条；纯表情 / 图片按内容摘要计 | 本地判定，不调模型 |

`flood` 只看同一成员自己的重复，不惩罚多人跟着复读（跟复读是群文化，`repeater` 插件那种）。

### 3. 下发与审批

1. **起草**：群主 / 管理员在群里用自然语言说（「以后发广告的先提醒，再犯禁言十分钟」），模型调 `rule_draft` 生成结构化草稿；或在 Console 直接填写。模型调 `rule_draft` 的发起人必须是该群群主 / 管理员（按平台实时角色判定，见 #1044 修复的实时成员查询），否则工具拒绝。
2. **预览**：草稿以卡片形式回到群里，展示「触发 / 每档动作 / 时长 / 冷静期 / 豁免」的人读版本与 `content_hash` 短码。
3. **审批**：群内审批卡由**群主或管理员**确认（不要求是起草人本人；起草人本人确认也算）。审批卡复用 G6 `ToolApprovalQueue` 的结算语义，但审批人集合按本群实时群主 / 管理员计算，并与 `toolHardGate.imApproval.approverIds` 取并集；Console 具有 `ops:approve` 的人也可审批。审批默认 24 小时超时 → `expired`。
4. **生效**：`active` 后立即对新消息生效，不追溯历史消息。
5. **停用**：群主 / 管理员一句话或 Console 即可停用（停用不需要审批，只有更严的方向需要审批；放宽 = 停用后另起新规则）。

### 4. 执行

命中规则时，按当前阶梯档执行：

| 动作 | 执行方式 |
|---|---|
| `remind` / `warn` | 发提醒文案（模板，默认不调模型），过控制面与 session-gate |
| `mute` | **自动执行**：以规则的审批记录作为硬闸批准（同 0037 公告「以审批记录作硬闸批准」），不弹卡；仍先过 `ops_cooldown`，再过控制面 |
| `suggest_kick` | **不自动执行**：生成一张 `member` 类硬闸审批卡（附命中证据与规则引用），每次新鲜人批；同会话同目标沿用 `ops_cooldown` 去重 |

- 被执行人是群主 / 管理员或在豁免名单里 → 不执行，写 `skip`。
- Bot 自身不是管理员 → 不执行，写 `skip` 并在当天首次时提示群主一次。
- 撤回原消息（content-moderation 现有的可选撤回）作为 `remind` / `warn` 档的附加动作保留，属于同一规则批准范围内。

### 5. 迁移 content-moderation

- 现有写死阶梯 → 默认规则模板「广告 / 辱骂：提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟」。
- 已在 `groupModeration` 名单里的群：升级后**不自动生效**，而是生成一条 `pending` 规则等群主 / 管理员确认一次；确认前该群只做提醒 / 警告，不禁言。
- **新人发广告直接踢**：改为 `suggest_kick`（出审批卡），不再无人审批踢人。这是一次有意的行为收紧，写进 changeset 与迁移说明。
- 插件的 LLM 审核、批量复核队列（`group-review-queue.ts` / `group-review-batch.ts`）保留，只把「判定后做什么」交给规则执行器。

### 6. 审计扩展

新增 `kind`（追加到 `DECISION_EVENT_KINDS` 末尾）：

| kind | 何时写 |
|---|---|
| `group_rule` | 规则状态迁移（起草、提交、批准、驳回、过期、停用、被新规则替换） |
| `rule_enforcement` | 一次命中的判定与执行结果 |

新增 `reason_code`：

| 分组 | 码 |
|---|---|
| 规则 | `rule_drafted`、`rule_submitted`、`rule_approved`、`rule_rejected`、`rule_expired`、`rule_disabled`、`rule_superseded`、`rule_hash_mismatch`、`rule_draft_forbidden` |
| 执行 | `rule_hit_remind`、`rule_hit_warn`、`rule_hit_mute`、`rule_hit_kick_suggested`、`rule_hit_exempt`、`rule_hit_bot_not_admin`、`rule_hit_flood` |

实际禁言仍另写 `tool_hard_gate`（`via: rule`、`approvalId = rule_id`）与 `outbound` 行，共享 `turn_id`，回放能从一次禁言追到规则、批准人与命中证据。

### 7. 对 ADR 0037 的修订

0037「非目标」中「全自动踢人 / 禁言 / 发公告」改为「**全自动踢人 / 发公告**」：经群主 / 管理员批准过的规则内，禁言可自动执行。踢人与发公告的人批要求不变。

### 8. 实现切片（ADR 合入后按序做，每个切片单独 PR）

| 切片 | 内容 |
|---|---|
| A | `ai_group_rules` 表、状态机与 revision、`content_hash` 规范化、审计 kind / 码 |
| B | `rule_draft` 工具、群内预览卡与审批（实时群主 / 管理员审批人集合）、Console 列表 / 停用 |
| C | 规则执行器：阶梯进度、`remind` / `warn` / `mute`（以规则批准作硬闸批准）/ `suggest_kick`（出卡）、豁免与 Bot 非管理员处理 |
| D | `flood` 复读刷屏检测（独立用例） |
| E | content-moderation 迁移：写死阶梯 → 默认模板、待确认规则、新人踢人改出卡 |

A → B → C 有依赖；D 可在 A 之后并行；E 依赖 C。本 ADR 不含代码。

## 验收标准

1. 群主在群里说「发广告的先提醒，再犯禁言十分钟」：Bot 回预览卡；管理员点确认后规则生效；审计 `rule_drafted → rule_submitted → rule_approved`。
2. 普通成员说同样的话：`rule_draft` 拒绝，审计 `rule_draft_forbidden`。
3. 成员第一次发广告收到提醒，第二次被**自动禁言 10 分钟、无审批卡**；回放能从禁言追到规则与批准人。
4. 规则写了 `suggest_kick` 的档：命中时出一张踢人审批卡，未批不踢；60 秒内重复命中只有一张卡。
5. 同一成员 1 分钟内刷同一句话 3 次触发 `flood`；三个人各发一次同一句不触发。
6. `emergency_stop` / `read_only` 期间规则不执行任何动作，审计可见原因。
7. 升级后，原 `groupModeration` 名单里的群在群主确认前只提醒不禁言，新人发广告出卡而非直接踢。

## 待 Fin 确认的默认值

- 冷静期 `30` 分钟；禁言时长范围 60 秒–24 小时。
- `flood`：60 秒内同一成员 3 条相同 / 高度相似。
- 规则审批超时 `24` 小时。
- 停用规则不需要审批（只有更严需要审批）。
- 审批人集合 = 本群实时群主 / 管理员 ∪ `imApproval.approverIds` ∪ Console `ops:approve`。
- 迁移：原 `groupModeration` 群需群主确认一次才恢复自动禁言；新人发广告改为出卡（行为收紧）。

## 非目标

- 规则内全自动踢人；跨群批量规则；规则对历史消息追溯。
- 任意「触发 → 条件 → 动作」的通用编排、Console 可视化节点编排（后置）。
- 模型自行判定新的违规类型并执行（只支持 §2 列出的 trigger）。
- 弹幕平台的规则执行（直播间管理走评论审核，见 #971）。

## 结果

- 群主一句话立规矩，批准一次就生效，禁言不再每次弹卡。
- 踢人始终是人拍板；现有「新人发广告直接踢」的无人审批路径被收口。
- 违规阶梯从写死的插件逻辑变成按群可配、可审计、可回放的规则对象。
