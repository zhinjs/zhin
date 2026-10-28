# 默认行为规范

本文是 `ai.agent.*` 默认行为的**唯一权威文档**（#735）。代码默认值见 `packages/im/agent/src/config/zhin-agent-defaults.ts`；字段级参考见[生成的配置参考](/configuration/generated)。

## 按场景的默认行为

| 场景 | 信任级别 | 默认行为 |
| --- | --- | --- |
| 主人私聊 | owner | 可使用全部已启用工具；`execSecurity: deny` 时不执行 shell；`masterShell: isolated` 时仅在主人私聊中提供隔离 bash；工具预算超限时自动续跑（`autoContinue: master_dm`，最多 2 次）；进度消息仅私聊发送 |
| 群聊 | group_member | 入站队列 `groupMode: supersede`（新消息替换排队中的旧轮次，最多排队 5 轮）；高风险外部内容需确认；外发内容自动脱敏（`outboundCheck: redact`） |
| 受信成员 | trusted_member | 与群成员相同的护栏，但可使用受信工具；非 IM 入口（CLI、HTTP）按 trusted_member 处理 |
| 陌生人私聊 | group_member | 按群成员处理，不提升权限 |
| 无人值守定时任务 | — | `maxTokens 32000`、`maxToolCalls 15`、`timeoutMs 120000`、`execPreset: readonly` |

## 核心默认值

- 循环：`maxIterations 15`、`timeout 120000` ms
- 执行：`execSecurity deny`、`execApprovalMode auto`；网络默认关闭，`network.enabled: true` 时开放 HTTPS 出网（`network.allowedDomains` 可限定域名；未设置 `enabled` 时兼容 `execPreset: network`）；没有出网权限的回合不提供 web_fetch / web_search
- 子代理：`subagentTurnMode off`
- 工具预算：`extendBy 10`、`progressWindow 5`、`maxTotalIterations 40`、`maxWallClockMs 600000`、`failureStreakLimit 3`、`repeatLimit 2`
- 用量配额：全部为 0（关闭），`exemptOwner true`
- 危险工具硬闸：始终开启；资金类禁用（`allowFunds false`）；审批 5 分钟（`approvalTimeoutMs 300000`）未批即拒绝；每群同时最多 3 张待审卡（`maxPendingPerScene 3`），超出直接拒绝
- 群聊合流：开启（`inboundQueue.merge.enabled true`，仅群聊；窗口 `quietMs 1500` / `maxWaitMs 6000` / `maxSenders 5`）
- 上下文压缩：`thresholdRatio 0.7`
- 请求轨迹：`recordRequestBodies true`，在 Host 本地保存脱敏后的模型输入文本与工具定义；默认最多保留 7 天、总量 64 MiB。达到容量会先清理最旧轨迹，单条正文仍放不下时仅保留统计和未保存状态。设置为 `false` 停止记录新请求正文，不影响用量统计，也不删除已有记录。

## 危险工具硬闸

`execApprovalMode` 决定「普通审批」由谁回答（`ask` 问人、`auto` 交给审核 Agent、`bypass` 跳过）。危险工具硬闸是另一道门，独立于它，**不能关闭**（ADR 0036 §3）：

| | `execApprovalMode` 审批 | 危险工具硬闸 |
| --- | --- | --- |
| 管哪些工具 | `requiresApproval` 要求审批的工具、Shell / 文件策略 | 声明 `risk: 'dangerous'` 的工具、核心名单、`toolHardGate.dangerousTools` |
| 谁能放行 | 人、审核 Agent，或 `bypass` 直接放行；可以「本会话 / 始终允许」 | 只有本次的新鲜人工批准，或 Console 已批准的同参数卡片；`bypass`、审核 Agent、主人身份、记住的授权都不算 |
| 被拒之后 | 模型收到拒绝说明 | 本次调用不执行（fail closed）；模型只收到「已拒绝、需人工审批、不要重试」；本回合内同一工具 / 同类危险工具直接拒绝，不再弹审批 |
| 无人值守回合 | 按策略拒绝 | 直接拒绝，并生成一张 Console 审批卡片；批准后，下一次**同会话同参数**的调用执行一次 |

核心名单按类别默认危险：成员管理（踢人、禁言、设管理员、角色、拉人）、内容发布（群公告、频道发帖、精华、置顶、B 站评论）、资金（红包、转账、付款，**默认禁用**，`allowFunds: true` 后仍需审批）、身份（改 Bot 资料、头像、签名、解绑账号）。

另有一类按**本次调用的目标**判定，而不是按工具名：**改宿主自身**，分两档，路径都经过 realpath、`../` 折叠和大小写折叠后再匹配。**直接拒绝（不弹审批）**：`node_modules/**`（任意层）、锁文件（`pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`bun.lock(b)`、`npm-shrinkwrap.json`）、`ZHIN_PLUGIN_LIFECYCLE_FILE` 指向的文件，以及文件策略本来就拒绝的 `.env*`、`.zhin/`、根 `data/`、`config.json`、`.npmrc`；任何角色都不能写。**`self` 硬闸**：写**项目根**下的根配置（`zhin.config.*`、`config.yml|yaml`）、`package.json`、`schema.json`、根插件入口（`package.json#zhin.entry`）、`AGENTS.md`、`skills/`、`.agents/skills/`、`.git/`、`.pnpmfile.cjs`、`assistant.profile.yml`；只匹配项目根，`plugins/x/package.json` 这类嵌套文件不受影响，`pnpm-workspace.yaml` 与 `tsconfig*.json` 本阶段不管。项目根和根插件入口由宿主注入；宿主没注入时按文件名在任意层级匹配（宁可多拦）。`bash` 命令通过重定向、`tee`、`rm`/`cp`/`mv` 等写这些路径时按同样两档处理，用 `pnpm` / `npm` / `yarn` / `bun` 增删改依赖按 `self` 处理。`self` 写入可能放松硬闸、改变宿主运行的代码或触发重启，所以和其他危险类别一样，每次都要新鲜的人工批准，bypass、自动审核、主人免审、`danger-full-access` 和"记住授权"都不能放行。只读查询（查成员、查群信息）不受硬闸限制，照常记审计。

**隔离 shell 的只读挂载（#1030 P0-c）。** 上面对 `bash` 的字符串识别只是第一道（报错更友好），真正的强制是挂载：隔离容器以 `workspace-write` 挂载工作目录时，再把上述两档路径中**已存在**的部分叠加成只读绑定（`--mount type=bind,...,readonly`），所以 `sed -i`、软链写入、`mv`、`rm -rf node_modules` 都会失败（`Read-only file system` / `Device or resource busy`），与 `danger-full-access` 无关。覆盖范围：挂载目录内的项目根配置、`package.json`、`schema.json`、插件入口、`AGENTS.md`、`skills/`、`.agents/skills/`、`.git/`、`.pnpmfile.*`、`assistant.profile.*`、锁文件、`ZHIN_PLUGIN_LIFECYCLE_FILE`、`.env*`、`.zhin/`、`.npmrc`、`data/` 下除 `memory`/`media` 外的子项，以及挂载目录下**至多 4 层、最多 64 个**的 `node_modules`（扫描不进入 `node_modules`、`.git` 与符号链接）。不存在的目录（如 `skills/`、`node_modules`）用只读 tmpfs 占位，Docker 会在宿主上临时建出空挂载点，运行结束后若仍为空即删除。**不存在的文件不挂占位**：Docker 会在宿主上留下空文件，空的 `zhin.config.*` / 锁文件 / `.pnpmfile.cjs` 对热重载和包管理器更危险，所以"新建一个原本不存在的受保护文件"仍只靠字符串识别拦截。宿主没注入受保护路径时，按挂载目录自身解析惯用文件名（宁可多拦）。**残余风险：** `danger-full-access`（`isolation: none`）没有容器，无法挂载，只剩字符串识别，换成间接写法（脚本、`python -c`、`git` 钩子之类）可能绕过；指向受保护文件的符号链接本身可被替换（链接目标仍是只读）。需要硬保证时请用隔离 shell，不要给 `danger-full-access`。

**自我变更暂存区（ADR 0040 §6a，切片 A）。** 宿主在 `.zhin/changes/<id>/` 暂存 Agent 起草的变更（`change.json` 元数据 + `files/` 草稿 + `snapshot/` 回滚快照）；该目录属 P0 A 名单，Agent 的文件工具与 shell 都不能写。可写目标只有插件约定目录（`commands/`、`middlewares/`、`handlers/`、`tools/`、`components/`、`skills/`、`agents/`）、根 `AGENTS.md` 与 `skills/**`；根配置只能走字段级 `configPatch`，且补丁触及 `ai.agent.toolHardGate*`、`ai.agent.execApprovalMode`、`ai.agent.masterShell`（含整体覆盖其祖先）直接拒绝。磁盘有界：进入终态（`applied` / `rolled_back` / `rejected` / `expired` / `trial_failed`）立即删除 `files/` 与 `snapshot/`，只留 `change.json`，14 天后删除整个目录；`draft` / `ready` / `pending` 闲置 24 小时即 `expired`；`failed`（已急停）保留现场直到人标记已处理。单个变更 ≤ 5 MB / 50 个文件，整个暂存区 ≤ 50 MB，超限在写入前拒绝（`change_quota_exceeded`）。清理在启动时与之后每 6 小时各跑一次，只删暂存区内的目录且不跟随符号链接。状态迁移写入 `ai_decision_events`，`kind=self_change`，payload 只含路径与摘要，不含文件正文与配置值。

**起草变更：`change_draft`（ADR 0040 §2，切片 B）。** 用户要「加个指令 / 改个配置」时，Agent 调 `change_draft`（`risk: safe`）提交完整文件内容与可选的字段级 `config_patch`（值用 `value_json` 传 JSON 字符串）；宿主校验后写入暂存区，**不碰生产目录、不生效**。只在 IM 会话中可用，只能改自己发起的 `draft`（`change_id`），改草稿会作废旧预览。写入后宿主生成预览挂到 `change.json` 的 `plan`：每个文件的新建 / 修改 / 删除与增删行数（按行比较，移动的行不计）；影响面复用开发态文件监听的 `InvalidationPlanner`（当前代的源码归属索引），得到 `none` / `generation`（列出将热重载的插件子树与能力槽）/ `process`（需重启）；配置补丁按 Console `config:patch` 同一口径并入——宿主配置段（`http`、`database`、`ai` 等）需重启，插件段热重载对应插件。拿不到归属索引时按保守估计（文件 → 热重载，配置 → 重启）并标「估计」。预览本身 ≤ 64 KB，计入暂存区配额。审批见后续切片。

**试跑：静态检查（ADR 0040 §3，切片 C1）。** `change_draft` 写入并生成预览后，宿主立即试跑：`draft → trialing → ready`（通过）或 `trial_failed`（失败，终态，立即删除暂存正文）。静态检查全在内存里完成、不写临时文件：`syntax`——`.ts` / `.mts` / `.cts` / `.js` 用 Node 原生类型剥离解析（与生产加载 `.ts` 同一实现，`enum` 等 strip-only 不支持的语法也算失败），`.tsx` / `.jsx` 用 esbuild（与 tsx 加载器同源）；`default_export`——约定目录的能力文件须默认导出对应的 `defineCommand` / `defineMiddleware` / `defineHandler` / `defineComponent` / `defineAgentTool`（Skill / Agent 私有工具 `.../tools/<name>/index.ts` 同理）；`forbidden_import`——直调 `bot.$sendMessage`、直接 import `koa`、插件直连 `@zhin.js/kernel`、已删除的 `zhin.js/node` / `bootstrapNode`；`skill` / `agent_manifest`——`SKILL.md` 须能被 Skill 解析器接受，`agent.json` 须是 JSON 对象。结果写进 `change.json` 的 `trial`（绑定 `content_hash`，每条消息 ≤ 300 字符）；失败时错误直接回给 Agent，不出审批卡，Agent 修好后重新起草一个新变更（已试跑的变更不能再改）。指令同目录里非 `index.*` 的文件视为辅助模块，不要求默认导出 `defineCommand`。

**试跑：沙箱加载（ADR 0040 §3.3，切片 C2）。** 静态检查通过、且变更改到了约定目录时，宿主把草稿所在的插件根拷进系统临时目录（不拷 `node_modules`、`.git`、`.zhin`、`data`、`lib` / `dist`、`.env*`，不跟随符号链接；`node_modules` 以链接指回原依赖），在拷贝上应用草稿，再在**一次性子进程**里用试跑运行时装配：只装 IM 运行时，不加载任何已配置的插件实例与端点（不连真实平台），不配置模型；子进程环境只保留 `PATH` / 区域设置等，不带任何令牌；60 秒超时即杀整个进程组。装配抛错（模块加载失败、默认导出形状不对等）→ `sandbox_load` 失败；装配成功后，草稿里每个顶层约定目录的能力文件都必须被发现（例如 `commands/ping.ts` 不会被发现，应为 `commands/ping/index.ts`），否则 `capability_discovered` 失败。若不带草稿的插件根本身就装配不起来、插件根超过拷贝上限（5000 个文件 / 100 MB）或本机没有构建好的试跑运行时，记 `skipped`（不算失败，静态检查仍然把关）。只改根 `AGENTS.md` 或只有 `configPatch` 的变更不做沙箱加载（配置补丁的效果在生效后的健康检查里校验）。**磁盘**：同一时间只跑一个试跑，拷贝目录 `zhin-change-trial-*` 在试跑结束（含失败与超时）时立即删除，宿主崩溃留下的超过 1 小时的残留在下次创建试跑器时清理。沙箱加载通过后接着跑插件自带测试（见下）。

**试跑：插件自带测试（ADR 0040 §3.2，切片 C3）。** 沙箱加载通过（或未注入加载器）后，宿主对每个改到约定目录的插件根再做一次同样的拷贝（应用草稿，不拷 `node_modules` / `.env*` 等），在拷贝里找测试文件（`*.test.*` / `*.spec.*`，跳过 `node_modules`、`lib` / `dist` 等），然后在**隔离容器**里运行，与 P0-c 隔离 shell 同口径：拷贝是唯一可写挂载，插件根最近的 `node_modules` 以只读挂载，`--network none`、只读根文件系统、丢弃全部 capabilities、`no-new-privileges`、内存 1 GB / 1 CPU / 256 进程，不传入宿主任何环境变量（只有 `NODE_ENV=test`、`CI=1`、`HOME=/tmp`），120 秒超时按容器名强删。装了 `vitest` 就跑 `vitest run`，否则用 `node --test`。测试失败 → `plugin_tests` 失败，输出尾部（≤ 1000 字符）回给 Agent；不带草稿也不通过的测试（包括宿主编译的原生依赖在容器里跑不起来）、插件没有测试、本机没有 Docker 或镜像（默认 `node:22-bookworm-slim`，试跑**不会**联网拉取）、插件根超过拷贝上限时记 `skipped`——**草稿代码不会在容器外跑测试**。全部试跑执行器都注入时 `trial.pendingStages` 为空。**磁盘**：与沙箱加载共用「同一时间一个试跑」的队列与 `zhin-change-trial-*` 前缀，拷贝在测试结束（含失败与超时）时立即删除，容器以 `--rm` 运行。

```yaml
ai:
  agent:
    toolHardGate:
      dangerousTools: [my_plugin__wipe_album]  # 只能追加，不能把核心名单调低
      allowFunds: false
      approvalTimeoutMs: 300000                # 超时即拒绝
      maxPendingPerScene: 3                    # 每群同时待审卡上限，超出 fail closed
```

审批卡片在 Console RPC `plugin.root.tool-approvals`（读，权限 `tool_approvals:read` 或 `ops:approve`）和 `plugin.root.resolve-tool-approval`（`{ id, decision: 'approve' | 'deny' }`，权限 `ops:approve` 或旧的 `tool_approvals:resolve`，任一即可）上；完整令牌可直接调用。群管冷却（ADR 0037 §3）：同一 `platform + scene_id + 工具本地名` 在 `ops.cooldownMs`（默认 60 秒，会话运营配置里设置）内只生成一张审批卡，冷却中直接拒绝、不生成新卡（`ops_cooldown` / `ops_cooldown_hit`）。每次判定写入 `ai_decision_events`：`tool_approval`（`tool_approval_requested` / `tool_approval_approved` / `tool_approval_denied` / `tool_approval_timeout`）、`tool_hard_gate`（allow：`tool_approval_approved`；deny：`tool_dangerous_no_approval`、`tool_approval_denied`、`tool_approval_timeout`、`tool_funds_disabled`、`tool_hard_gate_latched`、`hard_gate_scene_pending_cap`（每群待审卡已满）），以及 safe / 只读工具的 `tool_call`（allow，`tool_safe_allowed`）——只读查询放行但仍写审计。审计写失败不影响判定。

### IM 审批通道（#1013，默认关）

值班人员可以在 IM 里批硬闸卡片，不必登录 Console。它与 Console 共用同一个审批队列，任一渠道先给出结论算数，另一渠道看到已决；仍然只认人工、每次一批、fail closed。

```yaml
ai:
  agent:
    toolHardGate:
      imApproval:
        enabled: true
        approverIds:            # 扁平列表对所有平台生效；也可写成 平台 → 用户 id
          icqq: ['10001']
        delivery: dm            # dm（默认）私聊审批人；approver_group 发到 approverGroupId
        # approverGroupId: '123456'   # delivery: approver_group 时必填，且不能是业务群
```

- 每张新卡片（复用的同参数卡片不重复发）通过触发调用的那个 Endpoint 私聊发给该平台的每位审批人，内容含工具名、类别、会话、脱敏参数摘要、卡片 id 与过期时间。
- 审批人在私聊里发 `/approve <卡片 id>` 或 `/deny <卡片 id>`（前缀随命令前缀配置）。只认 allowlist 内的用户；群 / 频道里的消息一律不结算（`approver_group` 模式下仅认配置的审批群），触发调用的会话永远不能结算自己的卡片；业务群里说「同意 / 批准」不会结算。
- 批准只放行这一次同会话、同参数的调用（沿用 `consumeApproved` 指纹），没有「本会话 / 始终允许」。IM 通道是宿主命令，不是模型可调用的工具，`bypass` 和审核 Agent 都碰不到它。
- 投递失败或不可投递（未开启、该平台没有审批人、`approver_group` 未配置群或与业务会话相同）时，卡片仍留给 Console，超时照常拒绝；不重试投递。队列在内存中，重启后旧卡片失效。
- 审计：`tool_approval` 的结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group`，回合内审批提示为 `turn_prompt`），操作者记在 `actor_id`：IM 为 `im:<platform>:<userId>`，Console 暂为 `console`。`tool_approval_requested` 的 `payload.imApproval` 表示该卡片是否可经 IM 投递。

## 开关清单与处置

处置：**keep** 保留常用；**preset** 高级调优，用默认值；**merge-candidate** 计划合并；**debug** 诊断；**internal** 仅代码；**deprecated** 已弃用。

| 开关 | 处置 | 说明 |
| --- | --- | --- |
| `persona` | keep | 常用开关，保留 |
| `maxIterations` | keep | 常用开关，保留 |
| `timeout` | keep | 常用开关，保留 |
| `chatModel` | keep | 常用开关，保留 |
| `visionModel` | keep | 常用开关，保留 |
| `contextTokens` | keep | 常用开关，保留 |
| `execSecurity` | keep | 常用开关，保留 |
| `execPreset` | keep | 常用开关，保留 |
| `network` | keep | IM 回合出网权限的独立开关（取代 `execPreset: network` 兼带出网），保留 |
| `execAllowlist` | keep | 常用开关，保留 |
| `execApprovalMode` | keep | 常用开关，保留 |
| `disabledTools` | keep | 常用开关，保留 |
| `allowedTools` | keep | 常用开关，保留 |
| `inboundQueue` | keep | 常用开关，保留 |
| `toolBudget` | keep | 常用开关，保留 |
| `injectionGuard` | keep | 常用开关，保留 |
| `toolHardGate` | keep | 危险工具硬闸（ADR 0036）；始终开启，只能调严，见下文 |
| `usageQuota` | keep | 常用开关，保留 |
| `schedule` | keep | 常用开关，保留 |
| `masterShell` | keep | 常用开关，保留 |
| `compaction` | keep | 常用开关，保留 |
| `rateLimit` | keep | 常用开关，保留 |
| `preExecTimeout` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `maxTools` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `contextTailMessageLimit` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `toneAwareness` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `maxHistoryShare` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `maxParallelSubagents` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `toolExecution` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentAutoContinue` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentDirectImDelivery` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `maxSubagentIterations` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentTurnMode` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentTools` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentTurnWaitMs` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `modelSizeHint` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `skillInstructionMaxChars` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `modelHarness` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `providerResilience` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `providerTimers` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `promptCache` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `promptCacheRetention` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `promptCacheKeyPrefix` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `deferredTools` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `workerBaseTools` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `outputSchema` | preset | IM 默认使用受 Schema 约束的有序消息段；详见[结构化回复](./structured-replies.md) |
| `steeringMode` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `followUpMode` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `deferredAutoContinue` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `deferredAutoContinueMaxDepth` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `gitStatus` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `contextPaths` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `systemPromptMaxChars` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `thinkingPreview` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `thinkingPreviewMaxLength` | preset | 高级调优，默认值即推荐值，不建议修改 |
| `subagentExecApprovalMode` | merge-candidate | 未来合并到 execApprovalMode 的分角色覆盖 |
| `workerExecApprovalMode` | merge-candidate | 未来合并到 execApprovalMode 的分角色覆盖 |
| `phaseTrace` | debug | 仅诊断用 |
| `promptTrace` | debug | 仅诊断用 |
| `promptTraceVerbose` | debug | 仅诊断用 |
| `recordRequestBodies` | keep | 默认记录本地脱敏请求正文；设为 false 可关闭新增正文留存，保留用量统计 |
| `onPhaseTrace` | internal | 代码回调，YAML 不可配置 |
| `maxSkills` | deprecated | 运行时无读取，已弃用（#735），--fix 可移除 |
| `policyDenialStopAfter` | deprecated | 运行时无读取，已弃用（#735），--fix 可移除 |
| `deferredToolMaxResults` | deprecated | 运行时无读取，已弃用（#735），--fix 可移除 |
| `taskExecApprovalMode` | deprecated | 运行时无读取，已弃用（#735），--fix 可移除 |

## 弃用路径与兼容

1. 已弃用键仍被接受，不会导致启动失败；
2. 启动时每个已弃用键打印一次警告；
3. `zhin config check` 报告 `ai.agent_<key>_deprecated`；
4. `zhin config check --fix` 自动删除这些键；
5. 至少保留一个 minor 版本后再从类型中删除。

## 新增开关的门禁

新增 `ai.agent.*` 开关必须先登记到上表并在 PR 模板中说明理由；`pnpm check:agent-config-inventory`（包含在 `pnpm check:all` 中）会检查清单是否完整，以及非弃用开关数量没有超过基线。
