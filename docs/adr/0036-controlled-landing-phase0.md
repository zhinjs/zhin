---
sidebar: false
---

# ADR 0036：受控落地第 0 期——决策审计、控制面与危险工具硬闸

状态：Proposed

关联：[#998](https://github.com/zhinjs/zhin/issues/998)；对齐 [#995](https://github.com/zhinjs/zhin/pull/995)（会话画像 / session-gate，已合入）、[#997](https://github.com/zhinjs/zhin/pull/997)（scene event 唤醒，合并中）

## 背景

Bot 已经能旁听、插话、被群事件唤醒、调用管理类工具。问题是运营者答不上三个问题：**它刚才为什么回 / 为什么不回**、**怎么让它立刻闭嘴**、**危险动作会不会在没人批准时执行**。

现状的问题：

- 决策只散落在日志里（`agent_turn_skipped_cannot_speak`、`scene_event_wake_skipped`、`ambient_decision_shadow` 等 `op`），没有结构化记录，不能按回合回放，也不能导出。
- 没有统一的「止损开关」；要让 Bot 安静只能改配置或下线 adapter。
- `execApprovalMode: ask` 只是「问一下」，并不保证危险工具一定拦得住；被拒后结果回灌模型，模型可能换个参数再试。

第 0 期只做这三件事的地基，不加新的对话能力。

## 决策

### 1. 决策审计表 `ai_decision_events`

append-only，只增不改。每一次「进不进模型 / 说不说话 / 调不调工具 / 开关变了」都写一行。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 主键 |
| `ts` | 时间戳（ms） | 事件发生时间 |
| `turn_id` | string | 同一回合内所有事件共享；未进入回合的入站判定也生成一个 `turn_id`，便于按回合串起来 |
| `instance_id` | string | Bot 实例 |
| `platform` | string | 平台，如 `icqq` |
| `scene_id` | string | 与会话画像 `sceneKey` 同口径：`<scope>:<sceneId>`（见 `sceneKeyOf`） |
| `user_id` | string? | 触发者，系统事件可空 |
| `kind` | enum | 见下表 |
| `outcome` | enum | `allow` / `deny` / `skip` / `defer` / `error` |
| `reason_code` | string | 稳定机器码，蛇形小写，只增不改语义（见下） |
| `reason_detail` | string? | 人读补充，≤ 200 字符，超出截断 |
| `payload` | json | 结构化上下文；**不得含密钥、Cookie、token、完整提示词** |
| `actor` | enum | `system` / `model` / `operator` / `policy` |
| `actor_id` | string? | 操作者 id（operator 时必填） |

`kind` 最小集合：

| kind | 何时写 |
|---|---|
| `inbound_wake` | 入站消息或 scene event 尝试唤醒回合 |
| `speak_gate` | 会话画像判定能否在此会话发言（#995） |
| `control_gate` | 控制面四开关拦截 |
| `ambient_decision` | 旁听 / 插话判定结果 |
| `model_skip` | 决定不调用模型 |
| `model_run` | 实际调用模型（记录模型、耗时、是否发言，不记提示词） |
| `tool_call` | 工具调用（普通） |
| `tool_hard_gate` | 危险工具被硬闸拦截 |
| `tool_approval` | 危险工具审批请求 / 通过 / 拒绝 / 超时 |
| `outbound` | 实际出站发送（含失败） |
| `config_change` | 相关配置经 `config:patch` 变更 |
| `control_change` | 控制面开关变更 |

`reason_code` 规则：

- 枚举集中定义在一处（切片 A），新增需加测试；已有码只能弃用，不能改义。
- 未知原因统一 `unknown`，并在 `reason_detail` 说明，禁止临时拼字符串当码。
- 示例：`cannot_speak_muted`、`cannot_speak_muted_all`、`cannot_speak_restricted`、`control_emergency_stop`、`control_muted_instance`、`control_muted_session`、`control_read_only`、`control_mention_only`、`ambient_not_engaged`、`scene_event_nothing_new`、`tool_dangerous_no_approval`、`tool_approval_timeout`、`tool_approval_denied`。

保留与读取：

- 默认保留 14 天，可配置（`ai.audit.retentionDays`）；过期按天批量清理。
- Console 列表默认按 `ts` 倒序；可按 `turn_id` 下钻为时间线；支持按时间范围导出 JSON。
- 审计写失败只记日志，不阻断回合（审计不是门禁）；但硬闸、控制面的**判定本身**不依赖审计写成功。

### 2. 控制面四开关

两级：**实例默认** + **会话覆盖**（按 `platform + scene_id`）。会话覆盖只能比实例更严，不能放宽 `emergency_stop`。

| 开关 | 效果 |
|---|---|
| `emergency_stop` | 不主动出站，危险工具全部拒绝；只保留审计与 Console 可读 |
| `muted` | 不主动发言（含旁听插话、scene event 唤醒）；审计照写；管理类工具仍受硬闸 |
| `read_only` | 不做任何写操作，包括发消息、改群资料、管理动作 |
| `mention_only` | 只有 @Bot 或私聊才进入模型；旁听与 scene event 唤醒直接 skip |

生效顺序（先命中先返回，后面的不再判断）：

```text
emergency_stop → 实例 muted → 会话 muted → read_only → mention_only → 常规 speak / ambient / scene 策略
```

每次被拦截写一行 `kind=control_gate`、`outcome=deny|skip`，`reason_code` 为对应 `control_*`。

API：

- Console RPC `control.get` / `control.set`（或等价的 `config:patch` 白名单 `ai.control.*`，实现时二选一，ADR 不强制）。
- `control.set` 必须带 `expectedRevision`，与 `config:patch` 的 revision 约定一致；revision 不符返回冲突，不覆盖。
- 每次变更写 `kind=control_change`，`actor=operator`，`payload` 记前后值。
- **模型没有任何工具能读写这些开关**。模型不能自我解除禁言、不能关闭 `emergency_stop`。

### 3. 危险工具：硬闸 ≠ ask

- `execApprovalMode: ask` 是交互确认，**不是**硬闸。硬闸独立于它，`bypass` 也不能跳过硬闸。
- 硬闸拒绝 = 本次调用 **fail closed**：不执行；给模型的工具结果只说明「已拒绝，需人工审批」，**不把模型拉回来重试同一危险调用**；写 `kind=tool_hard_gate`。
- 工具注册声明 `risk: 'dangerous' | 'safe'`。插件必须为自己的工具声明 risk；宿主可以把工具**调高**为 dangerous 或要求审批，**不能调低**为免审批。
- `dangerous` 工具执行前查审批队列：无已通过的审批 → 生成 Console 审批卡片（写 `tool_approval`）并 fail closed；审批超时默认拒绝。

危险类别（默认 dangerous）：

| 类别 | 例子 | 默认 |
|---|---|---|
| 成员管理 | 踢人、禁言、设管理员 | 需审批 |
| 内容发布 | 群公告、频道发帖、B 站评论 | 需审批 |
| 资金 | 红包、转账、付款 | **默认禁用**；开启后仍需审批 |
| 身份 | 改 Bot 资料、解绑账号 | 需审批 |
| 只读查询 | 查成员、查群信息 | safe，允许，仍写审计 |

### 4. Console 回放

- 入口在「机器人状态」页。
- 列表：倒序，按平台 / 会话 / `kind` / `outcome` 过滤。
- 时间线：按 `turn_id` 展开一个回合内所有事件。
- 导出：当前筛选结果导出 JSON，字段与表结构一致。

### 5. 与现有实现对齐

- **#995 session-gate**：`observeSessionAndCheckSpeak` 返回 `SpeakBlockReason`（`muted` / `muted_all` / `restricted:*`）时，写 `speak_gate`（`outcome=deny`）+ `model_skip`（`outcome=skip`），`reason_code` 分别映射为 `cannot_speak_muted` / `cannot_speak_muted_all` / `cannot_speak_restricted`（`restricted:` 后缀进 `reason_detail`）。现有日志 `agent_turn_skipped_cannot_speak` 保留。
- **#997 scene event 唤醒**：`scene_event_wake_skipped_cannot_speak` 同样落为 `speak_gate` + `model_skip`，码与上面相同；`nothing_new` → `model_skip` / `scene_event_nothing_new`；`scene_event_wake_deferred` → `inbound_wake` / `defer`；`scene_event_wake_failed` → `inbound_wake` / `error`。#997 仍在合并，埋点（切片 B）等它合入后再对齐，本 ADR 不阻塞于它。
- 控制面判定位于 session-gate **之前**：控制面拦下时不再跑会话画像发言判定和旁听判定。
- `config:patch`：控制面写入沿用 `expectedRevision` 乐观并发；受控路径变更写 `config_change`。

### 6. 实现切片（ADR 合入后按序做）

| 切片 | 内容 |
|---|---|
| A | `ai_decision_events` schema + 迁移 + `reason_code` 枚举 + 序列化 / 截断 / 脱敏测试 |
| B | 写路径埋点：入站唤醒、session-gate、ambient、模型调用、工具、出站 |
| C | Console 回放：列表、`turn_id` 时间线、JSON 导出 |
| D | 控制面：`control.get` / `control.set`、两级合并、生效顺序、`control_change` 审计 |
| E | 危险工具硬闸：`risk` 声明、审批队列与卡片、超时拒绝、fail closed 不重试 |

每个切片单独 PR；本 ADR 不含代码。

## 验收标准（第 0 期）

1. 能解释过去一小时内 Bot 每一次「回了 / 没回」的原因（看审计即可，不翻日志）。
2. 一键 `muted`（或 `emergency_stop`）后，没有任何主动出站。
3. 危险工具在没有审批时执行次数为零。
4. 导出的审计 JSON 能完整还原一个真实回合的决策链。

## 非目标（第 0 期）

- 不做欢迎词脚本、转人工、B 站评论队列（后续阶段）。
- 不做无上限记忆、不允许模型自我解除禁言、不做未绑定的跨平台身份合并、不做全自动踢人 / 禁言 / 发帖。
- 不改现有对话 / 旁听策略本身，只给它们加审计与开关。

## 结果

- 「为什么回 / 不回」从翻日志变成查一张表，并能按回合回放与导出。
- 运营者有统一止损开关，且模型无法绕过。
- 危险工具从「问一下」变为「不批不做」，被拒不会被模型反复重试。
- 代价：每回合多若干行写入；保留期与清理需要运维关注。
