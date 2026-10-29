---
sidebar: false
---

# ADR 0044：适配器能力画像——规范在 zhin，能力由适配器注入，功能按能力组合

状态：Proposed

关联：[ADR 0041](./0041-prompt-segments-and-message-headers.md)（段组装器、`platform` 段、场景事实）、[ADR 0042](./0042-first-turn-token-budget.md)（工具分档）、[ADR 0038](./0038-continuous-input-merge.md)（`liveDanmaku` 能力，本 ADR 的先例）、[ADR 0035](./0035-comment-reply-adapter-contract.md)（评论回复适配器契约）。

## 背景

理想的分工是：**zhin 提供规范；适配器按规范注入能力；插件根据组合出来的能力完成实际功能。** 平台差异应由适配器声明，而不是在 zhin 内部写 `if (platform === 'xxx')`；这些差异最终决定 prompt 怎么写、agent 能做什么。

2026-10-29 扫描 main，核心层仍有按平台名写死的分支：

| 位置 | 硬编码 | 后果 |
|---|---|---|
| `basic/cli/.../agent/turn/request.ts` | `adapter !== 'icqq'` 则不查群 / 成员资料 | 其他平台的场景行、消息头为空 |
| `agent/typing-indicator/adapter-integration.ts` | 按 icqq / telegram / discord / kook / slack / qq / napcat / sandbox 列「正在输入」做法 | 新平台要改 agent 包 |
| `core/side-event/normalize.ts`、`types.ts` | kook、slack、icqq、onebot、napcat 各自的通知映射 | 事件标准化在核心里 |
| `agent/media/media-publisher.ts` | `platform !== 'icqq'` 才落盘大文件 | 投递约束写死在 agent |
| `ai/agent/tool-filter.ts` | 查询含 "icqq" / "qq 点赞" 时筛特定工具 | 工具选择与平台名耦合 |
| `agent/security/exec-policy.ts` | 命令名 `icqq` 特判 | 安全策略混入平台逻辑 |
| `cli/.../sandbox-policy.ts`、`console/page-renderer.ts` | `platform === 'sandbox'` / `localName === 'sandbox'` | 沙箱平台权限与页面写死 |

已有的正确样板：`AdapterDefinition.segments`（消息段能力，含表情回应）、`liveDanmaku`（合流只看能力不看平台名）、`endpoint-management` 的可选方法（实现了才有）、插件 `platform` 段注入（ADR 0041 D）。

另外，平台能力**随会话场景变化**：同一平台在群聊和私聊能做的事不同；Bot 是管理员还是普通成员，能否禁言 / 踢人不同；被禁言、处在被动回复窗口外时能否主动发消息也不同。能力不能只是平台级的一张静态表。

Fin 2026-10-29 拍板：

1. 能力分组按本 ADR §1。
2. prompt 里的平台说明 **自动生成 + 适配器自定义都支持**。
3. 协议相近的适配器（OneBot / NapCat / icqq）**共享一个事件映射包**。
4. 能力要考虑**不同会话场景下的差异**。

## 决策

### 0. 原则

1. **核心只认能力，不认平台名**：zhin 的 core / agent / ai / cli 运行时代码里不出现平台名字面量；需要差异的地方一律读能力。
2. **没声明 = 不支持**：未声明的能力按「不支持」处理，功能自动降级（不发、不显示、不提供工具），而不是报错或猜。
3. **能力分两层**：静态画像（按会话类型声明，构建时可校验）+ 动态解析（按当前会话与事实收窄），动态层**只能收窄、不能放宽**静态层。
4. **能力是事实，不是权限**：能力描述平台能做什么；产品授权（谁可以让 Bot 做）仍由角色、硬闸、审批决定，二者取交集。

### 1. 能力目录（规范，zhin 提供类型）

`AdapterCapabilityProfile`，分六组。每组按会话类型（`private` / `group` / `channel` / `thread`，以及平台声明的其他类型）分别声明，缺省继承 `default`。

| 组 | 字段（示例） |
|---|---|
| **消息** `messaging` | 支持的消息段与降级（沿用 `segments`）、单条长度上限、`mention`（@ 人 / @ 全体）、`quote`（引用回复）、`reaction`（表情集合）、`recall`（可撤回时限、能否撤回他人）、`edit`、`forward`、单轮最大条数 |
| **会话场景** `scene` | 能否查群信息、能否查成员资料、平台角色词汇及到 `owner / admin / member` 的映射、禁言语义（时长 / 全员）、成员上限、是否有名片 / 头衔 |
| **事件** `events` | 会发出的标准事件名集合（`member.joined`、`member.left`、`member.role_changed`、`member.muted`、`member.card_changed`、`message.recalled`、`poke` …）；原始事件 → 标准事件的映射由适配器（或共享映射包，§3）负责 |
| **交互反馈** `feedback` | 「正在输入」/ 执行状态的方式（`typing` / `reaction` / `status-message` / `none`）及其参数 |
| **投递约束** `delivery` | 被动回复窗口（时长 / 条数）、主动发送是否允许、频率限制、媒体大小上限、是否需落盘后发送（spool）、需要的消息序号等 |
| **prompt 贡献** `prompt` | 自动生成规则的开关与适配器自定义文本（§4） |

`liveDanmaku`、评论回复（ADR 0035）等既有能力并入对应分组，保留原字段名作为别名一个版本。

### 2. 注入方式（适配器按规范实现）

- `defineAdapter({ ..., profile })`：静态画像，模块加载时校验（未知字段、类型错误即拒绝装配，fail closed）。
- `resolveCapabilities?(context)`：可选的动态解析，入参为当前会话（`ConversationRef`）与可信事实（ADR 0041 §6 的 `TurnContextState`：Bot 角色、禁言、发送者角色等）及投递状态（被动窗口剩余等），返回对静态画像的**收窄**补丁（例：Bot 不是管理员 → `scene.moderate` 关闭；被禁言 → `delivery.send` 关闭；被动窗口外 → `delivery.proactive` 关闭）。运行时校验返回值只收窄，放宽字段被丢弃并记警告。
- 实际操作仍走现有端口：`operations`、`endpoint-management` 方法、`send`。画像声明「能做」，端口负责「去做」；声明了却未实现端口 → 装配期报错。
- 结果按回合计算一次，作为 `TurnCapabilities` 挂到 Turn 上（与 ADR 0042 W2 的工具分档、ADR 0041 的场景事实同一处），随会话事实缓存（ADR 0041 二级缓存）一起失效。

### 3. 共享事件映射包

- 新包 `@zhin.js/adapter-onebot-events`（名称实现时定）：OneBot v11 / NapCat / icqq 共用的原始通知 → 标准事件映射，从 `core/side-event/normalize.ts` / `types.ts` 迁出；icqq 的差异以小的覆盖表表达。
- KOOK、Slack 等各自的映射迁入各自适配器包。
- `core` 只保留标准事件名的定义与校验，不再出现任何平台映射表。

### 4. prompt 里的平台说明

`platform` 文本段（ADR 0041 §3）由两部分组成，按会话场景渲染：

1. **自动生成**：由本回合的 `TurnCapabilities` 生成固定模板的短句，只写对行为有影响的项，例如「支持表情回应（👍 ❤️ 😂…）」「单条消息最多 2000 字」「不能 @ 全体」「当前不能撤回他人消息」「被动回复窗口剩 2 条」。模板在 zhin 内，措辞统一，可测试、可缓存（按场景类型 + 收窄结果取值，组合有限）。
2. **适配器自定义**：`profile.prompt.text`（或按会话类型分别提供），作为同一 `platform` 段中的附加小节。适配器是已安装的代码，按插件同等信任处理；但第三方适配器的文本沿用 #726 的 `external_content` 标注，不能授予权限、不能覆盖安全规则。长度上限 600 字符，超出截断并告警。
- 缓存（ADR 0042 §1）：两部分都只依赖「适配器 + 会话类型 + 收窄结果」，同类会话跨会话稳定；动态部分（窗口剩余条数等）放进 `scene` 段，不进稳定前缀。

### 5. agent 与插件按能力组合

- **工具可见性**：工具（及 skill）可声明 `requiresCapabilities`（如 `scene.moderate`、`messaging.recall.others`）；回合内能力不满足即不出现在工具列表（与 ADR 0042 W2 分档同一过滤点），不再靠平台名或关键字筛选（替换 `tool-filter.ts` 的 icqq 关键字）。
- **出站**：渲染与投递按 `messaging` / `delivery` 决定拆分、降级、落盘与被动窗口处理（替换 `media-publisher.ts` 的 icqq 判断）。
- **交互反馈**：`feedback` 声明驱动「正在输入」（替换 `typing-indicator` 的平台表）。
- **场景事实**：`scene` 声明决定是否查询群 / 成员资料（替换 `request.ts` 的 `adapter !== 'icqq'`）。
- **沙箱**：`sandbox` 平台改为声明一个能力（如 `runtime.sandbox`），策略读能力。
- **插件**：通过 `TurnCapabilities` / 端点能力查询 API 判断能否做某事，同样不写平台名。

### 6. 约束检查

新增 `pnpm check:no-platform-branches`（并入 `check:all`）：在 `packages/im/{core,agent,ai}/src`、`basic/cli/src/plugin-runtime` 中禁止平台名字面量（`'icqq'`、`'qq'`、`'napcat'`、`'onebot'`、`'kook'`、`'slack'`、`'discord'`、`'telegram'`、`'sandbox'`、`'bilibili'` 等，列表可扩展）作为比较对象；测试、类型声明中的示例、文档字符串除外；确需例外须写明理由并登记白名单。

### 7. 迁移

| 现状 | 迁移目标 |
|---|---|
| `request.ts` icqq 场景事实 | `scene.groupInfo` / `scene.memberProfile` + 端口 |
| typing indicator 平台表 | `feedback` |
| `core/side-event` 映射表 | §3 共享包 / 各适配器 |
| `media-publisher` icqq 落盘 | `delivery.spool` |
| `tool-filter` icqq 关键字 | `requiresCapabilities` |
| `exec-policy` icqq 命令特判 | 移入 icqq 适配器的工具 / 命令声明 |
| sandbox 策略与页面 | `runtime.sandbox` 能力 |

icqq 先完整声明（它是当前主力），其余适配器按能力补齐；未补齐的能力按「不支持」降级。

### 8. 实现分工（多 agent 并行，最后一个 PR）

| 工作项 | 内容 |
|---|---|
| C1 规范 | `AdapterCapabilityProfile` 类型、校验、`resolveCapabilities` 收窄语义、`TurnCapabilities` 计算与缓存 |
| C2 prompt | §4 自动生成模板 + 自定义文本、`platform` / `scene` 段接线 |
| C3 消费方迁移 | §5：工具 `requiresCapabilities`、出站、交互反馈、场景事实、沙箱 |
| C4 事件映射包 | §3：共享包 + 各适配器映射迁出 core |
| C5 适配器声明 | icqq 完整画像；其余适配器的基础画像 |
| C6 守卫 | §6 检查脚本 + 白名单 |

C1 先行；C2–C5 依赖 C1 的类型；C6 最后（迁移完成后才能全绿）。

## 验收标准

1. core / agent / ai / cli 运行时代码中无平台名分支，`check:no-platform-branches` 通过。
2. icqq 群聊中，Bot 被撤管理员后，踢人 / 禁言工具从工具列表消失，prompt 平台说明同步变化；恢复后重新出现。
3. 同一 icqq 实例，私聊与群聊的平台说明不同；同类会话跨会话逐字节相同。
4. 一个只声明了 `messaging` 基础能力的新适配器，不改 zhin 任何代码即可接入，不支持的功能自动降级。
5. OneBot / NapCat / icqq 的进出群、改名片等事件经共享包得到相同的标准事件。
6. 适配器自定义 prompt 文本出现在 `platform` 段；第三方适配器的文本带 `external_content` 标注；超长被截断。

## 待 Fin 确认的默认值

- 共享映射包名：`@zhin.js/adapter-onebot-events`。
- 适配器自定义 prompt 文本上限 600 字符。
- `resolveCapabilities` 只能收窄；放宽字段丢弃并告警。
- 平台名白名单初始为空，例外须逐条登记。

## 非目标

- 跨适配器的统一账号 / 身份体系。
- 能力的远程动态下发（只在代码中声明）。
- 改变产品授权模型（角色、硬闸、审批不变，仅与能力取交集）。

## 结果

- 新平台只需实现适配器与能力画像即可接入，zhin 核心零改动。
- prompt 的平台说明与 agent 的可用工具随真实能力与会话场景自动变化。
- 平台差异集中在适配器，核心代码不再增长平台分支。
