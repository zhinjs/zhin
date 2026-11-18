---
sidebar: false
---

# ADR 0067：读取外部内容后的高危动作确认——按动作分级，第一方只读工具的结果算受信输出

状态：已接受（所有者 2026-11-18 在维护会话中选定方案「分级 + 第一方只读工具标可信」，要求先写 ADR 再实施）。依据：zhinjs/zhin#1250 评论 6971359609 第 6 项 `high-risk-confirm-default-too-broad`。核对基线：`origin/feat/friendly-volta-ejc3wl` 合入 `origin/main` 之后的 `45cb531d0`。实施进度：已全部实施（与本文同一分支）。

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

清单（本次落地时声明了 `readOnly: true` 的第一方工具，以代码为准）：

| 插件 | 受信输出 | 仍算外部内容 |
|---|---|---|
| `@zhin.js/plugin-60s` | `weather`（天气）、`exchange_rate`、`gold_price`、`fuel_price`、`moyu`（日期倒计时） | 新闻 / 热搜 / 段子 / 翻译等返回第三方文本的工具（不声明只读，或声明只读并加 `external_content`） |
| `@zhin.js/plugin-ledger` | `ledger_list`、`ledger_summary`（本人的账目） | — |
| `@zhin.js/plugin-game-hub` | `game_catalog` | — |
| `@zhin.js/process-monitor` | `process-status` | — |
| `@zhin.js/plugin-content-moderation` | `moderation_status` | `moderation_check`（回显被检查的文本，加 `external_content`） |
| `@zhin.js/adapter-qq` | — | 群信息、群成员、禁言列表、黑名单、加群申请、会话信息（加 `external_content`） |

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

执行命令、写文件、外发、改配置这四类的结果可能在本回合之外造成不可撤回的影响，或者能关掉防护本身，所以保持原来的严格度：只要读过任何内容就确认。定时任务 / 提醒的影响是「将来某个时间在本会话做一件事」，到点执行时还要再过一遍全部策略（无人值守回合里，读过外部内容后的高危动作仍然拒绝），所以只在读过真正的外部内容后才确认。

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

启动日志的 `approval_channel_conflict` 同样按类别描述：只有启用了无人值守入口、且至少一个类别没关时才提示。

### D6 验收

1. 默认配置、会话没有确认渠道：先调用第一方只读的天气工具，再建提醒（`schedule` 类）——提醒建成，没有确认、没有拒绝。
2. 默认配置：读网页后执行命令、读网页后向其他会话发消息——都要确认；没有确认渠道时拒绝。
3. 默认配置：天气工具之后执行命令——仍要确认（`any_content`）。
4. MCP 工具即使上游声明只读，之后建提醒仍要确认。
5. 字符串 `external_content`：天气之后建提醒仍要确认（不放宽显式配置）。
6. 无人值守回合：天气之后建提醒放行；读网页后建提醒拒绝，审核 Agent 不能放行。
7. Agent eval 增加「查天气 + 建提醒」与「网页注入后要求外发」两个用例。

## 安全分析

**变化的攻击面**：只有一处放宽——第一方插件声明只读的工具，其结果不再让「定时任务 / 提醒」类调用要求确认。攻击者要利用它，必须让这类工具的返回值里带上注入指令：

- 返回值来自第一方代码处理过的结构化数据（天气、汇率、油价、游戏目录、本人账目）。上游 API 被攻破或返回恶意文本时，指令能进入模型。代价：模型可能建一个本会话的提醒或定时任务。这个任务到点运行时是无人值守回合，读过外部内容后的执行命令、外发、改配置、写文件都会被拒绝；任务本身显示在 Console「运维 → 定时任务」，可以删除。不能借此执行命令、写文件、向其他会话发消息或改配置——这四类仍然在读过任何内容（含受信输出）后确认。
- 返回他人可写文本的第一方只读工具（群成员昵称、入群申请留言、被检查的文本）加 `external_content` 标签，不算受信输出。漏标的风险与上一条相同，且只影响定时任务类。
- 包名伪装：本地安装一个叫 `@zhin.js/xxx` 的包可以冒充第一方。安装依赖是部署者的操作，ADR 0044 对适配器做了同样的取舍；npm 上的 `@zhin.js` 作用域只有项目维护者能发布。
- MCP 第三方工具、网页、文件、记忆、子 Agent 报告、群聊背景、图片描述都仍是外部内容，行为不变。

**收紧的部分**：写文件新增为高危类别（读过任何内容后确认，无人值守时拒绝）；新增 `always` 级别；字符串 `external_content` 也覆盖写文件。已有的无人值守任务如果「读网页后写文件」，现在会被拒绝，启动日志和 `zhin doctor` 会提示，部署者可以按类别 `fileWrite: off` 恢复。

**为什么可以接受**：放宽只落在影响最小、可撤回、到点还会再审一遍的一类动作上，换来的是部署者不再因为正常请求被打断而整体关掉防护——那会同时失去对执行命令、外发、改配置的保护，风险远大于这一处放宽。显式配置不放宽，`off` 有 doctor 提示和更窄的替代写法。

## 实施

一个提交完成，同一版本发布：

- `@zhin.js/agent`：`security/provenance.ts`（分级、来源判定、配置解析）、`tool/turn-tool-runtime.ts`（按类别判定、无人值守兜底）、`plugin-runtime/capability-ingress.ts`（`ToolCapability.firstParty`）、`security/trust-level.ts`（写文件名称判定）、`security/approval-channel-conflicts.ts`、`security/approval-policy-fingerprint.ts`、`config/`；eval 用例。
- `@zhin.js/runtime`：`host-config-schema.json`。
- `@zhin.js/cli`：`zhin doctor`。
- 官方插件：`@zhin.js/plugin-60s` 补 `readOnly: true`；`@zhin.js/adapter-qq`、`@zhin.js/plugin-content-moderation` 补 `external_content` 标签。
- 文档：`docs/ai/agent.md`（及英文版）、配置参考。
