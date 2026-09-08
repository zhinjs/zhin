---
sidebar: false
---

# 受治理研发交付闭环实施计划

目标：基于最新 main，在独立功能分支完成可验收的小型研发交付闭环。复用 Workroom Kernel / Acceptance / Effect Ledger 的权威事实；不新增模型可写的任务终态，不让 IM 群身份直接授予项目权限。

## 执行安排

1. [x] 确认干净工作区，拉取 main，创建 `codex/feat-governed-delivery-workflow`。
2. [x] Agent A：审计并补齐候选产物、Reviewer / Sponsor Gate 的精确绑定与过期失效；覆盖更新候选、越权、重复提交等回归场景。
3. [x] Agent B：审计并补齐 Effect Ledger / Gateway 的重启、超时、幂等与对账语义；未知结果不得盲目重试。
4. [x] Agent C：检查 GitHub / Git Workspace 的真实传输闭环，补齐可复用的可信执行连接及测试，避免模型声明代替外部证据。
5. [x] 主 Agent：整合研发流程切片与跨模块验收，补齐可操作的示例/文档和可重复的验收入口。
6. [x] 主 Agent：审查全部 diff，运行针对性测试、类型与架构/Workroom 门禁；执行适用的全套检查并记录结果和外部环境限制。

各 Agent 先验证现状再修改，文件责任区互斥，共享契约改动先协调。任何生产连接缺失均明确记为限制，不用 mock 通过冒充真实部署成功。

## 验收标准

- 需求与验收条件固定后，执行产物进入测试、独立 Review、人工 Gate；仅可信验收推进下游。
- 测试、批准与外部操作绑定具体候选/commit/目标；候选更新使旧结论不能继续授权。
- 无权限主体的控制请求零状态变更；审批必须绑定身份与具体范围。
- 重启后可恢复持久事实；重复投递不重复产生副作用。
- 外部操作结果未知时先对账，记录 committed / failed / outcome_unknown，不伪造成功。
- 能定位当前任务状态、阻塞原因和可用恢复动作。

## 实施记录

基线：`52ad921e2ddb32adb45d514990e86399863a8f8e`（已向 origin 确认最新 main）。

- A：修复 Reviewer/Sponsor 及 release Plan Gate 当前时间、候选和重放校验；七阶段实际模板经 Kernel admission、独立 Review、Sponsor、依赖调度完成组合验收。
- B：修复 Effect CAS/同 fence 并发重复写、超时恢复、unknown blocker、receipt identity 和幂等键冲突；dispose 中止在途等待，重启保留原 attempt 对账。
- C：提供真实 GitHub REST ref/draft PR transport、实际 compare path scope 校验和查询恢复；凭据只存在可信 connector。
- 主 Agent：新增 typed delivery_release CI/CD Gateway、精确 CI/产物/环境/健康证据与时间校验、文件 Journal 重启验收、标准 Host token 接线、公开 API 快照、patch changeset、方案文档与 pnpm check:delivery。
- 独立 Review 追加发现并处理：计划审批及 priority 控制同类过期窗口、GitHub recovery 实际 diff 权限校验、逻辑 capability 与 provider 的显式绑定。

外部环境边界：没有使用真实 GitHub 写凭据或真实预发布服务。GitHub HTTP 和 CI/CD provider 的外部响应在测试中使用 fixture；通用 CI/CD provider 必须由具体部署方装配，并原子落实前置条件与去重。GitHub transport 不上传 Git objects、不合并 PR、不部署。不得据此声称生产 smoke 已完成。

最终验收（2026-09-07）：

- `pnpm check:delivery`：运行交付专项测试集合；随实现扩展的文件及用例数量以当前脚本和 PR 对应提交的验收记录为准。
- `pnpm check:all`：48 项全部通过，包含全量 Vitest、Lint、TypeScript、Workroom/架构/API 门禁、文档、发布计划、IM 安装体积、Runtime migration、Stable smoke 和 L4-CI。
- `git diff --check`：通过。
- 首轮受限环境的 HTTP `listen EPERM` 和依赖下载失败，在允许本地监听和联网的环境中复验通过；新增 API 快照和文档导航已对齐。
- patch changeset 已记录 `@zhin.js/agent` 行为变化和自定义 GitHub capability binding 迁移要求。

本地验收完成；未推送、合并或执行真实外部发布。

## 后续生产化

以 `zhinjs/zhin` 为真实项目的下一阶段见[GitHub 自闭环生产化计划](./zhin-github-self-delivery.md)。
