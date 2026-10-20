---
sidebar: false
---

# Zhin GitHub 自闭环生产化计划

状态：实施中。此计划以真实 `zhinjs/zhin` 为唯一首批试点，将已有工作流机制装配为可运行、可恢复、可审批的研发交付服务。main 与正式环境保护已远端启用；多 Agent 正在交付并验收 P1/P2/P3 和 P4/P5 的基础实现。尚未完成真实 Issue → PR → 部署闭环，不宣称生产准入。

## 1. 已核实的基线（2026-09-07）

- 仓库：`https://github.com/zhinjs/zhin`，默认分支 `main`。
- 远端 main：`52ad921e2ddb32adb45d514990e86399863a8f8e`。
- 已实现功能分支：`codex/feat-governed-delivery-workflow`，本地提交 `28b73750c`；尚未推送。
- `GET /repos/zhinjs/zhin/branches/main/protection` 返回 `Branch not protected`；现有 `Code Quality Copilot review for default branch` ruleset 为 `disabled`。这是启用保护前的历史快照；当前状态见下方执行记录。
- 当前调用者 GitHub 权限为 ADMIN；试点运行时不得继承维护者的广泛权限。
- `github-pages` 环境有 branch policy，返回的 protection rules 中没有 required reviewers；`copilot` 环境无 protection rules。
- `.github/workflows/ci.yml`：PR/main CI；Linux/Windows 与 Node 22/24/26 矩阵，Linux执行运行时测试，Windows以安装/构建兼容为主；包括 harness、coverage、生成项目和 Console 契约检查。
- `.github/workflows/publish.yml`：main push / 手动触发 Build and Publish，经 changesets 发包；不是由 CI workflow 完成事件单独触发。
- `.github/workflows/deploy-docs.yml`：满足路径条件的 main push / 手动触发 Pages 构建与部署。
- 部分工作流使用 `PERSONAL_TOKEN`。本次未读取其值，后续需要审计用途、作用域及替代方式。
- 既有 48 项 harness 与 92 项交付专项验证属于本地工程证据，尚无真实自闭环运行记录。

相关文档：[上一阶段实施记录](./governed-delivery-workflow.md)、[研发交付契约](../solutions/governed-software-delivery.md)、[生产部署与运维](../operations/production.md)。

### P0 首项执行记录：main 分支保护

2026-09-07，按维护者明确指令，通过 GitHub Branch Protection API 启用并独立回读验证：

- 必须经过 PR，至少1人批准；新提交使旧审核失效，最后一次可审阅 push 需由另一人批准。
- required checks：`test (ubuntu-latest, 22)`、`test (ubuntu-latest, 24)`、`test (ubuntu-latest, 26)`、`test (windows-latest, 22)`、`test (windows-latest, 24)`、`test (windows-latest, 26)`；限定 GitHub Actions app ID `15368`。
- strict checks：合并前必须更新到最新 base；必须解决 Review 对话。
- enforce_admins=true；无 PR 审核 bypass 名单；禁止强推及删除 main。
- 保留既有 merge/rebase/squash方式；未锁定整个分支，未改动其他规则。
- `production-install` 因 workflow有路径过滤，不列为全局 required check，避免纯文档等PR永久等待不存在的检查。完整质量门禁仍由现有CI矩阵承担。
- 未实际尝试违规push作为验证，验收依据为远端配置独立回读与字段断言。

现有 changesets 自动版本 PR 也受上述审核约束。分支保护不等于正式发布环境 Gate；P0的身份分离、publish/docs隔离和canary宿主仍待实施。

## 2. 首版目标与边界

唯一目标：一条经过维护者选定的真实需求，在真实仓库完成需求固定、设计、隔离实现、真实 PR、CI、独立 Review、人工批准、受保护合并、候选产物部署、健康验证和结果归档。

首版采用单团队、单仓库、单运行实例、一种 Coding Executor、GitHub Actions CI/CD。自动化分支使用 `codex/self-delivery/<run-id>`，Run/Task/Effect 与 GitHub 外部 ID 形成持久关联。

Zhin 是框架，交付验收同时包含：候选 npm tarball 安装到干净项目、minimal-bot 启动、Sandbox 消息往返、运行时就绪与关键 Agent 路径。单独访问 health 200 不能代替包交付验收。

预发布分两层：

1. GitHub Actions 临时 runner 中安装本次候选包并启动隔离 minimal-bot，验证真实构建与运行；这是临时 smoke，不宣称长期部署。
2. 独立 canary Host 长期运行同一候选产物，验证升级、持续健康、故障恢复及回滚。具体宿主与地址在 P0 登记后才允许进入这一层。

第一条自闭环不发正式 npm、不替换正式 Pages、不修改安全策略或自身发布工作流。正式渠道在候选路径通过后，通过独立 Gate 接入。npm 已发布版本不能按服务回滚处理；需要修复版本或经维护者批准调整 dist-tag。

自举边界：控制面运行已固定的受信 Zhin 版本，候选版本在另一个执行环境验证。候选代码、Prompt、工具、CI 不得修改当前 Run 的授权与验收策略。升级控制面是独立交付任务，有外部恢复入口。

## 3. 人工 Gate 与权限

| 操作 | 首版策略 | 授权绑定 |
| --- | --- | --- |
| 只读诊断、拉取代码、运行隔离测试 | 在批准的 Project/预算内自动执行 | 仓库、Run、工作区、工具范围 |
| 自动化分支与草稿 PR | 任务被正式纳入后自动执行 | Assignment、path scope、head SHA、幂等键 |
| 需求/设计范围确认 | 首条任务由 Sponsor 确认 | 需求及验收契约 revision/digest |
| Review | 独立 reviewer principal；实现者不能自审 | 同一 candidate、证据集合、policy |
| 合并 main | 维护者明确批准；仓库侧保护必须通过 | PR、head SHA、目标分支及其版本、CI集合 |
| canary 发布 | 独立环境 Gate，可由固定授权规则控制低风险重复运行 | 产物摘要、环境、流水线版本、有效期 |
| 正式 npm / Pages / 控制面升级 | 单独维护者 Gate | 精确版本/产物及具体外部操作 |
| 回滚/补偿 | 单独操作或预先批准的有界恢复策略 | 原 Effect、目标环境、已知正常产物 |

GitHub 评论、Issue 正文和 Agent 输出是非权威输入。聊天里的“同意”必须经已认证身份映射和 typed control 才能产生授权事实。重复回复不重复授权，取消/修改后旧决定失效。

## 4. 分阶段实施

### P0 — 试点保护与部署基线

交付：

- 形成 Repo Profile：固定 repository ID、受信 workflow 身份/版本、实际 required checks、角色、允许路径、任务预算、canary 目标和恢复责任人。
- 审查并准备 main protection/ruleset 配置：required PR/review/checks、失效旧批准、禁止直接/强推与删除、明确且最小化 bypass。用实际运行读取 checks 名称与来源，不能猜测字符串。
- 检查平台套餐与规则能力，无法强制的条件不能被本地布尔值伪装为已生效。
- 盘点 GitHub App 与部署身份；控制面、执行器、Reviewer、部署 job 分离。先验证最小权限，维护者 ADMIN 会话不作为服务凭据。
- 设计候选 workflow 与正式 publish/docs 的隔离；在允许自动合并之前，确保 main push 的现有下游不会绕过正式发布 Gate。
- 登记单实例 Host、持久卷、备份位置、运行版本、TLS入口；没有可用 canary Host 时停留在临时 smoke 层。

验收：以实际服务身份证明禁止直推 main、不能修改保护配置、不能读取正式发布密钥；环境与仓库保护读取验证成功，相关管理变更形成可审查差异。

依赖：无。后续编码可并行，但远端写入/真实合并验收依赖 P0。

### P1 — 可启动的 Zhin 自闭环项目

交付：

- 新增专用 reference project（建议 `examples/self-delivery-bot`，不改变默认 minimal-bot），使用 Plugin Runtime 入口与 owner-scoped Resources。
- 装配 Catalog/Profile、七阶段 proposal、Kernel admission、Scheduler、Executor、Reviewer/Sponsor、GitHub capability、Delivery provider 与 Effect runtime。
- 通过明确命令/受权入口选入一个真实 Issue，固定正文快照、验收条件与预算；编辑需求产生 revision，不静默更改在途 Run。
- 持久化 Issue ↔ Run、PR ↔ candidate、CI ↔ evidence、deployment ↔ Effect 关联。Webhook验签、重复/乱序处理和漏事件补查共用事实源。
- 增加 doctor/readiness：分别报告配置就绪、真实连接/权限就绪；缺 provider 不显示为可交付。

验收：一份受控配置可启动；重启后重新关联原 Issue/Run，重复事件不创建第二条任务；未授权 Issue/评论不能进入执行。

依赖：沿用 P0 Repo Profile 契约，可与 P2/P3 并行开发。

### P2 — 真实 Coding Executor 与工作区交付

交付：

- 固定一种可用 Coding Agent 的 typed adapter，接既有 AssignmentExecutorPort，支持取消、超时、进度和结构化产物报告。
- 每 Assignment 使用独立 checkout/worktree 或容器，固定 base SHA、路径、分支、attempt/fence、资源与网络预算。
- 候选脚本在无主机/生产凭据的环境运行；fork PR、不受信 workflow 和构建脚本不得进入特权执行环境。
- 由受信 gateway校验真实 diff并上传 Git objects，解决现有 REST transport 只支持已上传 commit 的缺口；不能把全仓库写 token交给模型来绕过 path scope。
- 创建真实草稿 PR，持久化 exact head、commit/tree/产物摘要、报告和测试证据；执行完成仍等待独立验收。
- 取消、磁盘/资源超限和 attempt takeover 后回收工作区；保留有界、可诊断的失败产物。

验收：真实小型 Issue 产生可审阅 PR；越界改动、旧 fence、恶意构建读取密钥、重复调度、取消后晚回执均被拒绝或正确隔离。

依赖：P0 身份/路径契约；与 P1/P3 并行。

### P3 — GitHub Actions 证据与候选发布 Provider

交付：

- 实装 GitHub Actions provider 的 inspect/dispatch/query。检查结论必须绑定受信 workflow、run ID、run attempt、事件类型、head/merge SHA 和完整 required-check 集合。
- 区分 PR head 测试、GitHub测试合并提交和最终 merge commit；目标 main 移动后按策略重验，不能把三者的绿色状态混为同一证据。
- 构建一次、记录 tarball/制品 digest与来源，安装及 canary 发布使用同一产物；禁止批准后重新构建另一份未验证字节。
- 制品 manifest、保存期限、读取权限、下载摘要校验与缺失 blocker 一并交付。
- 服务端持久 operation claim、条件检查、去重和 query 结果。不能假设 workflow_dispatch 自带业务幂等；响应丢失或暂时查不到 Run 时不得盲目重发。
- 受信部署包装层与候选 build job 分开。特权 workflow版本由配置固定，不从待测分支加载可任意改写的发布逻辑。
- 临时 smoke安装候选包运行 minimal-bot，并产出版本/摘要、Sandbox往返、ready、退出与清理证据。

验收：真实 GitHub Actions 运行提供可复验 artifact；缺check、错误来源、失败/跳过/取消、旧attempt、SHA错配、制品被替换均不能完成验收；重复dispatch、丢失响应只关联同一实际操作。

依赖：P0 workflow/profile；可与 P1/P2 并行。

### P4 — 人工决策、精确合并与发布门禁

交付：

- 受保护的审批入口显示 diff、CI、风险、当前版本、产物和目标；由认证身份调用既有 typed control。
- 新增受治理 merge Effect，执行前复验 PR head、base、保护状态和批准；使用平台可提供的原子条件。无法落实条件时保持阻塞。
- 合并结果进入 query-only恢复，记录真实 merge SHA；将最终候选与后续 pipeline匹配，必要时在 merge SHA上重新构建和验收。
- 串联 release Plan Gate、P7 exact Effect授权、GitHub环境Gate，明确每个Gate授权范围，避免批准一次获得后续任意发布权限。
- 对 npm、Pages及控制面升级加入独立入口，延续 changesets patch策略；不得另建平行发版状态机。

验收：真实PR必须独立review且维护者批准才能合并；批准后push、main移动、成员撤权、过期、重复操作无法越过保护；合并超时先查远端。

依赖：P1/P2/P3；P0保护和正式渠道隔离必须生效。

### P5 — 长期 Canary、运维和恢复

交付：

- 在P0登记的canary Host运行候选包，分离控制面与候选实例，保留上一已知正常版本。
- 健康检查验证运行版本/产物摘要、Sandbox往返、关键业务路径和持续观察窗口；发布成功后故障形成运维事件，不改写原历史。
- 超时、退避/抖动、限流、每项目公平性、对账期限与人工升级；单个provider挂起不能阻塞所有项目。
- 建立Run/Task/Effect/PR/CI/deployment关联视图、审批队列、失败通知和有权限的恢复操作。独立Console仓库的UI改动按其自身发布流程交付。
- 备份Kernel/Effect/关联映射及必要产物引用，验证一致性恢复；明确保留/归档与数据增长边界。
- 原产物绑定的回滚Effect，环境锁与恢复证据；控制面失败由外部supervisor/维护者通道恢复。

验收：canary坏版本可定位并恢复到明确的正常版本；备份恢复不重复部署；通知可达责任人；记录明确的RPO/RTO与支持规模。

依赖：P3；运维接口/备份可提前并行，真实长期部署在P4批准后执行。

### P6 — 真实演练与生产准入

执行顺序：

1. 选一个真实、范围小、可客观验收的Issue；排除权限、支付、删除、workflow或发布配置改动。保存选题及验收依据。
2. 在预发布路径完成一条真实交付；归档Issue、Run、PR、CI、artifact、批准、部署与健康证据。
3. 演练kill进程、网络断开、请求成功但回执丢失、重复/乱序事件、token过期与成员撤权。
4. 演练审批后代码变化、main变化、CI重跑、制品缺失、健康失败、磁盘满、备份恢复和控制面升级失败。
5. 验收后批准首条真实main合并及候选发布；正式npm/Pages需独立证据与Gate。
6. 连续运行观察，再逐步扩大自动化范围。

建议首版准入门槛（目标，非已有结果）：

- 至少3条不同真实需求完整交付，有维护者独立核验。
- 关键故障矩阵全部通过；重复部署、越权操作、错误完成均为0。
- 至少72小时canary观察；所有阻塞有owner、deadline、恢复入口。
- 建议单实例恢复时间≤10分钟，已确认的授权/副作用事实恢复后不丢失；如现有存储达不到，明确实测值并由维护者决定是否准入。
- 当前候选通过完整harness及真实平台检查；证据必须绑定同一候选/产物，不能沿用上一轮绿色结果。
- 发布一份生产就绪报告，分别列已证明能力、支持规模、已知限制及操作手册。

## 5. 多 Agent 执行安排

主Agent负责契约冻结、共享文件协调、独立Review、组合验收和结果归档。每个工作包先实现可审查代码与测试，远端配置及不可逆发布根据实际授权/Gate执行。

| 波次 | Agent A | Agent B | Agent C | 主Agent |
| --- | --- | --- | --- | --- |
| 0 | — | — | — | P0只读核实、保护/权限变更方案、契约冻结 |
| 1 | P1项目装配/入口/持久关联 | P2隔离Executor/Git上传 | P3Actions/制品/Provider | 共享契约、权限测试与真实fixture准备 |
| 2 | P4人工Gate/控制入口 | P5恢复/存储/工作区清理 | P4精确merge/P5canary部署 | 跨模块集成、独立Review、Console交付协调 |
| 3 | 修复验收发现 | 故障注入执行 | 外部证据核对 | P6真实闭环、准入报告 |

共享权威模块（Kernel、Effect union、标准composition）每轮只指定一个写入者，其他Agent通过接口与其协作。任务实现者不负责最终接受自己的产物。

## 6. 实施跟踪

- [x] 核对真实仓库、远端main、规则和已有workflow入口。
- [x] 保存本计划与生产准入条件。
- [x] P0第一项：main分支保护启用并回读验证。
- [ ] P0其余：运行身份、预发布隔离与Host基线。
- [ ] P1 可启动项目与真实需求入口。
- [ ] P2 Coding Executor和受控Git上传。
- [ ] P3 真实Actions/制品/部署Provider。
- [ ] P4 审批、精确合并与正式渠道Gate。
- [ ] P5 Canary、运维、备份和恢复。
- [ ] P6 故障演练、持续观察及准入报告。

下一步：完成本分支本地与容器验收，提交可审阅 PR。服务 App、真实模型 runner、持久 Assignment authority接线、受信 workflow 版本和控制面宿主尚未配置；这些缺失必须保持 doctor blocked。现有开放 Issue 查询为空，第一条真实任务需单独选定并记录验收条件。


### 2026-09-07 多 Agent 实施记录

- P0：`npm-production` / `github-pages` 已登记人工 reviewer `lc-cn`，关闭 admin bypass并独立回读；现有Pages分支策略保留。npm工作流绑定新环境的代码需审阅合入后生效。详见[部署与身份配置](https://github.com/zhinjs/zhin/blob/main/deploy/self-delivery/README.md)。
- P1：新增[自闭环项目](https://github.com/zhinjs/zhin/blob/main/examples/self-delivery-bot/README.md)，真实 Issue reader、认证选入、持久不可变快照、Kernel admission 和 Profile pin；标准 Host 接入 Coding Executor/Delivery provider，默认未配置时可启动 doctor 并明确阻塞。
- P2：固定镜像的 Docker Executor、精确 Git base读取和受控 objects上传、原子claim/持久report端口、恢复复用与遗留容器清理。已验证本机Docker daemon可达，但没有真实Coding模型runner镜像，已提供 FileCodingExecutionStore 的持久claim/report，Assignment scope/fence端口仍需连接服务权威。
- P3：GitHub Actions provider核验workflow/run/attempt/job集合和archive摘要，持久dispatch claim防重复；候选容器与受信控制脚本隔离。临时smoke覆盖minimal-bot Terminal往返、Agent入口加载和stop；不把它说成Sandbox或真实LLM验收。
- P4：新增 `git_merge_pr` typed Effect 和只读前置检查。GitHub REST merge只支持head条件，不提供expected base SHA原子条件，因此此adapter始终明确阻塞精确合并，不降级为不安全的先读后写。首版main合并保留维护者受保护操作。
- P5：维护者确认现有Hugging Face Space为 `zhinjs/demo`；只读核验RUNNING/cpu-basic/无挂载卷。新增[独立Canary bundle准备工具](https://github.com/zhinjs/zhin/blob/main/deploy/huggingface-canary/README.md)，校验同批tgz/manifest、要求冻结lockfile与Node镜像，提供持续Terminal探测；未覆盖或部署现有demo。控制面必须使用独立持久存储。
- P6：真实平台闭环、故障演练、72小时观察、备份恢复和正式准入尚未完成。上述基础模块的单测/本地启动不替代这些证据。

实现已提交为[草稿 PR #657](https://github.com/zhinjs/zhin/pull/657)。本地全仓门禁和交付专项已执行；真实首轮 CI 的六个必需 job 均因临时 GITHUB_TOKEN 无权读取跨组织私有 @icqqjs 包而下载403失败；经维护者确认，恢复 NPM_TOKEN 对既有 secrets.PERSONAL_TOKEN 的引用，并仅在安装步骤注入，继续远端复验。核心候选路径通过真实 Docker 裁剪锁文件、构建、28个tarball、干净安装与minimal-bot消息往返；这不替代全仓CI或长期Canary准入。最终证据以PR当前说明和对应SHA运行记录为准。
