---
sidebar: false
---

# ADR 0061：每条入站消息都有结局与原因——消灭静默失败

状态：已接受（Accepted，2026-11-14）。所有者决定：「未决问题」全部按推荐处理，见文末「决定」；另增一条与 ADR 0062 共同的决定（IM 回合审批接入 `ToolApprovalQueue`，§5.1）。

关联：ADR 0008（`conversation_events` 是会话事件的权威表）、ADR 0019（安装体积分层：默认安装不含 `@zhin.js/agent`）、ADR 0036（决策审计 `ai_decision_events` 与 Console 决策回放）、ADR 0038（连续输入合流）、ADR 0048（Agent Harness：Mailbox 准入）、ADR 0049（Console 权限映射）、ADR 0050 / 0055（功能开关：被关掉的插件的命令“在这里不存在”）、ADR 0056（聊天角色 `owner` / `admin` / `trusted`）、[ADR 0062](./0062-one-path-per-task.md)（每件事只留一条路；R4 与本 ADR §5.1 的审批队列共同决定）。来源：issue zhinjs/zhin#1250 中“没反应、看不出原因”一类反馈（命令错误被吞、`Internal error`、审批被拒却说成功、模型请求挂起无日志、插话不说话看不出原因、定时任务静默不触发、`unaddressed-message-no-record`、`inbound-media-reject-reason-opaque`、`reminder-confirm-captures-chat` 等）。

所有者的目标：**每一个“没反应”都要有一句人话原因，在聊天里或决策回放里能查到。**

## 背景

### 1. 入站全链路与现有的记录

一条消息从适配器进来，按顺序经过下面这些环节（以本分支代码为准）。右栏是这一步**今天**留下的痕迹：

| 环节 | 代码 | 可能的去向 | 现有记录 |
| --- | --- | --- | --- |
| 适配器发出 | `plugins/adapters/*/src`，`events.emit('message.receive')` | 14 处 `void …emit(…)` 不接结果（discord 4、qq 4、slack 3、github 1、lark 1、wecom 1） | 下游抛错时只剩一条无上下文的 `unhandledRejection`（`packages/im/zhin/src/instance/start-command.ts:173`） |
| 入站准入 | `packages/im/core/src/plugin-runtime/im/inbound-runtime.ts` `#receiveMessage` | 自身回声 `self_echo`、场地未就绪 `venue_unready`、跨端点去重 `duplicate` / `dedup_error`、成员机器人 / 同伴机器人 `bot_origin` | `RuntimeMessageDiagnostics`（进程内，15 分钟，500 条）的 `route`；`venue_unready` **不写诊断**，只有 warn |
| 交互态 | 同上，`inboundClaim` / `interactions.resolveClaim` | 被等待中的提问（`prompt` / 确认）当作回答吃掉 | 诊断 `route: interaction`；不说明被哪个提问吃掉 |
| 中间件 | `inbound-spine.ts` `runInboundMiddlewareAndSpine` | `stop` / `replace` | 诊断 `middleware stopped/replaced` |
| 事件处理器 | `dispatchInboundHandlers` | 处理器回复或抛错 | 抛错直接冒泡（见上） |
| 命令分发 | `message-dispatcher.ts`、`@zhin.js/command` `CommandIndex.dispatch` | 前缀不符、空输入、命令表不可用（插件被功能开关关掉）、未匹配、`invalid` / `denied` / `limited` / `executed` | 诊断 `dispatchStatus`；`invalid` / `denied` / `limited` 有内置反馈文案（`command-feedback.ts`）；执行抛错**不回复**，冒泡 |
| Agent 入口 | `packages/im/agent/src/plugin-runtime/ingress/unified-mailbox-spine.ts` `route` | 非人类来源直接 `return false`；管理命令；控制面拦截；会话画像不能发言；不在插话群；旁听判定不插话；`/clear`；`stop`；Mailbox 合流 / 拒绝；模型回合 | `ai_decision_events`（ADR 0036），但只覆盖“进入 Agent 之后、且被判定为 `im` 来源”的分支；前几个分支什么都不写 |
| 插话判定 | `ingress-ambient-stage.ts` `considerAmbientEngagement` | `:137`（非群 / 无序号）、`:140`（空文本 / 触发关闭 / 忽略前缀）、`:141`（**不在 `ai.trigger.ambient.conversations` 里**）直接 `return null` | **无任何记录**（`unaddressed-message-no-record`）；进入判定之后才写 `ambient_decision` + `model_skip` |
| 场景事件 | `scene-event-ingress.ts:333` `enabledFor` | 不在 `sceneEvents` / `ambient` 名单 → 不唤醒 | 无记录 |
| 入站媒体 | `packages/im/agent/src/turn/inbound-media.ts:151`、`media/media-normalize.ts:245-270` | 大小超限、路径未授权、URL 未授权、下载失败、类型不符：每个分支 `continue` | 只有一条 `inbound_media_rejected reason=media_validation_failed`，不分原因、不带场景 |
| 模型回合 | `ingress-turn-runner.ts`、`full-agent-turn-engine.ts`、`@zhin.js/ai` `provider-resilience.ts` | 完成（可能空输出）、取消、被新消息顶替、预算耗尽、模型失败（`ProviderErrorKind`） | `model_run` 审计 + turn trace（`data/agent-traces/`）；**空输出只有 debug 日志**（`ingress-outbound.ts:405`） |
| 工具与审批 | `packages/im/agent/src/tool/turn-tool-runtime.ts` | 硬闸、需要审批但无通道、被拒、超时、执行失败 | `tool_hard_gate` / `tool_approval` 审计；模型可能仍然“说成功” |
| 出站 | `Message.$reply` → `OutboundRenderer` → 出站中间件 → Endpoint | 已发送、被控制面抑制、陈旧回复被丢弃、发送失败 | 诊断 `deliveries`；`outbound` 审计（仅 Agent 回合） |
| 回合失败兜底 | `ingress-outbound.ts` `handleIngressTurnFailure` | 回一句失败话术 | 话术发送失败时 `:461` `/* ignore reply failure */` |

非消息入口：

| 入口 | 代码 | 静默去向 | 现有记录 |
| --- | --- | --- | --- |
| 助手定时任务 | `packages/im/agent/src/assistant/timer-scheduler.ts` | `:232-233` 任务不存在 / 已停用 / 类型不对直接 `return`；空心跳只记 debug；失败通知发送失败 `:256` `.catch(() => {})` | `ScheduleExecutionHistory`（只有真的跑了才有一行） |
| 插件定时任务 | `packages/im/schedule-feature/src/schedule-index.ts` → `@zhin.js/kernel` `ScheduleEngine` | `execute` 抛错只进 `onError` 日志 | 无运行记录 |
| 会话日程唤醒 | `ingress/session-event-dispatch.ts` | `schedule_wake_missed` / `merged` | 决策审计 |
| notice / request / system | `inbound-runtime.ts` `#receiveCanonicalEndpointEvent` | 处理器抛错冒泡 | 无 |

### 2. 问题归纳

1. **没有“终点”**：诊断记录有 `route` 但没有“结局”；决策审计是很多行“过程”，没有一行说“这条消息最后怎么了”；两者都不覆盖对方的分支。Console 文档（`docs/console/index.md:133`）说决策回放记录“每次回或不回”，实际上没被 @ 的群消息、没进 Agent 的命令消息、媒体被拒、交互态吞掉的消息都不在里面。
2. **异常没有归属**：命令 / 处理器抛错一路冒泡到适配器的 `void emit`，最后是没有会话、没有消息 ID 的 `unhandledRejection` 日志；用户看到的是沉默。
3. **静默分支不写原因**：`venue_unready`、`dedup_error`（失败关闭，整条消息丢弃）、不在插话群、空模型输出、媒体逐项 `continue`、定时任务提前 `return`。
4. **吞异常是被允许的**：`eslint.config.mjs:59` 是 `'no-empty': ['error', { allowEmptyCatch: true }]`。全仓（`basic/`、`packages/`、`plugins/` 的非测试源码）现有 **603** 处吞异常写法：12 处空 `catch {}`、323 处只有注释的 `catch`（其中 94 处只写了 `ignore` 一类）、268 处 `.catch(() => {} | undefined | null | [] | '')`；入站链路相关文件（`core/src/plugin-runtime/im`、`agent/src/{plugin-runtime,tool,outbound,turn,session,core,assistant,schedule-domain}`、`command`、`middleware`、`adapter`、适配器 `endpoint` / `client`）内 **142** 处。大部分是正当的“观察者失败不影响结果”，但没有办法把它们和真正吞掉结局的少数几处分开。

### 3. 最严重的静默点（按影响排序）

| # | 位置 | 现象 |
| --- | --- | --- |
| 1 | `packages/im/command/src/command-index.ts:418-430`（执行段只有 `finally`，无 `catch`）+ 适配器 `void emit`（如 `plugins/adapters/qq/src/endpoint.ts:272`） | 命令抛出非预期错误：发起人无回复，日志只有无上下文的 `unhandledRejection` |
| 2 | `packages/im/core/src/plugin-runtime/im/inbound-dedup.ts:370-376` → `inbound-runtime.ts:352` | 去重存储出错时失败关闭，整条消息只记录不处理，只有 warn |
| 3 | `packages/im/agent/src/plugin-runtime/ingress/ingress-ambient-stage.ts:137-141`、`scene-event-ingress.ts:333` | 不在插话群、未匹配命令的群消息：没有任何记录 |
| 4 | `packages/im/agent/src/plugin-runtime/ingress/ingress-venue-helpers.ts:238`、`:266` | 已 @ 机器人但被控制面 / 会话画像拦下：`halt { handled: true }`，Core 侧记为“已由 Agent 处理”，发起人无回复 |
| 5 | `packages/im/agent/src/media/media-normalize.ts:245-270` → `turn/inbound-media.ts:151-153` | 媒体被拒的五种原因合并成 `media_validation_failed`，无场景、无 URL 主机 |
| 6 | `packages/im/agent/src/plugin-runtime/ingress/ingress-outbound.ts:457-462` | 回合失败后的道歉话术发送失败被吞（`/* ignore reply failure */`），没有出站失败记录 |
| 7 | `packages/im/agent/src/plugin-runtime/ingress/ingress-outbound.ts:400-406` | 模型完成但输出为空：只有 debug 日志，回放里看起来像“成功” |
| 8 | `packages/im/core/src/plugin-runtime/im/inbound-runtime.ts:203-216` | 场地成员未上报 `selfUserId`：消息丢弃，不写诊断 |
| 9 | `packages/im/agent/src/assistant/timer-scheduler.ts:232-237`、`:256` | 定时任务不存在 / 停用 / 空心跳时不留运行记录；失败通知发不出去也不记 |
| 10 | `packages/im/agent/src/plugin-runtime/agent-runtime.ts:449` | turn trace 落盘失败 `.catch(() => undefined)`：事后连“为什么”的证据都没有，也没有 warn |

次一级：`unified-mailbox-spine.ts:595`（非人类来源直接 `return false`，无原因）；`control-gate.ts:28-33`（判定异常失败关闭为 `emergency_stop`，聊天里无提示）；`ambient-engagement.ts:382`（读最近消息失败被记成 `no_context`，真实原因丢失）；交互态 `inbound-runtime.ts:382-389`（等待确认时吞掉群里任意一句话，`reminder-confirm-captures-chat`）。

### 4. 已在进行中的相关改动（#1250 批次 PR，本 ADR 接受时均未合并）

本 ADR 只依赖下表“行为”一列描述的语义，不依赖这些 PR 的具体代码；某个 PR 改名或拆分时，以这里写下的判定标准为准。

| 来源 | 行为 |
| --- | --- |
| #1250 第 2 批（聊天）PR | **`UserFacingError`**：命令执行时抛出的“预期拒绝”（插件明确声明可以原样给用户看的错误，如“这个群没有开启抽奖”）转成一句回复发给发起人，不再冒泡成无上下文的异常；其他异常仍是内部错误。**近似命令提示**：一条点名消息（见 §1 定义）去掉命令前缀后没有匹配到任何命令时，回一句“没有这条指令，你是不是想用 …”；非点名的群聊不提示；回复走普通入站回复路径。turn trace 记 `trigger`（触发消息 ID、等待时长） |
| #1250 批次 PR（定时任务） | `UserFacingError` 同样适用于入站中间件与事件处理器；定时任务显示下次运行时间；无法排期的任务进「需要你处理」（`schedule.unschedulable`）；保存时校验投递目标 |
| zhinjs/zhin#1256（CLI 第 1 批） | Console API 的预期失败返回结构化错误码，非预期失败只返回 `errorId`（`err_` + 12 位十六进制，`instance/console/internal-error.ts` 的 `createErrorId`），详情只进日志；Console 发送失败按原因分类（`@zhin.js/console-protocol` 新增公开导出 `classifyConsoleSendFailure`、`ConsoleSendFailure`、`CONSOLE_SEND_FAILURE_MESSAGES`）；控制面 / 会话画像 / 旁听写 `model_skip` 时标出所属的决定性事件（`DECISION_PARENT_KEY`），回放可折叠 |
| #1250 批次 PR（Agent 行为） | 工具被拒或没有审批通道时标为“未执行”，回合末如实告诉用户哪一步没做；审批结果 `unavailable { reason: unattended \| no_channel }` 写审计 |
| #1250 批次 PR（模型） | 模型在 `firstResponseTimeoutMs` 内没有任何响应时判为 `no_response`（与请求总超时 `timeout` 区分）；trace 记 `model_timeout` |
| zhinjs/zhin#1254（Host 第 3 批） | Console 发送失败带原因码，`failedDeliveryReceipt` 的文案带码 |

这些改动各自解决了一个点，但用了各自的词汇（`dispatchStatus`、`stage`、`route`、`ChatFailureKind`、`ConsoleSendFailure.reason`、`TurnAdmissionRejectReason`、`reason_code`……），而且没有一个地方能回答“这条消息最后怎么了”。

## 决策

### 1. 结局模型

每条入站消息在处理结束时**恰好得到一个结局**（`MessageOutcome`）。结局由三部分组成：

- `outcome`：有限集合，下表的码之一（蛇形小写，只能追加，弃用不删，同 ADR 0036 的码表规则）。
- `reason`：结局下的细分原因码，同样是封闭集合；能沿用现有码（`DECISION_REASON_CODES`、`ProviderErrorKind`、`ChatFailureKind`、命令 `status`、发送失败码）的一律沿用，不新造同义词。
- `visibility`：谁能看到人话原因——**发起人**（`sender`）、**仅管理员**（`admin`）、**仅回放**（`replay`）。另有 `reply` 字段说明处理时是否在聊天里主动回过一句：`yes`（已回）、`no`（按设计不回）、`throttled`（同一会话 60 秒内最多主动说明一次，其余只记录）。

一条消息可能先后触发多个结局候选（例如工具被拒后模型仍然回了话，回话又发送失败）。最终结局按**优先级**取最高者，其余作为 `facets` 附带（例如 `replied` + `facets: ['tool_not_executed']`）。优先级从高到低：

`internal_error` > `delivery_failed` > `model_timeout` / `model_error` / `budget_exhausted` > `approval_denied` / `approval_timeout` / `approval_unavailable` > `tool_failed_reported` > `refused` / `permission_denied` / `rate_limited` / `invalid_input` / `filtered_by_policy` > 回复类 > 静默类 > `unrecorded`。

“被 @ / 私聊 / 使用了命令前缀 / 回复了机器人的消息”称为**点名消息**。判定：私聊消息；群 / 频道消息中 @ 了机器人（`message.mentioned`）、以本会话生效的命令前缀开头（实例顶层或端点逐项覆盖的 `commandPrefix`），或者是对机器人某条消息的回复。近似命令提示（§4 表）只对点名消息生效，用的也是这一判定。原则：**点名消息不得以无人知晓的静默结束**——要么在聊天里回了一句，要么结局的 `visibility` 至少是 `sender`、且原因属于“按设计不能说话”（平台禁言、控制面急停）。

#### 1.1 回复类（`reply: yes`）

| outcome | reason | 可见 | 发起人人话（zh / en） | 管理员补充（zh / en） |
| --- | --- | --- | --- | --- |
| `replied` | `agent` / `agent_merged`（合流后回复） | 发起人 | 已回复。 / Replied. | 由 Agent `{agent}` 回复，回合 `{turnId}`。 / Replied by agent `{agent}`, turn `{turnId}`. |
| `command_replied` | `executed` / `menu` / `help` | 发起人 | 已执行指令 {command}。 / Ran command {command}. | 指令 `{command}`（插件 `{owner}`），耗时 {ms} ms。 / Command `{command}` (plugin `{owner}`) in {ms} ms. |
| `handler_replied` | `middleware` / `handler` | 发起人 | 已由插件处理。 / Handled by a plugin. | 由插件 `{owner}` 的 {stage} 回复。 / Replied by `{owner}` ({stage}). |
| `interaction_answered` | `prompt` / `button` | 发起人 | 已作为对「{prompt}」的回答。 / Taken as your answer to "{prompt}". | 提问方 `{owner}`，提问 `{promptId}`。 / Prompt `{promptId}` by `{owner}`. |
| `suggested` | `near_miss` | 发起人 | 没有这条指令，已提示相近的指令。 / No such command; suggested a close one. | 近似匹配 `{candidates}`。 / Near matches `{candidates}`. |
| `refused` | `user_facing_error` | 发起人 | 插件拒绝了这次请求：{text} / The plugin declined: {text} | `UserFacingError` 来自 `{owner}`。 / `UserFacingError` from `{owner}`. |

#### 1.2 未执行但已在聊天里说明（`reply: yes`）

| outcome | reason | 可见 | 发起人人话 | 管理员补充 |
| --- | --- | --- | --- | --- |
| `invalid_input` | `invalid`（命令参数）| 发起人 | 指令参数不对，已回复用法。 / Wrong arguments; usage was sent. | 校验问题：{issues}。 / Validation: {issues}. |
| `permission_denied` | `denied:<permit 类别>`（`zhin_role` / `platform` / `bot` / `conversation`）| 发起人 | 你没有权限执行这条指令。 / You are not allowed to run this command. | 缺少 `{permit}`。 / Missing `{permit}`. |
| `rate_limited` | `cooldown` / `busy` / `capacity` / `identity`（命令 `limited`）、`queue_full` / `expired`（Mailbox 拒绝）| 发起人 | 太频繁或正忙，这次没有处理，请稍后再试。 / Too frequent or busy; not processed this time. | {reason}，约 {retryAfter} 秒后可重试。 / {reason}; retry after ~{retryAfter}s. |
| `approval_denied` | `tool_approval_denied` | 发起人 | 需要确认的操作被拒绝了，{tool} 没有执行。 / The action needing approval was declined; {tool} did not run. | 审批人 `{approver}`，策略 `{policy}`。 / Declined by `{approver}`, policy `{policy}`. |
| `approval_timeout` | `tool_approval_timeout` | 发起人 | 等确认超时了，{tool} 没有执行。 / Approval timed out; {tool} did not run. | 等待 {seconds} 秒。 / Waited {seconds}s. |
| `approval_unavailable` | `unattended` / `no_channel` | 发起人 | 这个操作需要有人确认，但现在没有可确认的渠道，{tool} 没有执行。 / This action needs approval but no one can approve it here; {tool} did not run. | 策略 `{policy}`，原因 `{reason}`。 / Policy `{policy}`, reason `{reason}`. |
| `tool_failed_reported` | `tool_failed` | 发起人 | 有一步操作失败了（{tool}），回复里已说明。 / A step failed ({tool}); the reply says so. | 错误：{detail}。 / Error: {detail}. |
| `model_timeout` | `no_response` / `request_timeout` / `turn_timeout` | 发起人 | 模型服务没有响应，这次没回上，请稍后再试。 / The model did not respond; please try again later. | `{provider}/{model}` {phase} 超时 {ms} ms（第 {attempt} 次）。 / `{provider}/{model}` {phase} timed out after {ms} ms (attempt {attempt}). |
| `model_error` | `ProviderErrorKind`（`rate_limit` / `server` / `network` / `quota_exhausted` / `billing` / `auth` / `context_overflow` / `safety_block` / `bad_request` / `empty_response` / `malformed_tool_call` / `unknown`）| 发起人 | 沿用 `chatFailureLine` 现有话术（“刚卡了一下……” 等）。 / Existing `chatFailureLine` lines. | 沿用 `chatFailureLine` 的原因括注 + `{provider}/{model}`。 / Same cause as `chatFailureLine` + `{provider}/{model}`. |
| `budget_exhausted` | `budget_exceeded:<budget>` | 发起人 | 这件事步骤太多，做到一半停下了。 / Too many steps; stopped partway. | 超出预算 `{budget}`。 / Budget `{budget}` exceeded. |

`approval_*`、`tool_failed_reported` 要求回合末如实说明（§4 表“Agent 行为”一行）；若模型已在回复中说明，`reply: yes`，`why` 复用同一句。

#### 1.3 按设计不回复（`reply: no`，人话原因只在被问时给出）

| outcome | reason | 可见 | 发起人人话 | 管理员补充 |
| --- | --- | --- | --- | --- |
| `not_addressed` | `no_command_not_ambient`（群消息、未匹配命令、本群不在 `ai.trigger.ambient.conversations`）、`prefix_mismatch`、`empty_input`、`ignored_trigger_prefix`、`trigger_disabled` | 发起人 | 这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。 / You did not mention me and it is not a command; here I only answer when mentioned. | 本群不在插话名单；前缀 `{prefix}`。 / Not an ambient conversation; prefix `{prefix}`. |
| `feature_disabled` | `commands_unavailable` / `plugin_disabled:<plugin>` | 管理员 | 这里没有开启相关功能。 / That feature is not enabled here. | 插件 `{plugin}` 在 {level} 级被关闭（ADR 0050 / 0055）。 / Plugin `{plugin}` disabled at {level}. |
| `ambient_silent` | `ambient_not_engaged` / `cooldown` / `hourly_cap` / `no_context` / `judge_failed` / `superseded` | 发起人 | 我判断这句不需要我插话。 / I decided not to chime in. | 判定 {confidence}，来源 `{source}`，原因 `{reason}`。 / Confidence {confidence}, source `{source}`, `{reason}`. |
| `model_silent` | `empty_output` | 发起人 | 我看了，但这次决定不回复。 / I read it but chose not to reply. | 回合 `{turnId}` 完成但没有输出元素。 / Turn `{turnId}` completed with no output. |
| `merged` | `merge_window_joined` / `danmaku_window_picked` | 发起人 | 和你前后几句合在一起回复了。 / Answered together with your other messages. | 合入回合 `{mergedInto}`。 / Merged into turn `{mergedInto}`. |
| `superseded` | `model_superseded` / `merge_reply_stale_discarded` / `stopped` | 发起人 | 你很快又发了新消息，按新消息处理了。 / You sent a newer message; that one was handled instead. | 被 `{byMessageId}` 顶替。 / Superseded by `{byMessageId}`. |
| `cleared` | `clear_command` | 发起人 | 已清空上下文。 / Context cleared. | — |
| `interaction_consumed` | `prompt_captured`（被等待中的提问当作回答，但发起人不是被问者或内容不像回答）| 发起人 | 刚才在等「{prompt}」的回答，这句被当成了回答。 / I was waiting for an answer to "{prompt}" and took this as it. | 提问方 `{owner}`，提问 `{promptId}`，被问者 `{target}`。 / Prompt `{promptId}` by `{owner}`, asked `{target}`. |

`interaction_consumed` 是 `reminder-confirm-captures-chat` 的结局：P5 起提问方声明“谁的回答算数”（`answeredBy: 'target' | 'anyone'`，默认 `target`），不是被问者的消息不再被吞；同一提问的重复提示最多重发一次（决定 11）。在 P5 之前先记 `interaction_consumed`，至少能用 `why` 查到“被谁的提问吃掉了”。

#### 1.4 被策略过滤（`reply: no`，点名消息为 `throttled`）

| outcome | reason | 可见 | 发起人人话 | 管理员补充 |
| --- | --- | --- | --- | --- |
| `filtered_by_policy` | `control_emergency_stop` / `control_muted_instance` / `control_muted_session` / `control_read_only` / `control_mention_only` | 发起人 | 机器人在本群暂停回复（{switch}）。 / The bot is paused here ({switch}). | 由 `{actor}` 于 {at} 设置，层级 `{level}`。 / Set by `{actor}` at {at}, level `{level}`. |
| `filtered_by_policy` | `cannot_speak_muted` / `cannot_speak_muted_all` / `cannot_speak_restricted` | 发起人 | 机器人在本群被禁言，无法回复。 / The bot is muted here. | 平台状态 `{blocked}`。 / Platform state `{blocked}`. |
| `filtered_by_policy` | `middleware_stopped` | 管理员 | 消息被插件拦下了。 / A plugin stopped this message. | 中间件 `{owner}/{name}`。 / Middleware `{owner}/{name}`. |
| `filtered_by_policy` | `control_gate_failed` | 管理员 | 机器人暂时不可用。 / The bot is temporarily unavailable. | 控制面判定异常，按急停处理：{detail}。 / Control gate failed closed: {detail}. |
| `media_rejected` | `too_large` / `mime_mismatch` / `scheme_unsupported` / `host_not_allowed` / `path_not_allowed` / `fetch_failed` / `unmaterialized_platform_reference` | 发起人 | 你发的{kind}我读不了（{reason 的人话}），只看了文字部分。 / I could not read your {kind} ({reason}); only the text was used. | 场景 `{scene}`，`{scheme}://{host}`，{bytes}/{limit} 字节，期望 `{want}` 实得 `{mime}`。 / Scene `{scene}`, `{scheme}://{host}`, … |

`media_rejected` 通常是 facet：消息仍然得到回复，结局是 `replied` + `facets: ['media_rejected:too_large']`；只有整条消息只有媒体且全部被拒时才是主结局。`normalizeMediaRefsToPayloads` 改为返回逐项结果（`{ ok: false, reason, scheme, host }`），不再 `continue`；URL 只记 scheme 与 host，不记路径与查询串。

#### 1.5 只进回放（`reply: no`，`visibility: replay`）

| outcome | reason | 管理员人话（zh / en） |
| --- | --- | --- |
| `ignored_self` | `self_echo` | 机器人自己发出的消息回显。 / Echo of the bot's own message. |
| `ignored_bot` | `member` / `peer_bot` / `non_human_origin` | 来自其他机器人，只记录。 / From another bot; recorded only. |
| `dropped_duplicate` | `duplicate` | 同一条消息已由另一个端点处理。 / Already handled by another endpoint. |
| `dropped_unready` | `venue_unready` | 场地成员 `{endpoints}` 尚未上报自身 ID，消息未处理。 / Venue members `{endpoints}` not ready. |
| `dropped_dedup_error` | `dedup_error` | 去重存储出错，按失败关闭丢弃：{detail}。 / Dedup store failed closed: {detail}. |
| `dropped_retired` | `generation_retired` / `ingress_closed` | 实例正在重载 / 关闭，消息未被接纳。 / Instance reloading or stopping. |

`dropped_unready` / `dropped_dedup_error` / `dropped_retired` 对点名消息的发起人给出“机器人刚才在重启 / 暂时不可用，请再发一次”（`visibility` 升为 `sender`）。

#### 1.6 失败（`reply: throttled`，点名消息才主动说）

| outcome | reason | 可见 | 发起人人话 | 管理员补充 |
| --- | --- | --- | --- | --- |
| `delivery_failed` | 统一发送失败码（`platform_rejected`、`endpoint_disconnected`、`endpoint_timeout`、`invalid_destination`、`unsupported_media`、`partial_delivery`、`delivery_unconfirmed`……，见 §5 表中发送失败码一行）| 发起人 | 回复已经生成，但发到平台时失败了（{reason 的人话}）。 / The reply was ready but the platform rejected it ({reason}). | 端点 `{endpoint}`，`deliveryUnknown={unknown}`，可重试 `{retryable}`。 |
| `internal_error` | `command_threw` / `handler_threw` / `middleware_threw` / `agent_threw` / `inbound_threw` | 发起人（只给错误号）| 处理时出错了，已记录（错误号 {errorId}）。 / Something went wrong; logged as {errorId}. | `{stage}` 抛出 `{errorName}: {message}`（截断 200 字，脱敏），插件 `{owner}`。 |
| `unrecorded` | `missing_outcome` | 管理员 | 这条消息的处理结果没有记录下来。 / No outcome was recorded. | 最后阶段 `{lastStage}`；这是框架缺陷，请报告。 / Last stage `{lastStage}`; a framework bug. |

`internal_error` 的 `errorId` 与 Console API 的 `err_` + 12 位十六进制同一格式、同一生成函数（zhinjs/zhin#1256 的 `createErrorId`，P1 下移到 `@zhin.js/logger`，见 §5），`zhin logs` 可按它检索。

#### 1.7 定时任务与其他非消息入口

一次**计划触发**（不论是否真正执行）也得到一个结局，记在现有 `ScheduleExecutionHistory` 上（新增 `outcome` / `reason` 列，不另建表）：

| outcome | reason | 人话（管理员 / 任务创建者） |
| --- | --- | --- |
| `ran_delivered` | — | 已执行并发送到 {target}。 / Ran and delivered to {target}. |
| `ran_silent` | `notify_silent` / `notify_log` / `empty_output` | 已执行，按设置不发送。 / Ran; delivery is off by setting. |
| `skipped` | `disabled` / `missing` / `idle_heartbeat` / `not_agent_action` / `overlap` | 到点但没执行：{reason 的人话}。 / Due but skipped: {reason}. |
| `unschedulable` | `invalid_cron` / `no_next_run` / `target_invalid` | 无法排期：{reason}。 / Cannot be scheduled: {reason}. |
| `missed` | `process_down` / `paused` | 到点时实例没在运行 / 已暂停，错过了 {at} 的触发。 / Missed the {at} run. |
| `failed` | `execution_failed` / `timeout` / `dead_letter` + 沿用 `model_*` | 执行失败：{detail}。 / Failed: {detail}. |
| `delivery_failed` | 统一发送失败码 | 执行成功但发送失败。 / Ran but delivery failed. |
| `notify_failed` | 统一发送失败码 | 失败通知也没发出去。 / The failure notice could not be sent either. |

插件 `schedules/`（`@zhin.js/schedule-feature`）的每次执行同样写一行（`source: 'plugin'`）。会话日程唤醒（`schedule_wake_fired` / `missed` / `merged`）继续写决策审计，同时按本表写结局。notice / request / system 事件**不**逐条写结局（量大、多数无人关心），只在处理器抛错时写 `internal_error`，在请求被自动处理时写 `request_handled`（`approve` / `reject` / `ignored`）。

### 2. 记录位置：新增轻量的「消息结局」表，链接到决策审计与 turn trace

- **新表 `im_message_outcomes`，归 `@zhin.js/core` 所有**（经 DatabaseHost 声明的实例表）。原因：命令、中间件、处理器在没有安装 `@zhin.js/agent` 时也要有结局（ADR 0019），而 `ai_decision_events` 属于 Agent 包。
- **每条入站消息一行**，在 `InboundRuntime.#receiveMessage` 的 `finally` 中一次写入（append-only，不更新）。字段：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID |
| `received_at` / `settled_at` | 毫秒 |
| `instance_id` / `platform` / `scene_id` | 与 `ai_decision_events` 同口径（`<scope>:<sceneId>`），便于 join |
| `sender_id` / `message_id` | 平台 ID；不存昵称 |
| `addressed` | 是否点名消息 |
| `outcome` / `reason` / `facets` | 见 §1；`facets` 为码数组 |
| `stage` | 结局在哪一步确定：`ingress` / `interaction` / `middleware` / `handlers` / `command` / `suggestion` / `agent_gate` / `ambient` / `admission` / `model` / `tool` / `delivery` |
| `visibility` / `reply` | 见 §1 |
| `command` / `owner` | 命令名、插件 ID |
| `turn_id` | 进入 Agent 时的回合 ID，链接 `ai_decision_events.turn_id` 与 turn trace |
| `diagnostic_id` / `error_id` / `merged_into` | 链接进程内诊断、日志、合入的回合 |
| `detail` | 仅管理员可见，≤ 200 字，经与决策审计同一套规则（`redactDecisionPayload`）脱敏；该函数随 P1 下移到 `@zhin.js/kernel`，见下文“分层” |

- **不存消息正文**，也不存截断预览。需要看原文时按 `message_id` join `conversation_events`（ADR 0008，那里本来就有正文和自己的保留期）。
- **保留期** `im.outcomes.retentionDays`，默认 7 天（决策审计 14 天、trace 自有轮转）；清理由 Core 自己调度（与 `im_message_outcomes` 模型一起在 Core 侧注册），不挂在 Agent 的决策审计清理上。
- **分层**：表、写入、清理、脱敏都不得依赖 `@zhin.js/agent`——Core 不能导入 Agent（依赖方向 kernel → ai → core → agent），且 ADR 0019 的默认安装里根本没有 Agent。今天的脱敏函数 `redactDecisionPayload` 在 `packages/im/agent/src/decision-events.ts`，是不依赖 Agent 任何运行时的纯函数（连同其密钥键表、提示词键表、令牌值模式）；P1 把它下移到 `@zhin.js/kernel`，Agent 的 `decision-events.ts` 以原名再导出，决策审计行为不变。
- **采样与聚合**（`unaddressed-message-no-record`）：`not_addressed` / `ignored_bot` / `ignored_self` / `dropped_duplicate` 量最大。默认全量写（单行很小）；当某会话 1 分钟内此类行超过 `im.outcomes.quietSampleLimit`（默认 30）时，超出部分改为每分钟一行聚合（`reason` 不变，`facets: ['aggregated:<n>']`，`message_id` 为空）。点名消息与非静默结局永不采样。
- **无数据库**（memory / redis 项目）：只保留进程内环形缓冲（2000 条 / 24 小时），`why` 仍可用，Console 标注“未持久化”。
- **进程内诊断**：`RuntimeMessageDiagnostic` 增加 `outcome` 字段，其 `route` 改为由结局派生；`/messages/diagnostics` 返回结局。诊断仍是 15 分钟的细粒度时间线，结局表是长期的一行摘要。
- **与决策审计的关系**：决策审计继续记录 Agent 内部过程（门禁、旁听、工具、审批、出站），**不新增** `message_outcome` kind，避免同一事实写两遍。结局行通过 `turn_id` 关联；Console 决策回放按回合展开时，顶部先显示这条消息的结局行，过程行（带 `parent` 标记的折叠在其决定性事件下，zhinjs/zhin#1256）在下。
- **与 turn trace 的关系**：`TurnTrace.termination` 增加 `outcome` / `reason`；`zhin trace` 头部显示结局；trace 的 `trigger.message_id`（§4 表“聊天”一行）与结局行互相可查。

### 3. 如何查询

#### 3.1 聊天里

- **内置诊断命令** `为什么` / `why`（Core 内置命令，根插件所有，可经功能配置 `im.outcomes.chatCommand: false` 关闭）：
  - 无参数：返回**发起人自己**在本会话中最近一条已结算消息（排除 `why` 本身，默认 10 分钟内）的结局，只用发起人人话模板；`merged` 跟随 `merged_into` 给出最终结局。
  - `why <序号|消息 ID>`、`why @用户`：只对本会话 `admin` 及以上（ADR 0056）开放，返回管理员模板。
  - `detail`、`errorId`、`turnId` 只在**私聊**或 Console 中给 `owner`；群里一律不给。
  - 每人每 10 秒 1 次；`why` 本身的结局记为 `command_replied`。
  - **回在哪里**（决定 2）：群里原地回一句发起人模板（短、不含细节）；不主动发起私聊（多数平台机器人不能主动私聊）。
  - **与控制面的关系**（决定 1）：`why` 绕过 `mention_only`（它本身就是点名）和会话级 `muted_session`；不绕过急停、实例静音与平台禁言——这几种情况下只记录，Console / CLI 可查。
  - 功能开关 `im.outcomes.chatCommand: false` 只关聊天里的 `why` 与固定短语；Console / CLI 查询始终可用（决定 12）。
- **自然语句**“刚才怎么没反应 / 你怎么不理我 / why no reply”：Core 只在点名消息中识别一份固定短语表（中英，可配置、可关闭）并走同一查询函数，不调用模型；装了 Agent 时另提供只读工具 `explain_last_outcome`，供模型在对话中回答同类问题。
- **主动说明**：只对点名消息、且只对 §1 中 `reply: throttled` 的结局，同一会话 60 秒内最多主动说一次；`not_addressed`、`ambient_silent` 永不主动说。

#### 3.2 Console

- 会话页「记录」新增**结局时间线**（每条消息一行：时间、发送者、结局徽标、人话原因；展开为管理员补充、链接到决策回放回合与 trace）。
- 新 RPC `plugin.root.message-outcomes`（列表、按会话 / 发送者 / 结局 / 时间过滤）与 `plugin.root.message-outcome`（单条）。与现有 `plugin.root.decisions` 一样，它们是根插件经 `definePluginConsoleRpc` 声明的查询（`requiredPermissions`，见 `instance/console/decision-replay.ts`），不是 `CONSOLE_RPC_PERMISSIONS` 里的内置 RPC：两者的 `requiredPermissions` 为 `status.view`（列表与两种人话模板）。同一 RPC 内按字段的区分在处理函数里执行，不在权限映射里表达：调用者另有 `decisions:read`（`DECISIONS_READ_PERMISSION`）时才返回 `detail` / `error_id`，否则这两个字段被删去。
- 「机器人状态」关注项（`attention.list`）新增“最近 1 小时 `internal_error` / `delivery_failed` / `unrecorded` 计数”。`internal_error` 不主动推送给 owner，只进关注项；P3 之后再评估是否需要每日摘要（决定 8）。
- 文档 `docs/console/index.md:133`、`docs/paths/console.md:128` 改为“结局时间线说明每条消息的去向；决策回放说明 Agent 回合内部的每一步”。

#### 3.3 CLI

- `zhin why [--conversation <key>] [--sender <id>] [--message <id>] [--outcome <code>] [--since 1h] [--limit n] [--json]`：经网关调用实例 RPC，权限同 Console（API 令牌按其用户权限）。无参数时列出最近 20 条非静默结局。
- `zhin trace --message <id>`：由消息找到回合；`zhin trace <turnId>` 头部显示结局。
- `zhin schedule runs <jobId>` 显示每次触发的结局（含 `skipped` / `missed`）。

#### 3.4 权限总结

| 角色 | 能看到 |
| --- | --- |
| 普通用户（聊天） | 自己消息的结局，发起人模板 |
| 会话 `admin`（聊天） | 本会话任意消息，管理员模板，无 `detail` |
| `owner`（私聊）/ Console `decisions:read` | 全部字段 |
| Console `status.view` | 列表与两种模板，无 `detail` / `error_id` |

### 4. 强制手段

1. **结局账本 + `finally` 提交**：Core 新增 `InboundOutcomeLedger`，在 `#receiveMessage` 开头创建并挂在 `RuntimeMessage` 上（内部 symbol，经 `@zhin.js/core` 的 `reportInboundOutcome(message, candidate)` 提交候选；Agent 在 Core 之上，可直接调用）。`finally` 中 `settle()`：
   - 有候选 → 按优先级取主结局，其余为 `facets`；
   - 抛出了异常 → `internal_error`（生成 `errorId`，`logger.error` 带会话、消息 ID、阶段、插件），**原样重新抛出**，不改变适配器 `emitAccepted` 的确认语义；
   - 没有候选 → `unrecorded` + `logger.warn({ op: 'inbound_outcome_unrecorded', lastStage })`。测试环境（`NODE_ENV=test`）的严格程度分阶段：P1–P5 期间各阶段只给自己接入的分支补结局，其余分支必然还是 `unrecorded`，所以测试中**只告警**并计入一份允许清单（`packages/im/core/tests/fixtures/unrecorded-allowlist.json`，按 `lastStage` 登记，每个阶段完成时删去自己负责的条目）；P6 起清单必须为空，测试中出现 `unrecorded` 直接抛错（与 §6 P6 一致）。
   - `IngressRoute.route` 的返回值从 `boolean` 扩展为 `boolean | IngressRouteResult { handled; outcome? }`，旧返回值继续可用。`halt { handled: true }` 必须带结局。
2. **`check:silent-catch` 脚本**（`scripts/check-silent-catch.mjs`，并入 `check:all`）：
   - 范围：`basic/`、`packages/`、`plugins/` 非测试源码。
   - 禁止空 `catch {}`；`eslint.config.mjs` 的 `allowEmptyCatch` 改为 `false`（现存 12 处全部在入站链路之外：`basic/database/src/dialects/sqlite.ts:127,141,153`、`basic/cli/src/commands/install-service.ts:103,106,110,164`、`onboard.ts:41,45`、`preview.ts:949`、`packages/console/pagemanager/src/shell/page-renderer-helpers.ts:437,532`）。
   - 只有注释的 `catch` 与 `.catch(() => {} | undefined | null | [] | '')` 必须带标注 `silent-ok: <类别>`，类别限 `observer`（观察者 / 诊断失败不影响结果）、`rejection-observer`（为防 unhandledRejection 挂的观察者，原 promise 仍被等待）、`cleanup`、`probe-fallback`（探测失败有明确回退值，且回退值被记录）、`best-effort-io`。现存 591 处写入基线 `scripts/silent-catch-baseline.json`（按文件计数），只许减少；入站链路 142 处在第 1、2 阶段逐一标注或改掉。
   - 禁止 `void <endpoint>.events.emit('message.receive' …)` / `void this.publishEvent('message.receive' …)` 不接 `.catch`（现 14 处），改为 `.catch(reportInboundRejection)`（Core 导出，记录会话与消息 ID）。
3. **测试**：
   - `packages/im/core/tests/plugin-runtime/message-outcomes.test.ts`：夹具表类型为 `satisfies Record<MessageOutcome, OutcomeFixture>`，新增结局码不写夹具即编译失败；每个夹具驱动一条真实入站并断言 `outcome` / `reason` / `reply`。
   - Agent 侧结局（门禁、旁听、合流、模型、审批、工具、媒体）在 `packages/im/agent/tests/plugin-runtime/` 同样用穷举夹具。
   - 模板测试：每个码都有 zh-CN / en 的发起人与管理员模板，占位符与字段一致。
   - Vitest setup 注册一个钩子：P1–P5 中，测试里出现不在允许清单内的 `lastStage` 的 `unrecorded` 即失败，清单内的只告警；P6 起任何 `unrecorded` 即失败。
4. **CI 观测**：`pnpm test:e2e:gateway` 在 P1–P5 输出 `unrecorded` 计数（只报告），P6 起断言计数为 0。

### 5. 与已有改动的关系

“来源”一列对应 §4 表；本表只约定纳入方式，那些 PR 若在本 ADR 实施前未合并，由实施 PR 按 §4 表的行为描述补齐。

| 来源 | 纳入方式 | 需改名 / 归并 |
| --- | --- | --- |
| `UserFacingError`（#1250 第 2 批与定时任务批次） | 结局 `refused` / `user_facing_error`，`stage` 为 `command` / `middleware` / `handlers` | 无 |
| `createErrorId`（zhinjs/zhin#1256） | `internal_error.error_id` 用同一函数 | 从 `packages/im/zhin/src/instance/console/internal-error.ts` 移到 `@zhin.js/logger`（`createErrorId`，Core 与网关都能用） |
| `DECISION_PARENT_KEY`（zhinjs/zhin#1256） | 回放把 `model_skip` 折叠到决定性事件下；结局行的 `reason` 取决定性事件的码 | 无 |
| 发送失败分类（zhinjs/zhin#1256 的 `send-failure.ts`、zhinjs/zhin#1254 的 `consoleSendFailure`） | `delivery_failed.reason` | 两份几乎相同的分类，加上 `message-diagnostics.ts` 的 `deliveryCodes` 集合，共三份发送失败码表：归并为 `@zhin.js/im-contract` 的 `DELIVERY_FAILURE_CODES` + `classifyDeliveryFailure(receipt)`，分类只在这一处。zhinjs/zhin#1256 已在 `@zhin.js/console-protocol` 公开导出 `classifyConsoleSendFailure`、`ConsoleSendFailure`、`CONSOLE_SEND_FAILURE_MESSAGES`：这三个名字**保留**，改为对 `@zhin.js/im-contract` 的兼容再导出（`ConsoleSendFailure` 为对应类型的别名，`CONSOLE_SEND_FAILURE_MESSAGES` 仍是 Console 的展示文案表，键改为 `DELIVERY_FAILURE_CODES`），标 `@deprecated`，只在 `@zhin.js/console-protocol` 的下一个 major 删除；在此之前对使用方没有 API 变化。为此 `scripts/check-architecture-layers.mjs` 中 `packages/console/protocol` 的 `allowedImports` 增加 `packages/im/im-contract`（两者同为 level 0、无运行时依赖的契约包） |
| 审批 `unavailable` / 未执行工具说明（#1250 批次 PR，Agent 行为） | `approval_unavailable` / `approval_denied` / `approval_timeout` / `tool_failed_reported`；回合末说明即发起人模板 | `ApprovalBlockReason` 的 `unattended` / `no_channel` 直接作为 `reason` |
| 模型首响应超时 `no_response`（#1250 批次 PR，模型） | `model_timeout` / `no_response`；`timeout` → `request_timeout`；`turn_timeout` | `ChatFailureKind` 按“超时类 → `model_timeout`、其余 → `model_error`”映射，话术仍由 `chatFailureLine` 提供 |
| 近似命令、trace `trigger`（#1250 第 2 批） | `suggested` / `near_miss`；`stage: suggestion`；trace 与结局按 `message_id` 互查 | 该批的入站阶段名 `'command-suggestion'` 并入结局 `stage` 枚举 `suggestion` |
| `schedule.unschedulable` 关注项、下次运行（#1250 批次 PR，定时任务） | 定时任务结局 `unschedulable` | 关注项读结局表计数 |

统一后废弃的平行词汇：`RuntimeMessageDiagnostic.route`（由结局派生，保留只读兼容一个小版本）、`InboundSpineStage`（内部类型，换成结局 `stage`）、Agent `halt.handled`（改为带结局）。

#### 5.1 IM 回合审批接入 `ToolApprovalQueue`（与 ADR 0062 共同的决定）

所有者在 PR #1253 的讨论中同意：**IM 回合里的工具审批也接入 `ToolApprovalQueue`**。现状（`packages/im/agent/src/`）：

- 只有危险工具硬闸（G6）的审批卡进队列（`security/tool-approval-queue.ts`；Console「需要你处理」与审批人私聊 `approve <id>` / `deny <id>` 先到先得，见 `plugin-runtime/host/tool-approval-im-channel.ts`）。队列只在 `TurnToolRuntime` 的 `options.approvalQueue` 里，且只交给硬闸上下文（`ToolHardGate` 的 `queue`）。
- 硬闸**已经**实现了“会话提问与队列竞速”：`ToolHardGate.#awaitApproval`（`security/tool-hard-gate.ts`）同时发起 `requestApprovalOutcome`（会话提问）、`queue.wait(entry.id)`（Console / 私聊结算）、超时计时与回合取消，`Promise.race` 取先结算者；会话先答时以 `queue.resolve(id, …, 'approval_port')` 结算卡，队列先结算时经共用的 `AbortController` 撤回会话提问。
- 普通的 `approval_required` 与来源可疑（provenance）确认只在 `tool/turn-tool-runtime.ts` 里调用 `requestApprovalOutcome(this.turn.ports.approval, …)`，Console 看不到，也无法代为处理。`requestApprovalOutcome`（`session/approval-port.ts`）只面对 `ApprovalPort`，与传输无关，拿不到队列，也不该拿到。

决定：

- **实现方式**：不改 `requestApprovalOutcome`。把 `ToolHardGate.#awaitApproval` 中“会话提问 / 队列等待 / 计时 / 取消四路竞速、先结算者生效、另一方经 `AbortController` 撤回或以 `queue.resolve` 结算”的逻辑抽成 `security/` 下一个共用函数，硬闸改为调用它；`turn-tool-runtime.ts` 的 `approval_required` 与来源可疑两个分支也调用它，队列同样取自 `options.approvalQueue`。
- **只在真的发出提问时建卡**：`createRuntimeApprovalPort`（`plugin-runtime/ingress/request-ports.ts`）对 owner 的非 humanOnly 请求直接返回 `approve-always`，命中记住的授权（`ApprovalDecisionMemory.recall`）时直接返回已记住的结论——这两种情况不发提问，**也不建卡**。卡由端口在即将发出提问（`interaction.ask`）之前回调创建（例如 `ApprovalRequestInput` 增加一个建卡回调），不在 `turn-tool-runtime` 里预先建卡。
- **卡的种类**：`ToolApprovalEntry` 增加 `kind: 'hard_gate' | 'turn_prompt'`（缺省按 `hard_gate` 读，兼容现有卡）。IM 审批通道 `tool-approval-im-channel.ts` 的 `onEnqueue` 只投递 `hard_gate` 卡，`approve <id>` / `deny <id>` 也只接受 `hard_gate` 卡；`turn_prompt` 卡只出现在 Console「需要你处理」。这样审批人范围不因接入队列而扩大，也不会把每一个普通确认都私聊推给审批人名单。
- **Console 结算的语义**：队列的结算接口是 `resolve(id, approved: boolean, decidedBy, …)`，只有是 / 否。Console 批准一张 `turn_prompt` 卡等于**仅本次批准**（`approve-once`），拒绝等于仅本次拒绝，都**不写入** `ApprovalDecisionMemory`；“总是允许 / 总是拒绝”只能在会话里回答。
- **生命周期**：“批准后由下一次同指纹调用消费”（`consumeApproved` / `markConsumed`）与默认 5 分钟 TTL（`DEFAULT_TOOL_APPROVAL_TTL_MS`）**只适用 `hard_gate` 卡**。`turn_prompt` 卡与会话提问同生共死：提问超时、回合取消、会话里先回答时卡随之结算（`timeout` / `turn_cancelled` / `approval_port`）；Console 先结算时直接唤醒正在等待的回合，结果不留给下一次调用消费。
- **任一处批准或拒绝即生效，另一处同步失效**：会话里先回答，Console 卡片显示“已在聊天中处理”并不可再操作；Console 先处理，会话里的待确认提问被撤回（`interactions` 结算为已处理，之后的回答不再被当作确认吃掉），并在会话里说明结果。
- **审批权限不变**：会话内确认仍按现有 `ApprovalPort` 规则判定谁的回答算数；Console 端按工具审批的现有权限；硬闸卡仍是 humanOnly、一次一卡。普通群（审批人群除外）里不能用 `approve <id>` / `deny <id>` 结算任何卡；但回合内的 humanOnly 提问本来就发在触发它的会话里，在群里被有权的人回答时照常结算，记 `decidedBy: 'approval_port'`。
- **无人值守仍然失败关闭，不等 Console**：无人值守回合或会话端口不可用时，`turn-tool-runtime` 今天在提问之前就拒绝（`approval required but ApprovalPort unavailable`），这一点不变——回合立即以 `approval_unavailable`（`reason: unattended` / `no_channel`）结束，绝不阻塞等待 Console。此时没有会话提问，所以普通确认不建 `turn_prompt` 卡；硬闸照今天的行为在拒绝前已入队留卡。留了卡时结局带 facet `approval_card_left`（发起人人话追加“已留下审批卡，在 Console 批准后重试即可”），之后同参数的重试由 `consumeApproved` 消费这张已批准的卡。
- **结局与审计**：两处任一结算都写同一条 `tool_approval` 审计，消息结局按 §1.2 取 `approval_denied` / `approval_timeout` / `approval_unavailable`。
- 这同时是 ADR 0062 R4（一个意图只对应一个后端操作）在审批上的落实：审批只有一个后端（队列），聊天与 Console 都是它的前端。

实施归入 P2（见 §6），属于 `@zhin.js/agent` minor 与 `@zhin.js/console-protocol` / Console 前端的 minor。

### 6. 分阶段计划

| 阶段 | 内容 | 包与版本级别 |
| --- | --- | --- |
| P0 | 本 ADR；`check:silent-catch` 报告模式 + 基线；`allowEmptyCatch: false` 并修 12 处空 `catch` | 根脚本（不发版）；`@zhin.js/database`、`@zhin.js/cli`、`@zhin.js/pagemanager` patch |
| P1 | Core：`MessageOutcome` 码表与模板、`InboundOutcomeLedger`、`finally` 提交、`internal_error` + `errorId`、Core 侧全部结局（准入、交互态、中间件、处理器、命令、近似命令、发送）；诊断带结局；`reportInboundRejection`，修 14 处 `void emit`；统一发送失败码（`@zhin.js/im-contract`），`@zhin.js/console-protocol` 的三个发送失败导出改为弃用的兼容再导出；`redactDecisionPayload` 下移到 kernel；`unrecorded` 测试允许清单（§4） | `@zhin.js/core` minor、`@zhin.js/im-contract` minor、`@zhin.js/kernel` minor、`@zhin.js/agent` patch（再导出）、`@zhin.js/command` patch、`@zhin.js/logger` minor（`createErrorId`）、`@zhin.js/console-protocol` minor、相关适配器 patch |
| P2 | Agent：`route` 返回结局；门禁、未进插话群（`not_addressed`）、旁听、合流、`/clear`、`stop`、模型、预算、审批、工具、空输出、陈旧回复、失败话术发送失败；媒体逐项原因（`media_rejected`）；trace `termination.outcome`；修 `agent-runtime.ts:449` 为 warn；IM 回合审批接入 `ToolApprovalQueue`：抽出硬闸的竞速逻辑、`turn_prompt` 卡、IM 通道只投递 `hard_gate` 卡（§5.1） | `@zhin.js/agent` minor、`@zhin.js/ai` patch、`@zhin.js/console-protocol` minor、Console 前端 |
| P3 | 持久化 `im_message_outcomes`、保留期（Core 自己调度清理）、采样聚合；Console RPC 与权限、结局时间线、关注项；文档修订 | `@zhin.js/core` minor、`zhin.js` minor（`instance/console`）、`@zhin.js/console-protocol` minor、Console 前端 |
| P4 | 查询入口：`why` 内置命令与固定短语、`explain_last_outcome` 工具、`zhin why`、`zhin trace --message` | `@zhin.js/core` minor、`@zhin.js/agent` minor、`@zhin.js/cli` minor |
| P5 | 定时任务结局（助手任务、插件 `schedules/`、会话日程），`zhin schedule runs`；交互态声明“谁的回答算数” | `@zhin.js/agent` minor、`@zhin.js/schedule-feature` minor、`@zhin.js/core` minor、`plugins/utils/reminder` patch、`@zhin.js/cli` minor |
| P6 | `check:silent-catch` 改为失败模式（入站链路基线清零）；`unrecorded` 允许清单清空，测试中 `unrecorded` 由告警改为抛错，e2e 断言计数为 0；穷举夹具进 CI | 根脚本、测试 |

## 备选方案及否决理由

### A. 结局写进 `ai_decision_events`（新增 `message_outcome` kind）

否决：决策审计在可选的 Agent 包里，没装 Agent 的项目（ADR 0019 默认安装）命令照样会“没反应”却无处记录；一回合多行过程本来就难读，再加一行“结局”仍需要按 `turn_id` 聚合才能回答“这条消息怎样了”；没进 Agent 的消息没有 `turn_id`。

### B. 在 `conversation_events` 的入站行上加结局列

否决：ADR 0008 的事件表是 append-only 的权威事实，结局在处理结束后才知道，需要回写；正文与结局的保留期、权限不同（结局给普通用户看，正文不是）；表的写入路径与 IM 会话存储耦合，不适合放 Agent 侧的原因码。

### C. 只用结构化日志（`op: inbound_outcome`）

否决：聊天里的用户查不到，Console 只能靠日志检索，没有权限分层，日志会轮转；但每条结局仍同时写一行 info 日志（含 `errorId`），便于 `zhin logs` 检索。

### D. 所有失败都在聊天里回一句

否决：群里会刷屏；平台禁言时发不出去；旁听不插话本就是正确行为；会把内部原因暴露给无关的人。改为“点名消息才主动说、限流、其余可查询”。

### E. 让每个插件自己解释

否决：无法强制，口径不一；而“消息到达插件之前就被丢掉”的分支（去重、场地未就绪、功能关闭）插件根本看不到。

### F. OpenTelemetry span

否决：引入重依赖，面向运维而非聊天用户，也没有人话原因与权限模型；结局表以后可以导出为 span 属性，不冲突。

## 决定

所有者于 2026-11-14 拍板：原「未决问题」12 条**全部按推荐处理**。逐条结论如下（正文相应位置已同步）：

1. **`why` 与控制面**：绕过 `mention_only`（它本身就是点名）与会话级 `muted_session`；不绕过急停、实例静音与平台禁言——这几种情况下只记录，Console / CLI 可查（§3.1）。
2. **群里问 `why` 回在哪里**：群里原地回一句发起人模板（短、不含细节）；不主动发起私聊（§3.1）。
3. **保留期**：`im.outcomes.retentionDays` 默认 7 天，可配置（§2）。
4. **点名消息出 `internal_error`**：主动回复，同一会话 60 秒限流，只带错误号；非点名消息不回（§1.6、§3.1）。
5. **消息预览**：不存；按 `message_id` join `conversation_events`；项目关闭会话存储时 Console 显示“正文未保存”（§2）。
6. **自然语句识别**：Core 固定短语表（默认开、只对点名消息）+ Agent 只读工具 `explain_last_outcome`；不为此调用模型做意图识别（§3.1）。
7. **notice / request / system 事件**：不逐条记结局，只记处理器抛错（`internal_error`）与请求的自动处理结果（`request_handled`）（§1.7）。
8. **`internal_error` 推送给 owner**：不推送，进 Console 关注项；P3 之后再评估每日摘要（§3.2）。
9. **生产中的 `unrecorded`**：warn + 关注项计数。测试与 e2e 中：P1–P5 只告警（测试按允许清单放行尚未接入的阶段，e2e 只报告计数），P6 起直接失败（§4、§6）。
10. **静默结局采样**：每会话每分钟 30 行后聚合（`im.outcomes.quietSampleLimit`）；点名消息与非静默结局永不采样（§2）。
11. **交互态吞消息（`reminder-confirm-captures-chat`）**：P5 让提问方声明 `answeredBy: 'target' | 'anyone'`（默认 `target`），非被问者的消息不再被吞；同一提问的重复提示最多重发一次；在此之前先记 `interaction_consumed`（§1.3）。
12. **`why` 可被功能开关关掉**：可以（`im.outcomes.chatCommand`），但 Console / CLI 查询始终可用（§3.1）。

另有一条与 ADR 0062 共同的决定：

13. **IM 回合审批接入 `ToolApprovalQueue`**：IM 会话内确认与 Console「需要你处理」里的工具审批共用同一个队列，任一处批准即生效、另一处同步失效（所有者在 PR #1253 的讨论中同意的推荐）。只在真的发出提问时建卡；普通确认的卡（`turn_prompt`）只进 Console、批准即仅本次、随会话提问结算；无人值守回合仍立即失败关闭。细节见 §5.1，实施归入 P2。

## 落盘位置（计划）

- `packages/im/core/src/plugin-runtime/im/`：`message-outcome.ts`（码表、优先级、模板）、`inbound-outcome-ledger.ts`、`inbound-runtime.ts`（`finally` 提交）、`inbound-spine.ts`、`message-dispatcher.ts`、`message-diagnostics.ts`、`host/`（`im_message_outcomes` 模型与清理）、内置 `why` 命令
- `packages/im/im-contract/src/`：`DELIVERY_FAILURE_CODES`、`classifyDeliveryFailure`；`packages/console/protocol/src/send-failure.ts` 改为弃用的兼容再导出
- `packages/im/kernel/src/`：自 `agent/src/decision-events.ts` 下移的 `redactDecisionPayload`
- `packages/im/agent/src/plugin-runtime/ingress/`（`unified-mailbox-spine.ts`、`ingress-venue-helpers.ts`、`ingress-ambient-stage.ts`、`ingress-outbound.ts`、`scene-event-ingress.ts`、`request-ports.ts`）、`turn/inbound-media.ts`、`media/media-normalize.ts`、`tool/turn-tool-runtime.ts`、`security/tool-hard-gate.ts`（抽出审批竞速）、`security/tool-approval-queue.ts`（卡种类）、`plugin-runtime/host/tool-approval-im-channel.ts`、`trace/turn-trace.ts`、`assistant/timer-scheduler.ts`、`schedule-domain/`
- `packages/im/schedule-feature/src/schedule-index.ts`
- `packages/im/zhin/src/instance/console/`（结局 RPC、决策回放 join）、`packages/console/protocol/src/permissions.ts`
- `basic/cli/src/commands/`（`why.ts`、`trace.ts`、`schedule.ts`）
- `scripts/check-silent-catch.mjs`、`scripts/silent-catch-baseline.json`、`eslint.config.mjs`
- 文档：`docs/console/index.md`、`docs/paths/console.md`、`docs/authoring/commands.md`（`UserFacingError` 与结局）
