---
sidebar: false
---

# ADR 0067：读取外部内容后的高危动作确认——按动作分级，第一方只读工具的结果算受信输出

状态：已接受（所有者 2026-11-18 在维护会话中选定方案「分级 + 第一方只读工具标可信」，要求先写 ADR 再实施）。依据：zhinjs/zhin#1250 评论 6971359609 第 6 项 `high-risk-confirm-default-too-broad`。核对基线：`origin/feat/friendly-volta-ejc3wl` 合入 `origin/main` 之后的 `45cb531d0`。实施进度：已全部实施（与本文同一分支）。安全审查修订（同一分支）：背景消息里机器人自己的回复不再算来源（D7，#1250 `own-reply-counts-as-background`）；私聊里发起人自己按原文存下的消息不再算来源，未处理的 `/clear` 等重置写法得到回应（D8，#1250 `own-unhandled-message-counts-as-background`）；定时任务持久化创建时的来源、`schedule_preview` 不放宽（D2.1），受信清单收窄（D1），配置解析幂等（D3），`zhin doctor` 补充说明与无法识别值的提示（D5）。

关联：[ADR 0036](./0036-controlled-landing-phase0.md)（危险工具硬闸，与本文无关、不变）、[ADR 0044](./0044-adapter-capability-profile.md)（`@zhin.js/` 作用域的官方包视为可信，本文沿用同一判定）、[ADR 0065](./0065-mcp-tool-permit.md)（MCP 上游 `readOnlyHint` 只定权限档位、不放宽审批，本文同样不让它放宽确认）。

## 背景

### 1. 现状（逐项核实）

| # | 现状 | 位置 |
|---|---|---|
| P1 | `confirmHighRisk` 默认 `external_content`，只有 `external_content` / `off` 两档 | `packages/im/agent/src/security/provenance.ts:28`、`:36`、`:43` |
| P2 | 除 `discover` / `load_tool` / `load_skill` / `ask_user`、`trustedOutputTools` 和带 `trusted_output` 标签的工具外，**所有**工具结果都算外部内容，第一方插件的只读查询（天气、汇率）也一样 | `provenance.ts:78-83` |
| P3 | 回合一旦被污染，四类高危动作（执行命令、向其他会话发消息、改配置、定时任务）不分轻重，一律先确认 | `provenance.ts:65-75`；`packages/im/agent/src/tool/turn-tool-runtime.ts:212-259` |
| P4 | 无人值守回合（定时任务、后台事件）没人能确认，直接拒绝 | `provenance.ts:146`；`turn-tool-runtime.ts:226-228`、`:266-270` |
| P5 | 实时会话没有确认渠道时也直接拒绝 | `provenance.ts:150`；`turn-tool-runtime.ts:223-228` |
| P6 | 写文件（`write_file` / `edit_file` 等）不属于任何高危类别，读过网页后照样不确认 | `provenance.ts:65-75` |

结果是「查一下天气，然后建个定时提醒」这种正常请求，天气结果把回合标成污染，提醒就要确认；会话没有确认渠道就拒绝，定时任务里也拒绝。部署者唯一的出路是设成 `off`，读过网页后再执行命令、外发消息的保护也就一起没了。

### 2. 已有的确认与审批（不改）

- IM 确认走 `UserInteraction` 的选择（`packages/im/agent/src/plugin-runtime/ingress/request-ports.ts:300-410`）：支持按钮的平台渲染为按钮（G6、#1013），纯文本平台按编号或「确认 / 取消」回复；只认发起人或有权限的人在同一会话里的回答。
- 没有确认渠道时，给模型的拒绝原因已经区分「无人值守」和「此会话没有确认渠道」，并附 Console 替代路径（`packages/im/agent/src/session/approval-port.ts:165-191`）。
- `readOnly: true` 只是插件作者的声明，已经会放宽默认 `on-risk` 审批（`packages/im/agent/src/security/policy-facade.ts:361-377`）；高危名称、`risk: 'dangerous'`、带 `riskCategory` 的工具不认这个声明。
- MCP 工具的上游 `readOnlyHint` 不写进 `readOnly`（ADR 0065 D1.3）：MCP 工具的 `ToolCapability.readOnly` 永远不是 `true`，`mcpServer` 字段标明来源（`packages/im/agent/src/plugin-runtime/agent-runtime.ts:567-571`）。

## 决定

### D1 哪些工具结果算受信输出（`trusted_output`）

工具结果按下面的顺序判定，先命中的为准：

1. **不记录**（不算任何来源，与现在相同）：harness 工具 `discover`、`load_tool`、`load_skill`、`ask_user`；部署者写进 `injectionGuard.trustedOutputTools` 的工具；带 `trusted_output` 标签的工具。这三项是部署者或作者的明确声明，含义不变。
2. **外部内容**：
   - MCP 工具（`ToolCapability.mcpServer` 有值），**即使上游声明了 `readOnlyHint: true`**，即使 MCP 连接由官方插件声明；
   - 网页抓取与搜索：内置 `web_fetch`、`web_search`；
   - 用户上传或工作区的文件内容：内置 `read_file`、`list_dir`、`glob`、`grep`、`knowledge_search`、`get_local_assets`；
   - 持久化后可能被污染的内容：内置 `memory_search`、`todo_read`、`get_self_profile`；
   - 作者给工具加了 `external_content` 标签（第一方插件中返回他人可写文本的只读工具应加，例如 QQ 适配器的群成员 / 群信息 / 加群申请查询，入群申请留言是任何陌生人都能写的）。
3. **受信输出**：同时满足
   - 工具声明了 `readOnly: true`，且这个声明有效：没有 `risk: 'dangerous'`、没有 `riskCategory`、名称不属于任何高危类别（`classifyHighRiskAction` 为空）；
   - 来源是第一方插件：工具所属插件的包名是 `zhin.js` 或在 `@zhin.js/` 作用域下（与 ADR 0044 判定官方适配器的规则相同）；Host 自带的原生工具不靠这一条，按上面第 2 条逐个列出；
   - 不是 MCP 工具，也没有 `external_content` 标签。
4. 其余都是**外部内容**（保守，与现在相同）：第三方插件、项目自己的工具、没声明只读的第一方工具、子 Agent 报告、群聊背景消息、图片的自动描述。
5. **失败也算来源**（#1250 F8）：工具抛出的错误、返回的 `{ error }` 或 MCP `isError` 结果，其文本同样交给模型，常常原样引用上游（HTTP 原因短语、JSON-RPC 错误消息、上游 API 的报错文本）。不属于第 1 条的工具失败时一律记为**外部内容**，第 3 条的受信工具也不例外。不记录的只有 harness 自己写的错误文本：本地策略拒绝（`NetworkAccessDeniedError`、`McpPermitDeniedError`，按拒绝处理）、回合取消或中止（`AbortError` / `TimeoutError`、`TurnCancelledError` 等）、控制面拦截与日志提交失败（`TurnJournalCommitError`）。

清单（本次落地时声明了 `readOnly: true` 的第一方工具，以代码为准）：

| 插件 | 受信输出 | 仍算外部内容 |
|---|---|---|
| `@zhin.js/plugin-60s` | `weather`（天气）、`exchange_rate`（汇率） | `moyu`（摸鱼日历：节日名、倒计时名称是上游自由文本）、`fuel_price`（油价说明、趋势描述是上游自由文本）、`gold_price`（品种名、单位原样拼接上游字符串），三者声明只读并加 `external_content`；新闻 / 热搜 / 段子 / 翻译等返回第三方文本的工具（不声明只读，或声明只读并加 `external_content`） |
| `@zhin.js/plugin-ledger` | — | `ledger_list`、`ledger_summary`（分类名、备注是以前的回合写进去的文本，可能来自被注入的回合；加 `external_content`） |
| `@zhin.js/plugin-game-hub` | `game_catalog` | — |
| `@zhin.js/process-monitor` | `process-status` | — |
| `@zhin.js/plugin-content-moderation` | `moderation_status` | `moderation_check`（回显被检查的文本，加 `external_content`） |
| `@zhin.js/adapter-qq` | — | 群信息、群成员、禁言列表、黑名单、加群申请、会话信息（加 `external_content`） |

判定受信输出的标准是「返回值是第一方代码按固定格式组装的短结构化值」。原样拼接上游自由文本（节日名、说明文字、趋势描述）或以前回合写入的文本（账目备注）的工具，即使声明只读也要加 `external_content`。天气、汇率保留为受信输出：字段是温度、湿度、风力、币种代码、汇率这类短值；它们仍是上游字符串，残余风险见「安全分析」，且受 D2.1 约束——在它们之后建的定时任务每次运行都按读过外部内容处理。

时间类查询（当前时间、日期）由提示词里的运行时上下文提供，不经工具，不受影响。

### D2 按动作分级

高危类别增加「写文件」，共五类；普通工具、只读工具不是高危类别，不受本闸影响（它们自己的审批不变）。每类的确认级别有四档：

| 级别 | 含义 |
|---|---|
| `off` | 不因来源确认 |
| `untrusted_content` | 回合里有**外部内容**（D1 第 2、4 条）后才确认；受信输出不算 |
| `any_content` | 回合里有**任何**被记录的来源（含受信输出）后就确认；即原来 `external_content` 的含义 |
| `always` | 每次调用都确认，回合没有被污染也一样 |

默认配置下各类别的行为：

| 类别 | 判定（与现在相同，另加写文件） | 默认级别 | 只读过受信输出后 | 读过外部内容（网页 / MCP / 文件）后 | 没被污染 |
|---|---|---|---|---|---|
| 执行命令 | `bash`、`shell` 标签 | `any_content` | 确认 | 确认 | 不确认 |
| 写文件 | `write_file`、`edit_file`、`multi_edit`、`apply_patch`、`delete_file`、`move_file`、`rename_file`（含拼写变体）、`file_write` 标签 | `any_content` | 确认 | 确认 | 不确认 |
| 外发消息 / 跨会话发送 | send / forward / notify 等名称、`outbound` 标签 | `any_content` | 确认 | 确认 | 不确认 |
| 修改配置 | config / settings / 安装插件等名称、`config` 标签 | `any_content` | 确认 | 确认 | 不确认 |
| 定时任务 / 提醒 | schedule / cron / reminder / timer 等名称、`schedule` 标签 | `untrusted_content` | **不确认** | 确认 | 不确认 |
| 普通工具 | 其余 | —（不受本闸） | 不确认 | 不确认 | 不确认 |
| 只读工具 | 有效的 `readOnly: true` | —（不受本闸） | 不确认 | 不确认 | 不确认 |

执行命令、写文件、外发、改配置这四类的结果可能在本回合之外造成不可撤回的影响，或者能关掉防护本身，所以保持原来的严格度：只要读过任何内容就确认。定时任务 / 提醒的影响是「将来某个时间在本会话做一件事」，所以只在读过真正的外部内容后才确认；放宽只覆盖「创建」这一步，任务运行时做什么由 D2.1 约束。

### D2.1 定时任务记住创建时的来源；`schedule_preview` 不放宽

安全审查发现，原先「到点执行时还要再过一遍全部策略」的论证不成立：每个回合都从空的来源记录开始（`full-agent-turn-engine.ts` 新建 `TurnProvenance`），到点回合把存下的 prompt 当作用户输入（`assistant-runtime.ts` `createRuntimeScheduleTurnPort`），回合因此是「干净」的；`schedule_add` 接受任意 `prompt` / `execution_plan` / `tools`。被注入的受信输出只要让模型建一个「把 X 写进文件 / 发到某群」的任务，到点回合里的写文件、外发就不会再确认，无人值守兜底也不会触发。`schedule_preview` 更直接：它当场执行 prompt，却和 `schedule_add` 一样被归为定时任务类并被放宽。

修订：

1. **持久化来源**。`schedule_add` 执行时读取调用它的回合的来源记录（`TurnToolRuntime` 在工具执行期间用 `AsyncLocalStorage` 绑定本回合的 `TurnProvenance`，工具结束即解绑）；只要回合里有**任何**被记录的来源（含受信输出），就在任务上写 `provenance: { tainted: true, sources: [...] }`（来源键，如 `tool:weather:trusted`、`conversation_context`，最多 10 个）。SQL 存储新增可空列 `provenance_json`（启动时 `addColumns` 给旧表补列），JSON 存储原样保存；存了但解析失败的值按「已污染」处理。Console / RPC / profile 由人创建的任务不经过 Agent 工具调用，没有这个字段。
2. **到点恢复**。任务的 `provenance` 经执行域传进到点回合的执行画像（`TurnExecutionProfile.schedule.provenance`）；`TurnToolRuntime` 构造时把它记为来源 `scheduled_prompt`（**永远不算受信输出**）。于是到点回合一开始就「读过外部内容」：五类高危动作都要确认，而无人值守回合无法确认，直接拒绝；审核 Agent 也不能放行（D2 的兜底）。同一机制作用于 `schedule_preview` 的预演回合（预演任务带上调用回合的来源）。到点回合里再建的任务同样带上原来的来源，污染不会因转手而丢失。
3. **`schedule_preview` 不放宽**。它仍归定时任务类（`classifyHighRiskAction` 不变），但确认级别取「配置级别」与 `any_content` 中较严的一个（`highRiskConfirmLevel`），无人值守兜底的默认级别也按 `any_content`（`defaultHighRiskConfirmLevel`）。部署者把 `schedule` 显式设为 `off` 时预演也不确认——这是部署者的选择，且预演回合本身仍按第 2 条带着来源运行。
4. **旧任务**：没有 `provenance` 字段（本修订之前存下的任务）按原行为处理，不额外污染。理由：无法事后还原它们创建时的回合；本 ADR 之前的默认值 `external_content` 下，模型在任何被记录来源之后建任务都需要有人确认或被拒绝，所以旧的模型创建任务大多经过了人确认。残余风险：确认的是「建这个任务」，不是任务以后做的写文件 / 外发；部署者可以在 Console「运维 → 定时任务」检查并重建。

影响：「读网页（或查天气）后建一个写文件 / 外发的定时任务」现在建得成（定时任务类按级别确认），但每次到点都会在写文件 / 外发处被拒绝，任务记为 `degraded` 并说明原因。需要无人值守写文件的任务应由人在 Console 创建，或在没有读取任何内容的回合里创建。

「确认」的含义不变：实时回合发确认消息，无人值守回合直接拒绝（P4），没有确认渠道的实时回合直接拒绝（P5）。无人值守回合里，自动审核 Agent 不能替被污染回合的高危动作放行（`turn-tool-runtime.ts:263-270`）；判断是否污染时取「配置级别」与「默认级别」中较严的一个，所以把某类设成 `off` 也不会让审核 Agent 放行默认会确认的调用。

### D3 配置的形状

```yaml
ai:
  agent:
    injectionGuard:
      # 写法一（推荐）：按类别配置，没写的类别用默认级别
      confirmHighRisk:
        shell: any_content
        fileWrite: any_content
        outbound: any_content
        config: any_content
        schedule: untrusted_content
      # 写法二（兼容）：一个字符串作用于所有类别
      # confirmHighRisk: external_content   # = 所有类别 any_content（原来的含义，含新增的写文件）
      # confirmHighRisk: always             # = 所有类别 always
      # confirmHighRisk: off                # = 所有类别 off
```

- 不写 `confirmHighRisk`（或 `injectionGuard` 整个不写）就是上表的默认值。
- 字符串 `external_content` 保留原来的含义，映射为所有类别 `any_content`，**不**享受 D2 对定时任务的放宽：部署者显式写过的配置一律不放宽。写文件是新增类别，字符串写法同样覆盖它（只收紧）。`zhin doctor` 对显式写了字符串 `external_content` 的项目提示一次：定时任务在只读过受信输出后也会确认，想用新默认值就删掉这一行或改成对象写法。
- 字符串 `off` 映射为所有类别 `off`，`always` 映射为所有类别 `always`。
- 无法识别的字符串或级别按 `any_content` 处理（不放宽）。
- 解析是幂等的：已解析的策略（键为 `file_write`）再解析一次得到同样的级别；同时写了配置键 `fileWrite` 与已解析键 `file_write` 时以配置键为准。原先第二次解析只认 `fileWrite`，会把 `always` / `off` 改回默认值。
- `host-config-schema.json` 里 `confirmHighRisk` 改为「字符串 | 对象」，并**去掉 `default`**：Ajv 的 `useDefaults` 会把默认值写进配置，部署者没写和写了 `external_content` 就分不清了。
- 审批策略指纹（`approval-policy-fingerprint.ts`）的规则版本号加一：同一配置下的判定变了，之前在旧规则下被拒的调用会提示「策略已变更」。

### D4 IM 确认

- 统一用现有的 `UserInteraction` 选择：支持按钮的平台显示按钮，纯文本平台按编号或文字回复。本文不新增确认路径，也不改按钮的渲染（属于 core interaction 的范围）。
- 确认内容新增「写文件」的动作名；其余不变。
- 没有确认渠道时：给模型的拒绝原因保留「这不是无人值守回合，用户也没有拒绝」，并按类别附替代路径（定时任务：Console「运维 → 定时任务」；配置：Console 配置页；其他：在 Console 操作或请 Bot 主人在私聊里处理）。**不**自动把意图确认转成 Console 审批卡：意图确认要问的是发起人本人「这是不是你要的」，Console 里的审批人不是发起人，替他回答等于没有确认。

### D5 `zhin doctor`

「审批渠道」一项：

- 所有类别都是 `off`（含字符串 `off`）时报 `warn`，列出失去的保护：读过网页、MCP 工具结果、文件内容或群聊背景之后，模型被注入的指令可以直接执行命令、写文件、向其他会话发消息、改配置、建定时任务，不再经过任何人确认。给出替代配置：

  ```yaml
  confirmHighRisk:
    schedule: off          # 只关掉定时任务的确认
  ```

  并说明默认值已经不会因第一方只读查询（天气等）要求确认；如果某个工具的结果确实可信，把它写进 `trustedOutputTools`，而不是关掉整个闸。
- 部分类别是 `off` 时报 `ok`，写明哪些类别关闭了。
- 显式写了字符串 `external_content` 时报 `ok` 并提示 D3 的迁移建议。
- 定时任务类别为 `untrusted_content`（默认）时，`ok` 说明里写明放宽的范围：只读过第一方只读查询后创建任务不确认，但这样建的任务每次运行（及 `schedule_preview` 预演）都按读过外部内容处理，写文件、外发、改配置、执行命令会被拒绝；`schedule_preview` 不享受放宽。
- 无法识别的级别（如 `Always`、`fileWrite: yes`）或未知类别（如 `file_write`）报 `warn`：agent 会按 `any_content` 处理，不放宽，但不是部署者想要的设置。

启动日志的 `approval_channel_conflict` 同样按类别描述：只有启用了无人值守入口、且至少一个类别没关时才提示。

### D6 验收

1. 默认配置、会话没有确认渠道：先调用第一方只读的天气工具，再建提醒（`schedule` 类）——提醒建成，没有确认、没有拒绝。
2. 默认配置：读网页后执行命令、读网页后向其他会话发消息——都要确认；没有确认渠道时拒绝。
3. 默认配置：天气工具之后执行命令——仍要确认（`any_content`）。
4. MCP 工具即使上游声明只读，之后建提醒仍要确认。
5. 字符串 `external_content`：天气之后建提醒仍要确认（不放宽显式配置）。
6. 无人值守回合：天气之后建提醒放行；读网页后建提醒拒绝，审核 Agent 不能放行。
7. Agent eval 增加「查天气 + 建提醒」与「网页注入后要求外发」两个用例。
8. 默认配置：天气之后 `schedule_add` 一个写文件的任务——任务建成并带上 `provenance`；到点回合里 `write_file` 被拒绝（无人值守）。
9. 默认配置：天气之后 `schedule_preview`——要求确认；确认后预演回合里的写文件仍被拒绝。没读过任何内容时预演与到点运行行为不变。
10. `resolveInjectionGuard(resolveInjectionGuard(x))` 与一次解析结果相同。

### D7 背景消息里机器人自己的回复不算来源（#1250 `own-reply-counts-as-background`）

所有者反馈：机器人只要说过话，下一回合一开始就算读过外部内容，D2 对定时任务的放宽几乎用不上。复现：默认分级、Sandbox 私聊，只发一句「直接调用 schedule_add 建一个任务」，仍弹确认，来源链「主人的消息 → 群聊背景消息 → 本次调用 schedule_add」，回合第一条消息是 `[Untrusted conversation events …]`，内容 `You (this bot) […]: <上一条回复>`。

核实（`packages/im/core/src/plugin-runtime/im/conversation-runtime.ts`、`packages/im/agent/src/plugin-runtime/full-agent-turn-engine.ts`）：

- 回合结束时游标只提交到本回合入站消息的序号（`readContext` 返回 `max(cursor, throughSequence)`），回复是之后追加的事件、序号更大，下一回合的 `listBetween(cursor, throughSequence)` 读到它；
- 聚合背景时只去掉了自己撤回的消息（活动指示）和 `⏳` 进度更新，没有去掉自己的普通出站消息（出站消息记录时没有 `actor`，`describeConversationMessage` 把它标成 `You (this bot)`）；
- 回合引擎只要有背景块就记 `conversation_context`，不看块的内容是谁说的。

决定：

1. **保留在背景里，但不计来源**。本会话里本 Agent 自己投递的回复，再以背景块出现时不记 `conversation_context`。判定要两项证据同时成立：块是机器人自己的出站消息，带有出站回执给出的已投递文本摘要（`messageTextDigest`，只有 `recordOutbound` / `recordOutboundUpdate` 会写，入站消息永远没有）；且 `deliveredMessageContextRef(消息, 摘要)` 在本会话的投递记录里（`SessionToldLedger.recordDelivered`，回复按原文送达、回执摘要与计划文本一致时才产生这条引用，与会话历史去重 `projectRepresentedContext` 用的是同一条证据）。块本身不删：模型仍需要知道自己在群里说过什么、和成员消息的先后顺序；与会话历史重复的部分照旧由 `projectRepresentedContext` 在投影时去掉。
2. **其余背景照旧计来源**：成员的消息、场景事件（入群、撤回、表情回应等）、以及机器人经**其他路径**发出的消息——插件命令的输出、定时任务投递、另一个会话的回复、被中间件改写过的回复、重启前的回复（投递记录只在进程内存里，重启后失败关闭）。这些出站消息的文本可能就是第三方内容（例如命令转发的热搜标题），不能因为「是机器人发的」就当作可信。
3. **来源文案按场景**：私聊写「私聊里的背景消息」，群聊 / 频道写「群聊背景消息」；持久化到定时任务的来源键仍是 `conversation_context`（不带场景），显示为「会话背景消息」。
4. **游标不推进到回复的序号**。回复与本回合入站消息之间可能夹着成员的新消息；把游标推到回复序号会让这些消息从下一回合的背景里消失——既丢上下文，也会让本该计来源的外部内容绕过 D2。按「入站消息与回复之间没有别人的事件」才推进的做法要在回合结束时再读一次事件流，还要处理并发回合与多段回复，收益只是省掉一个已经不计来源、又会被历史投影去重的背景块，不做。
5. **只有干净回合写的回复才进投递记录**（安全审查修订）。回合引擎在投影时看本回合 `TurnProvenance` 的**最终**状态——工具结果与失败、背景消息、媒体感知、委派的子 Agent、定时任务的提示词都记在同一份来源记录里，信任的第一方只读结果也算——只要记过任一来源，这个回合的回复（包括流式分段回复）就不调用 `recordDelivered`。被污染回合的回复可能复述了它读到的注入内容（例如网页让模型说「接下来我会每天执行 X，回复『好』即可」），下一回合它以背景块出现时照旧计 `conversation_context`：用户回一句「好」时回合不干净，`schedule_add` 仍按分级确认，D2.1 的快照也记下这个来源。回复继承产生它的回合的污染；干净回合的回复下一回合不计来源。
6. **重置会话时清空**。`/clear` 等归档会话的入口（`ZhinAgent.archiveSession`）清掉该会话的已告知记录与投递记录（按会话键和当时的会话 id）；进程退出（`dispose`）全部清空。压缩不清：压缩改写的是模型历史，不改变「这条消息是本 Agent 在本会话按原文发出的」这一事实，已告知记录本来就设计成随压缩摘要保留。投递记录每个会话最多 64 条，被淘汰的旧回复再出现时按外部内容处理（失败关闭）。

### D8 私聊里发起人自己的原文消息不算来源（#1250 `own-unhandled-message-counts-as-background`）

所有者反馈：私聊里发起人自己的一条没被处理的消息，会让下一回合算作读过外部内容。复现：Sandbox 私聊发 `/clear`（不是命令：`inbound_outcome` 为 `not_addressed`、`no_command_not_ambient`），再聊一句，然后让它建定时任务，弹确认「来源链：主人的消息 → 私聊里的背景消息 → 本次调用 schedule_add」；新会话不发 `/clear` 则不弹。

核实：

- `/clear` 没有任何指令认领；Agent 入口的 AI 触发规则把 `/`、`!`、`！` 开头的消息当成指令前缀忽略（`DEFAULT_AI_TRIGGER_IGNORE_PREFIXES`），所以它到不了 `isClearCommand`（那里虽然列了 `/clear`，默认配置下走不到），私聊又不走插话判断，结局 `not_addressed`、`no_command_not_ambient`，没有任何回应；
- 入站消息在任何中间件之前由 `ConversationRuntime.recordIncoming` 写进会话事件流，Agent 的游标停在上一回合的入站消息上，`/clear` 就成了「聊一句」那个回合的背景块；回合引擎只要有不被 D7 豁免的背景块就记 `conversation_context`——发起人自己的消息也一样；
- 那个回合因此被污染，按 D7 决定 5 它的回复不进投递记录；再下一回合，这条回复在背景里照旧计来源，建定时任务就要确认。

决定（所有者批准的方案，宁严勿松）：

1. **只在私聊放宽**。背景块同时满足以下全部条件时不记 `conversation_context`，块本身仍留在提示词里：
   - 回合是由消息发起的 IM 回合，`origin.scope` 为 `private`，且回合带着规范会话地址 `origin.conversation`、其 `kind` 也是 `private`；不是合流回合；发起人来源是 IM Runtime 判定的 `human`（缺省不放行）；
   - 消息来自**声明了 `messaging.inboundTextAuthoredBySender` 的适配器**（能力画像，ADR 0044；按会话类型合并后为 `true`）。这项声明的含义是「本适配器入站的 `text` 段都是发送者亲笔写的：转发、引用、卡片、合并转发、inline bot 结果都表示为非文本段、`replyTo` 或消息级 `forwarded` 标记，纯文本视图与文本段一致」。核心只读能力，不按平台名分支；没声明的适配器一律不写证据；
   - 块是 `message.created`，带核心给出的**入站原文证据**：`inboundActorId`（核心记录的发送者 id）与 `inboundTextDigest`；
   - `inboundActorId` 等于本回合发起人 `principal.subjectId`（两者同源：都是 IM Runtime 解析出的 `message.sender.id`，`createRuntimeTurnAccess` 直接取它作为 principal），并且块的 `message.conversation` 与 `origin.conversation` 的规范键 `conversationRefKey` 相同——同一适配器（平台）、同一 endpoint、同一会话（含父会话、话题）。项目里没有跨平台归一的 principal，按「同一平台、同一 endpoint、同一 sender id」比对，不做账号关联。
2. **入站原文证据由核心补上**（`@zhin.js/im-contract` 新增可选字段，`@zhin.js/core` 写入）。`recordIncoming` 在中间件与插件之前存入站消息，此时只对满足全部条件的消息写 `ConversationMessage.inboundTextDigest`：适配器声明了 `inboundTextAuthoredBySender`（入站链按当前快照的适配器画像与会话类型解析后传给 `recordIncoming`）；有已识别的发送者（id 去掉首尾空白后存储，与回合 principal 的 `subjectId` 一致；为空按未知发送者，不写）；消息没有 `forwarded` 标记；没有引用（`replyTo`）；每个段都是文本（图片、文件、@、转发等任一非文本段都不写），且适配器给的纯文本视图 `content` 与文本段拼接一致（Discord 往视图里拼 embed 标题、贴纸名时就对不上，不写）；正文非空；聊天主人认领码的脱敏没有改动文本。
   摘要是 **HMAC-SHA256**，密钥是每个 `ConversationRuntime`（即每个实例进程）启动时生成的 32 字节随机数（`ConversationRuntimeOptions.evidenceKey` 可注入，测试用），只存在进程内存里；签名内容绑定 `(规范会话键, 消息引用键, 发送者 id, 原文)`。项目里没有可复用的实例级签名密钥（认领码、Console 令牌都在网关或各自的存储里，不进 IM 层），所以用进程内随机密钥：**进程重启后旧证据一律不再通过核对，这些消息重新计来源——失败关闭，可以接受**。聚合背景块时再核一次：只有 `message.created`、有 `actor`、无引用、无 `contentStatus`、未撤回、没有出站摘要、修订号为 0、正文非空，且按当前存储的会话、消息、`actor.id` 与段重算的 HMAC 与记录（常数时间比较）相符，才把 `inboundActorId` / `inboundTextDigest` 放进块里；对不上（存储被改、改了 `actor.id` 后重算普通 SHA、把别人的摘要挪过来、别的密钥写的、更新过的消息）就不放。机器人自己的出站消息永远没有这项证据。Agent 拿不到密钥，也不核对摘要本身：它只读核心 `readConversationContext` 投影出的块（回合的 `conversationContext` 端口只由入站链用核心投影构造），只信任投影里由核心核对后放进去的这两个字段。
3. **适配器的声明逐个核实后才加**（安全审查修订）。原先只看段类型，而 Telegram 把转发、inline bot 结果当成发送者的 `text` 段，Email 正文里内联原邮件 / `Fwd`（`From` 还可伪造），ipad-wechat 的 app 类型无媒体句柄时把正文当文本——第三方内容会拿到「本人原文」证据。修订后默认不写，只给核实过的适配器声明：
   - `sandbox`：Console 输入框里打的字；@、表情、媒体、按钮都是非文本段。
   - `telegram`：文本段只取 `text` / `caption`；回复带 `replyTo`；`forward_origin` 及旧版 `forward_*`、`is_automatic_forward`、`via_bot`、`external_reply`、`quote` 任一存在时入站消息带 `forwarded: true`（`isTelegramRelayedMessage`）；媒体、贴纸、按钮回调是非文本段。
   - `onebot11`、`napcat`：消息数组经 `toCanonicalSegments`，合并转发是 `forward` 段，卡片保留为 `json` / `xml` 段，引用是 `reply` 段并带 `replyTo`；CQ 字符串格式时纯文本视图剥掉全部 CQ 码，卡片 / 转发的内容不进文本。
   - `discord`：文本段只取 `message.content`；转发与回复都带 `message_reference`，成为 `replyTo`；附件是媒体段；embed 标题、贴纸名只拼进纯文本视图，与段不一致，核心不写证据；Webhook / Bot 作者不入站。
   - 不声明：`email`（正文内联原邮件、`From` 可伪造）、`ipad-wechat`（app 消息无媒体句柄时正文当文本）、`qq` 官方（SDK 未识别的段如 ark / embed 直接丢弃，剩下的文本段会被当作全部内容）、`slack`（没有段，分享消息的附件被丢弃、文件只剩占位文字）、`lark` / `kook` / `dingtalk`（`[file: 文件名]` 等占位文字含第三方可控文本，KOOK 卡片退回原始 JSON 文本），以及其余未审计的适配器。
   平台本身不留痕迹的「单条转发」（例如 QQ 里把别人的一句话转发给机器人，平台把它当成转发者新发的消息）与转发者自己粘贴无异，按发起人自己的话处理；这是残余风险，见安全分析。
4. **其余一律照旧计来源（失败关闭）**：未声明 `inboundTextAuthoredBySender` 的适配器的任何消息；带 `forwarded` 标记的消息（Telegram 转发、inline bot 结果、跨会话引用）；群聊、频道里同一个人的同样消息；私聊里别人的消息（身份不同）、引用 / 转发他人、带媒体或 @ 的消息、核心之外注入而没有证据的块；另一个 endpoint 或另一个会话里同一 sender id 的消息；更新过的消息；机器人非原文的回复、插件命令与定时任务的投递；旧版本写下、没有证据字段的事件，以及进程重启前写下的证据；回合缺少规范会话地址，或发起人来源不是 `human`。判断「私聊」只用核心的会话类型与回合 scope，不按平台名分支（`check:no-platform-branches`）。
5. **未处理的重置写法给出回应**。`/clear`、`/reset`、`/new`（任意大小写，半角或全角斜杠，`NFKC` 归一后整条只有这一个词）在没有任何指令处理、AI 触发也没接下时，若是私聊或 @ 了机器人，Agent 入口回一句固定文案（中英文）。提示**在全部入站闸门之后**发：控制面入站闸（停用、禁言、只读、仅 @）放行、会话画像判定机器人能发言、AI 触发开着且会回应这类消息（私聊 `respondToPrivate`、群里 `respondToAt`）、`ai.access` 为 `open` 或白名单里有这个人 / 这个群，并且控制面没有拦出站；只在 `matched == null` 的分支里调用（`evaluateIngressGatesAndTrigger` 的 `onUnmatched`，在插话判断之前）。同一会话、同一发送者 60 秒内只回一次（`RESET_HINT_COOLDOWN_MS`，进程内、有上限），冷却期内照旧不回应。文案：Zhin 没有这个指令，清空本会话 AI 上下文请直接发「清空」（或 clear、重置；群里需 @），主人或受信任用户还可以用 `<指令前缀>reset` 归档会话（只在知道指令前缀时提示）。回复走 `Message.$reply` 标准出站链；文案只用固定模板，不回显用户原文。入站结局记 `suggested`（`reason: reset_hint`）。
6. **选择「进入背景但不计」**。`/clear` 在路由前就已写入事件流，核心之外没有公开的「从背景剔除」入口，为一条提示新增剔除接口得不偿失；它在私聊里按决定 1 不计，在群里照旧计。提示本身是运行时写的固定文本，与干净回合的回复同理（D7）：`sendFixedReply` 只在回执摘要与这段文本一致时，以 Agent 会话键把它记进本会话的投递记录；会话键带 `key:` 命名空间前缀（`sessionKeyLedgerId`），与会话 id 不会撞名；回合引擎查投递记录时除会话 id 外也查带前缀的会话键，重置会话时两种都清。清空（`clear` / 清空 / 重置）与 `<前缀>reset` 的固定回复同样记录，否则照着提示重置后，下一回合仍会被这条回复污染。其他管理命令（`/memory`、`/tree` 等）的回复可能带存储内容，照旧计来源。

## 安全分析

**变化的攻击面**：只有一处放宽——第一方插件声明只读的工具，其结果不再让「定时任务 / 提醒」类调用要求确认。攻击者要利用它，必须让这类工具的返回值里带上注入指令：

- 返回值来自第一方代码处理过的短结构化数据（天气、汇率、游戏目录、进程状态）。上游 API 被攻破或返回恶意文本时，指令能进入模型。代价：模型可能建一个本会话的提醒或定时任务，提示词由注入内容决定。原稿认为「到点再过一遍全部策略」就够了，这不成立（见 D2.1：到点回合原本从干净的来源记录开始）；修订后这个任务带着创建时的来源，到点回合一开始就算读过外部内容，执行命令、写文件、外发、改配置都会被拒绝（无人值守，审核 Agent 也不能放行），能做的只剩普通工具与只读查询，结果按任务的通知方式发回本会话。任务本身显示在 Console「运维 → 定时任务」，可以删除。不能借此在本回合执行命令、写文件、向其他会话发消息或改配置——这四类仍然在读过任何内容（含受信输出）后确认。
- `schedule_preview` 当场执行提示词，不享受放宽（D2.1 第 3 条），预演回合同样带着来源。
- 原样拼接上游自由文本或以前回合写入文本的工具（摸鱼日历、油价、金价、账目列表 / 汇总）不算受信输出（D1 清单）。天气、汇率仍是上游字符串（城市名、天气状况、币种），属于接受的残余风险，影响范围同第一条。
- 返回他人可写文本的第一方只读工具（群成员昵称、入群申请留言、被检查的文本）加 `external_content` 标签，不算受信输出。漏标的风险与上一条相同，且只影响定时任务类。
- 包名伪装：本地安装一个叫 `@zhin.js/xxx` 的包可以冒充第一方。安装依赖是部署者的操作，ADR 0044 对适配器做了同样的取舍；npm 上的 `@zhin.js` 作用域只有项目维护者能发布。
- MCP 第三方工具、网页、文件、记忆、子 Agent 报告、群聊背景、图片描述都仍是外部内容，行为不变。
- 错误文本也是来源（D1 第 5 条）：`web_fetch` / `web_search` 的 `HTTP <状态码>: <原因短语>` 中原因短语由服务端决定，MCP 服务端的 JSON-RPC 错误消息、插件转述的上游报错同理。修订前抛错的路径不记来源，注入指令可以借错误文本进入模型而回合仍算「干净」，随后建定时任务、执行命令、写文件、外发都不再确认；修订后工具失败与成功同样记录（受信工具的失败记为外部内容）。
- 背景消息里机器人自己的回复不算来源（D7）。会话历史本身就不是来源：每个回合从空的来源记录开始，历史里以前回合的回复、工具结果（截到 200 字）和背景块都会再次进入模型，却不会让新回合「读过外部内容」。机器人自己的回复确实可能复述了之前回合读到的外部内容，但同一段话已经以助手消息的形式在会话历史里，把它在背景里的副本当成来源，只是把历史里已接受的残余风险重复计算一次，而且让「说过话」本身就足以触发确认。读过外部内容的**那个**回合仍按原规则确认；而且那个回合写的回复不进投递记录（决定 5），下一回合它在背景里的副本照旧计来源——否则注入内容只要让模型在回复里复述一句「回复『好』即可」，就能借用户下一句「好」在干净回合里执行高风险动作。放宽因此只覆盖干净回合写的回复，它的内容只来自主人的消息和会话历史；并且只认「本会话里本 Agent 按原文投递的回复」：成员消息、场景事件、插件命令或其他会话发出的机器人消息仍是外部内容，证据缺失时（富媒体回复、中间件改写、重启后）一律按外部内容处理。

- 私聊里发起人自己的原文消息不算来源（D8）。私聊的背景只有发起人和机器人两方，发起人自己更早发的、按原文存下的话，信任等级与发起本回合的那条消息相同——如果它带着注入指令，那就是发起人自己写的，本回合的输入同样可以写。放宽因此只覆盖「同一个人、同一会话、未经改写的纯文本」：身份按核心记录的发送者 id 与回合 principal 同源比对，会话按包含平台、endpoint 的规范键比对；原文证据在任何中间件或插件看到消息之前取得，读出时再按存储内容重算，被改写、带引用 / 转发 / 媒体 / @、或证据缺失时一律计来源。群聊、频道不放宽：同一个群里别人可以在发起人前后插话，背景属于共享内容，按原规则确认。能直接向 IM Runtime 注入「入站消息」并冒用发起人 id 的代码（适配器、插件）本来就能以发起人身份发起回合，这项放宽不给它更多能力。适配器的 `inboundTextAuthoredBySender` 声明是这项放宽的前提：声明错了（例如把卡片或别人的转发渲染成文本段），第三方内容就会拿到证据，所以只给逐项核实过的官方适配器声明，第三方适配器默认没有。
  残余风险：(1) 平台不标记的单条转发 / 复制粘贴与发起人自己打字不可区分，按发起人自己的话处理——发起人选择转发等于自己发出；(2) 能写会话事件库的人（数据库写权限、带存储句柄的插件）写不出能通过核对的证据，但能删改消息让它失去证据（只会更严）；(3) HMAC 密钥只在进程内存，**没有轮换机制**，重启即换新密钥，旧证据全部失效；进程内能读到 `ConversationRuntime` 私有字段的代码（同进程的恶意插件）理论上能取到密钥，但它本来就能以发起人身份发起回合；(4) 适配器声明是静态的，平台日后新增一种「以文本形式到达的转发」时需要重新核实。重置提示与清空 / 归档的回复只用固定模板，不含任何读到的内容，记为本会话投递时同样要求回执摘要与原文一致。

**收紧的部分**：写文件新增为高危类别（读过任何内容后确认，无人值守时拒绝）；新增 `always` 级别；字符串 `external_content` 也覆盖写文件。已有的无人值守任务如果「读网页后写文件」，现在会被拒绝，启动日志和 `zhin doctor` 会提示，部署者可以按类别 `fileWrite: off` 恢复。模型在读过任何内容后创建的新任务，每次运行时的高危动作都会被拒绝（D2.1）；`schedule_preview` 至少按 `any_content` 确认。

**为什么可以接受**：放宽只落在影响最小、可撤回的一类动作（创建定时任务）上，任务运行时的高危动作由持久化的来源继续约束，换来的是部署者不再因为正常请求被打断而整体关掉防护——那会同时失去对执行命令、外发、改配置的保护，风险远大于这一处放宽。显式配置不放宽，`off` 有 doctor 提示和更窄的替代写法。

## 实施

一个提交完成，同一版本发布：

- `@zhin.js/agent`：`security/provenance.ts`（分级、来源判定、配置解析、定时任务来源快照与恢复）、`tool/turn-tool-runtime.ts`（按类别判定、无人值守兜底、工具执行期间绑定来源、到点回合恢复来源）、`schedule-manager.ts`（`schedule_add` / `schedule_preview` 记录来源）、`assistant/`（`ScheduleJob.provenance`、SQL 列 `provenance_json`、JSON 存储）、`schedule-domain/execution-domain.ts`、`task-executor.ts`、`turn/turn-ingress.ts`、`plugin-runtime/host/assistant-runtime.ts`、`plugin-runtime/capability-ingress.ts`（`ToolCapability.firstParty`）、`security/trust-level.ts`（写文件名称判定）、`security/approval-channel-conflicts.ts`、`security/approval-policy-fingerprint.ts`、`config/`；eval 用例。
- `@zhin.js/runtime`：`host-config-schema.json`。
- D8：`@zhin.js/im-contract`（`ConversationMessage.inboundTextDigest`、`ConversationContextBlock.inboundActorId` / `inboundTextDigest`）、`@zhin.js/adapter`（能力画像 `messaging.inboundTextAuthoredBySender`）、`@zhin.js/core`（`plugin-runtime/im/conversation-runtime.ts` 以 HMAC 写入并复核证据，`IncomingMessage.forwarded`，`outbound-segments.ts` 的 `adapterDeclaresInboundTextAuthoredBySender`，`inbound-runtime.ts` 传入声明）、官方适配器 `sandbox`、`telegram`（`isTelegramRelayedMessage`、`forwarded` 标记）、`onebot11`、`napcat`、`discord` 的画像声明、`@zhin.js/agent`（`session/context-provenance.ts` 的 `ownPrivateInbound` / `unrepresentedConversationBlocks`、`plugin-runtime/full-agent-turn-engine.ts`、`plugin-runtime/ingress/reset-hint.ts`、`unified-mailbox-spine.ts`、`ingress-management-stage.ts`）；eval 用例 `injection-own-private-unhandled-message-not-tainted`、`injection-own-group-unhandled-message-gated`、`injection-own-private-other-sender-gated`、`injection-own-private-forwarded-gated`（框架选项 `backgroundOwnMessages`，经真实的核心 `ConversationRuntime` 写入并读出）。
- `@zhin.js/cli`：`zhin doctor`。
- 官方插件：`@zhin.js/plugin-60s` 补 `readOnly: true`，其中 `moyu`、`fuel_price`、`gold_price` 另加 `external_content`；`@zhin.js/plugin-ledger` 的 `ledger_list`、`ledger_summary` 加 `external_content`；`@zhin.js/adapter-qq`、`@zhin.js/plugin-content-moderation` 补 `external_content` 标签。
- 文档：`docs/ai/agent.md`（及英文版）、配置参考。
