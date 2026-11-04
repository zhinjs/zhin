---
title: "Provider 与 main 配置生命周期整合"
sidebar: false
---

# Provider 与 main 配置生命周期整合

固定输入：已验收候选 `1a7d98e862d3b8d7de813c8498dfc9236095333a`、main `38e5c0bd67eb29b54842c278520d5c9dfc1476ba`；共同基线 `d8532ddbf8194dd422818463deb554bb97d587e7`。独立方案审查通过后，在 `feat/ai-provider-main-integration` 单独 worktree 实施。原候选、Console 与用户工作树不变。

## 所有权与合同

- 保留 main 的文件 desired/effective 分离、应用分组、显式 watch、配置 CAS、脱敏、聊天权限和自变更 unknown/superseded 防重放。
- 保留 Endpoint 不可变资料门面：资料兜底配置不重连、不写平台资料，不把连接或角色变更误作资料更新。
- 模型 Service/Account/Profile/用途只由 inference 仓储事务持久化。文件配置命令、watch 和 apply 不写图、凭据或个人绑定。
- 文件 `sourceRevision/applicationRevision` 与图 revision/mutation receipt 分开；没有跨文件和图的原子事务或统一成功回执。
- 实际 operation 持有 exact generation、可信 principal 和固定图；后续模型请求不进入 Root 控制队列。在途与子任务的 lease、取消和终态合同保持；新 operation 读取新图。
- 退役 main 新增但已被目标方案替代的 YAML 模型目录 handler、版本工厂、Provider 租约入口与旧 personal-model/runtime-policy 管理服务。不恢复任意 native model override、Host 身份替代个人身份或跨模型 fallback。

## 测试迁移对应

| main 的原验证对象 | 目标合同与实际回归 |
| --- | --- |
| `agent/configuration-update.test.ts` 的模型文件 dependency group、环境值与目录引用 | 旧选择器统一在环境读取和声明执行之前拒绝，原文件不变；合法行为配置仍沿通用 Runtime 分组。模型图修改由已有 plan/review/apply 验证，不保留旧文件 handler |
| 原 `personal-models/configuration.test.ts` 的短 control、延迟凭据、取消和租约 | `inference/configuration.test.ts` 以真实 RootRuntime、HostInference、SQLite 与官方 OpenAI Driver 验证控制队列空闲、取消原 reason、固定 graph/principal/lease、旧/新调用目标 |
| 原 `runtime-model-policy/configuration-live-host.test.ts` 的文件/模型/HTTP 混合应用 | 同名测试改为真实 file store/RootRuntime/HostInference：模型请求等待期间文件应用不被阻塞；HTTP 保留 restart-pending；文件回执不冒充图提交；图变更不改文件修订；原请求不换模型 |
| main 的 `configuration-version` 目录租约与模型调用者测试 | 旧目录权威退休；有效生命周期由既有 target runtime/delegation 与新增 16 项真实 Host 消费者验证。覆盖审批、主/子任务图像、ambient 独立选择、ServiceAgent、completion、排队子任务跨真实 Root 配置与图更新后的原身份/原图及取消；不保旧 Provider-first 或任意 native override |
| 通用 Runtime、Endpoint 资料、聊天配置、配置 RPC、自变更和增量解析 | 保留原 main 行为断言；仅按真实新 DTO 增加字段或新模型合同作精确迁移，不放宽门禁 |

## 实现者验证记录

以下仅为本地合成验证，不代表真实供应商、迁移生产数据、发布或部署。最终固定候选完整门禁与独立增量审查由 Root 执行。

| 预期 | 实际证据 | 当前结论／未覆盖 |
| --- | --- | --- |
| 通用资料与配置机制保留 | Runtime 全目录、Adapter 资料、FeatureKit 共 43 文件 / 407 测试通过；`/tmp/zhin-main-sync-runtime-adapter.log` | 通过本地回归，无真实平台资料读写 |
| 模型请求不占用 control，文件与图回执独立 | 新配置控制、文件/图分离、早拒与 offline 共 4 文件 / 19 测试通过；`/tmp/zhin-main-sync-configuration-fifth.log` | 实际本地 SQLite、SDK 合成 transport，不是远程数据库或模型调用 |
| 非法 schema 不绕过旧 authority 早拒 | Console 纯验证 11 测试通过；`/tmp/zhin-main-sync-ai-validation.log` | 保来源可读及显式文件管理迁移边界，不自动迁移 |
| 新树完整 CLI 构建依赖一致 | 44 / 44 构建任务通过；`/tmp/zhin-main-sync-cli-dependencies-build.log` | 不是固定合并候选的全仓 CI 构建 |
| 最终配置所有权回归 | 显式 22 文件 / 453 测试通过，包含 main 的配置 CLI、聊天、跨入口、Self-change、Host 安装及新增 file/graph/control 断言；`/tmp/zhin-main-sync-final-owned-tests.log` | 合成 loopback 与本地数据，不是最终全仓门禁 |
| Agent 入口与类型 | 实现者 28 文件 / 178 测试通过；补齐 5 处测试输入类型后 16 项 consumer 再通过。复用原 root include/ambient 并加 6 个新测试的额外 TypeScript 检查通过；重跑脚本 `/tmp/zhin-main-sync-test-typecheck.py` | 根 source type-check 本身不覆盖全部 CLI 测试，因此单列额外证据，不宣称全测试类型门禁已扩大 |
| IM-only disabled AI | 实际复制现有 loader，在无 Agent 的隔离项目/CLI 中由 Node 子进程解析；原合并 validator 红、分域修复后绿。普通非 AI 保存不加载 Agent，主动 AI 写仍拒绝缺 Agent/旧 selector，CAS 不变；`/tmp/zhin-main-sync-no-agent-actual-red.log` / `no-agent-final-green.log` | 不恢复 YAML 模型执行；原始停用域为迁移保留与正常 AI 结构化 consumer 分开 |
| 配套合同未漂移 | 根 source type-check、额外测试 TypeScript、ESLint、architecture、LLM/config boundaries、API surface、Plugin Runtime surface、dependency policy、生成配置 reference、doc-links 与 doc-orphans 专项通过 | 最终固定合并候选的完整门禁、归档及独立增量审查仍由 Root 执行 |

## 失败记录与复验边界

- CLI 整目录首次采样发生在 Agent consumer 测试迁移中，其旧 import 造成 0 测试收集，不计产品行为失败。另三项失败由新 worktree 缺少 components/client/Adapter 构建产物导致；按原包构建补齐，原两文件 11 项断言原样通过，未修改超时或预算。首次日志 `/tmp/zhin-main-sync-cli-all-tests.log`，复验 `/tmp/zhin-main-sync-fixture-prerequisites-rerun.log`。不把首次整目录宣称为全绿。
- 一次配置跨入口复验在沙箱中出现 loopback `EPERM`；同代码、预算和断言在允许 loopback 后 3 文件 / 49 项通过，日志 `/tmp/zhin-main-sync-canonical-project-patch-escalated.log`。没有用更长超时或生产 guard 掩盖它。
- 五处新增消费者的测试类型红，分别为审批 request 缺取消信号、工具 context 缺身份字段与返回值联合泛型；已补真实字段及正确联合类型，未用 cast/any 代替。这项红绿独立于确定性运行通过。

## 固定候选 fe678 的完整门禁后修正

Root 对 `fe678c74824f6bc5bf7408ebf7b9fcc2b2bbf82c` 的完整 `check:all` 退出 1，发现三项失败；日志 `/tmp/zhin-main-fe678c-check-all.log`。以下为限定配套修正，不把原全量结果记为通过，新固定候选仍须完整复验。

| 预期／根因 | 实际修正和红绿证据 | 结论／未覆盖 |
| --- | --- | --- |
| ICQQ 派生文档应匹配包 README 与 metadata；main 增量未刷新摘要 | `pnpm sync:adapter-docs` 仅生成 `docs/adapters/icqq.md` 的一行 SHA 变化；正式 `check:adapter-docs` 原失败、修后通过（24 个 Adapter）；`/tmp/zhin-main-followup-docs-red.log` / `docs-green.log` | 未手改生成正文，未改变平台合同 |
| private Plugin Runtime 包须声明现存 TS 入口；固定 main 已将 Douyin 声明为 private 却仍指向 JS | 仅 `zhin.entry` 改为已有 `./plugin.ts`；正式 readiness 原失败、修后通过（68 包）；`/tmp/zhin-main-followup-entry-red.log` / `entry-green.log`。现有 builder 在临时复制包仍生成已列入 files 的 `plugin.js`；`/tmp/zhin-douyin-private-entry-fixture.log` | private、发布策略、平台代码与门禁不变，无需追加 pack 字段；未实际打包或连接平台 |
| 新 owner 披露用例须使用既有对象参数合同 | 仅旧五位置参数调用迁为 `CapabilityIngressInput`，owner/admin/unknown 与历史加载断言保留。完整 AdapterDisclosure、ICQQ discovery/group moderation、Permission 共 4 文件 45 测试通过；`/tmp/zhin-main-followup-disclosure-red.log` / `focused-final.log` | 不新增生产兼容分支，不改权限或审批 |
| 新测试还应经 TypeScript 检查 | 额外 include 整个 AdapterDisclosure 测试后发现夹具异构 Map 推断错误；补精确 `Map<FeatureId, ToolIndex \| SkillIndex>`，无 cast。复用根原 include/ambient 与此前六个新测试的额外 tsc 通过；`/tmp/zhin-main-followup-test-types.log` / `test-types-green.log`；脚本 `/tmp/zhin-main-sync-test-typecheck.py` | 类型红绿独立于运行通过；未扩大或放宽正式类型门禁 |

同轮正式 `check:plugin-capability-publish`、`check:doc-links`、变更测试 ESLint 与 `git diff --check` 通过。新固定候选由 Root 执行完整构建／门禁；本轮没有改生产调用逻辑、执行真实供应商或读写用户配置。
