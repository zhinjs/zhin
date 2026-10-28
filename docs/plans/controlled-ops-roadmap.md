# zhin 受控落地路线图

> 受控为底线的四期落地方案：审计 schema、控制面 API、工具硬闸清单、每期切片与验收都写到可开工粒度。第 0 期优先交给实现方落 ADR 再写码。
>
> 来源：[zhin 受控落地路线图](https://cursor.com/canvas/store-202e10d1-313a-46a0-88e3-a8d41ce25f18/681dae45-c1f9-4e32-84f5-68d0b6d31df2)（Canvas 导出，2026-10-28）

## 目录

- [原则与目标态](#原则与目标态)
- [已有底座与缺口](#已有底座与缺口)
- [能力地图](#能力地图)
- [四期总览](#四期总览)
- [第 0 期详设](#第-0-期详设)
  - [审计事件 schema](#审计事件-schema)
  - [控制面](#控制面)
  - [工具硬闸](#工具硬闸)
  - [第 0 期切片](#第-0-期切片)
- [第 1 期详设](#第-1-期详设)
- [第 2 期详设](#第-2-期详设)
- [第 3 期详设](#第-3-期详设)
- [不做清单与依赖](#不做清单与依赖)
- [分工与交接](#分工与交接)
- [验收清单](#验收清单)

## 原则与目标态

**一句话：** zhin 不做「更会闲聊的玩具」，做「能在群里过日子、出事能捏住的 agent 运行时」。

目标态：感知现场 → 受控决策 → 人可审计。默认安静，授权才动。发言门禁、工具闸、审批流和回放都捏在运营者手里；模型不能自解禁。

### 必须成立

- skip / mute / 只读 / 转人工 永远优先于聪明回复
- 每次醒、拦、放行都能追到策略与事件
- 危险出站动作无人批 = 零执行
- 配置与闸变更走 revision，可回滚

### 设计约束

- 薄：固定维度、短 ephemeral 注入
- 对齐现有：session-gate、config:patch、Console token
- 场景驱动，不为 demo 堆技能
- 每期可单独上线，后一期叠前一期

## 已有底座与缺口

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 会话画像 / 关系好感 | 已合 #995 | ai_session_profiles + ai_user_relations；短 `[Session]`/`[Relationship]`；speak gate |
| 状态感知唤醒 | 已合 #997 | sceneEvents debounce/限频；不能发言则 skip 并记因 |
| config:patch | 已有 | expectedRevision + 白名单路径；Console RPC |
| 工具硬闸 | 已合 #1006 | risk + humanOnly 审批；deny 不回灌 |
| B 站审核 MVP | 半成品 #971 | 草稿+扫码+审批页；队列/续期在第 2 期 |
| 决策审计 | 写路径+回放已合 | #1003 / #1005 / console#34 |
| 全局静音/急停 | 已合 #1008 | 四开关 + revision；Console 操作页可选 |
| 转人工状态机 | 缺 | 客服场景站不住 |

## 能力地图

| 能力带 | 补什么 | 主场景 | 期次 |
| --- | --- | --- | --- |
| 审计与策略 | 决策日志、回放、全局闸、硬闸 | 全部 | 0 |
| 运营动作 | 欢迎/公告/日程、人批管理动作 | 社团 / 游戏 | 1 |
| 客服闭环 | 排队、转人工、SLA、知识库 | 客服 | 2 |
| 审核台 | 队列、风险标签、定时、续期、角色 | 内容 | 2 |
| 身份与信任 | 可见可改画像、遗忘导出 | 个人 / 客服 | 2 |
| 场景包与观测 | 模板、指标、回归 | 自建 | 3 |

## 四期总览

1. **第 0 期 · 受控底座（2–3 周）** — 审计 schema + 写路径 + Console 回放 + 实例/会话闸 + 危险工具硬闸
2. **第 1 期 · 群运营闭环（3–4 周）** — 欢迎/公告/提醒剧本；管理动作审批卡；冷场静默
3. **第 2 期 · 客服与审核台（4–5 周）** — 转人工状态机 + SLA；B 站 v1.1；画像面板
4. **第 3 期 · 场景包与可观测（持续）** — 一键场景包；ambient/skip/审批指标；拟人受控回归

## 第 0 期详设

**范围：** 只做「捏得住」。不接欢迎语、不接转人工、不接 B 站队列。依赖 #995 已合、#997 合入后对齐 scene_event skip 原因写入审计。

### 审计事件 schema

建议表名 `ai_decision_events`（或等价），append-only。一行 = 一次决策节点，不是整回合糊成一条。回合用 `turn_id` 串起。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| ts | datetime | 事件时间 |
| turn_id | string | 同一次入站唤醒共享 |
| instance_id | string | 机器人实例 |
| platform / scene_id | string | 会话键，与会话画像一致 |
| user_id | string? | 涉及用户；系统事件可空 |
| kind | enum | 见下表 kind 清单 |
| outcome | enum | allow / deny / skip / defer / error |
| reason_code | string | 稳定机器码，如 cannot_speak / muted / hard_gate |
| reason_detail | string? | 短人读说明，≤200 字 |
| payload | json | 结构化上下文（事件名、工具名、policy 名），禁密钥 |
| actor | enum | system / model / operator / policy |
| actor_id | string? | Console token / 用户 id |

kind 最小集（可扩展，禁止自由字符串乱飞）：

- `inbound_wake` — 聊天或 scene-event 唤醒
- `speak_gate` — 发言门禁
- `control_gate` — 静音/只读/仅@/急停
- `ambient_decision` — 插话判定
- `model_skip` — 跳过模型（含 scene_event_wake_skipped_cannot_speak）
- `model_run` — 调用模型起止与结果摘要
- `tool_call` / `tool_hard_gate` / `tool_approval` — 工具路径
- `outbound` — 实际出站（或被拦）
- `config_change` / `control_change` — 人改配置或闸

Console：列表按时间倒序；点开 `turn_id` 看时间线；导出该窗口 JSON。保留默认 14 天可配。

### 控制面

两级：实例默认 + 会话覆盖。生效顺序：急停 → 实例静音 → 会话静音 → 只读 → 仅@ → 正常 speak/ambient/scene 策略。

| 开关 | 作用 | 出站 |
| --- | --- | --- |
| emergency_stop | 整实例停机 | 禁一切主动出站与危险工具 |
| muted | 静音 | 禁主动发言；仍可记审计；管理工具仍走硬闸 |
| read_only | 只读 | 禁一切写动作（含发消息、改群） |
| mention_only | 仅 @ / 私聊才进入模型 | 未命中直接 skip |

API 建议挂现有 Console RPC：`control.get` / `control.set`（或并入 config:patch 白名单 `ai.control.*`）。`set` 必须带 expectedRevision；变更写 `control_change` 审计。模型侧无工具可改这些字段。

### 工具硬闸

与 `execApprovalMode=ask` 区分：ask 是再问一轮；硬闸 deny = 本次调用直接失败，不回灌模型重试同一危险调用（可记一条 tool_hard_gate）。

| 类别 | 示例 | 默认 |
| --- | --- | --- |
| 成员治理 | 踢人、禁言、解禁、改名片/头衔 | requireApproval |
| 内容发布 | 群公告、频道帖、B 站评论发布 | requireApproval |
| 资金/采购 | 任何支付或下单 | requireApproval + 默认禁用 |
| 身份 | 改 bot 资料、解绑登录 | requireApproval |
| 只读查询 | 查成员、查日程 | 允许（仍记审计） |

实现要点：工具注册表增加 `risk: "dangerous" | "safe"`；dangerous 在执行前查审批队列；Console 出审批卡；超时默认 deny。插件声明 risk，宿主可上调不可下调到无审批。

### 第 0 期切片

1. **切片 A · ADR + schema** — ADR 定稿；迁移 ai_decision_events；reason_code 枚举；单测序列化
2. **切片 B · 写路径** — speak_gate / control_gate / ambient / model_skip / outbound 埋点；#997 skip 原因对齐
3. **切片 C · Console 回放** — 列表 + turn 时间线 + JSON 导出；机器人状态页入口
4. **切片 D · 控制面** — 实例/会话四开关 + revision；生效顺序单测
5. **切片 E · 硬闸** — risk 标注、审批队列、deny 不回灌；核心危险工具名单

**第 0 期验收：** 能解释上一小时为何回/不回；一键静音后无主动出站；危险工具无审批零执行；审计导出可复现一次真实回合。

## 第 1 期详设

前置：第 0 期审计与硬闸可用；状态感知已合。

1. **运营剧本**
   - 入群欢迎 / 退群记录：模板存会话画像或 session 配置；发送前可预览
   - 公告：草稿 → Console 审批 → 发送；失败写审计不盲重试
   - 冷场：连续 N 条未 @ 且 ambient 拒绝 → 会话临时 mention_only（可配）
2. **日程**
   - 会话级事件：title、at、remind_before；到点 scene-event 风格唤醒
   - 仍走 control + speak gate；提醒文案模板化
3. **群管协同**
   - 踢/禁/改名片 = 硬闸审批卡；审批人 = Console 权限
   - 限频：同会话同动作冷却，命中记审计

**验收：** 真实社团群：欢迎、活动提醒、人批公告；误操作可从审计回放定位。

## 第 2 期详设

1. **客服状态机**
   - 状态：bot → waiting_human → human → bot（人释放）
   - waiting_human / human：模型与 ambient 全 skip；仅人工出站
   - 入口：用户指令 + Console 按钮；SLA 超时通知运营
   - 知识库：只读检索工具，答案带来源片段，写入审计 payload
2. **审核台（#971 v1.1）**
   - 队列：风险标签、批量通过/拒、定时发
   - cookie 自动续期；断了明确告警
   - 多账号 + 审批角色 ≠ 登录角色
3. **画像信任**
   - Console 面板：关系、备注、偏好；可改 / 遗忘 / 导出
   - 敏感备注方案单独短 ADR（加密或本地优先）后再落

**验收：** 「转人工」后 bot 停答、运营接走；审核队列日清；画像用户侧可改可忘。

## 第 3 期详设

1. **场景包**
   - 社团包 / 客服包 / 审核包 = 默认配置 + Console 导航 + 示例剧本
   - 一键启用 = 白名单 config:patch + 打开页面；可一键停用
2. **观测与回归**
   - 指标：ambient 决策率、skip reason 分布、审批等待、硬闸拒绝率
   - 回归集：受控用例（静音/硬闸/转人工）+ 拟人用例；合码前后对比
3. **可选**
   - 跨平台身份：仅显式绑定
   - 游戏子包：报名签到、战报卡片

## 不做清单与依赖

| 项 | 内容 |
| --- | --- |
| 已落地 | #995 会话画像 + 发言门禁 |
| 第 0 期 | A–E 已合 |
| 在途（导出时快照，以 main 为准） | 第 1 期群运营切片；G6 IM 审批等 |
| 半成品 | #971 B 站 MVP → 第 2 期加深 |
| 配置通道 | config:patch + Console RPC |

**明确不做：**

- 无界长期记忆 / 黑盒养成人格
- 模型自行解除静音或硬闸
- 未绑定的跨平台身份猜测
- 全自动踢人禁言发帖
- 与场景无关的 multimodal 炫技技能面

## 分工与交接

建议实现所有权（Fin 可改）：

| 块 | 建议所有者 | 产出 |
| --- | --- | --- |
| 第 0 期 ADR + 审计/控制/硬闸 | clever（贴近 agent 主链） | ADR PR → 切片 A–E PR |
| 第 1 期运营剧本 | clever | 模板 + 审批卡 + 日程唤醒 |
| 工具宿主硬闸与 runtime 韧性 | zhin-resilience 协查 | 执行路径 fail-closed |
| 受控/拟人回归集 | zhin-eval | 第 3 期指标与对比 |
| 产品拍板 / 合入 | Fin | 验收与优先级 |

**交接包给实现方：** 本文即需求真源。clever 主扛：切片 A ADR（docs）→ B 写路径 → C Console → D 控制面 → E 硬闸。每切片单独 PR，绿了入队；ADR 先于大实现合入。runtime 硬闸协查可拉 zhin-resilience。

## 验收清单

- [x] #997 状态感知合入 main (`e012b85`) — 11:35
- [x] 第 0 期 ADR 合入 (#999) — `9f9d732`
- [x] 切片 A schema (#1001) — `c4d2801`
- [x] 切片 B 写路径 (#1003) — `881e1c90f`
- [x] 切片 C Console 回放 (#1005 + console#34) — `f52552e70` / `7f06792e`
- [x] 切片 D 控制面 (#1008) — `1440556f1`
- [x] 危险工具硬闸 fail-closed (#1006) — `19d3f58e4`
- [x] 第 0 期 A–E 主链合完 — 可选 Console 开关页
- [x] 第 1 期 ADR (#1010) — `1878744d8`
- [ ] 第 1 期社团群垂直切片
- [ ] 第 2 期转人工 + 审核队列 + 可见画像
- [ ] 第 3 期场景包 + 观测

**节奏：**

- **双周切片** — 可演示垂直切片 + 审计讲清一次真实回合
- **先运营面后协议** — Console 可用优先于新 adapter 事件
- **主链不堵** — 场景包与观测不阻塞第 0/1 期合入
