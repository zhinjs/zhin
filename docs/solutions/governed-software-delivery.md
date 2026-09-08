---
title: 受治理的研发交付
---

# 从需求到可验收的交付

这个 Advanced 方案复用 Workroom Kernel、独立验收和 Effect Ledger，把需求、设计、实现、测试、Review、发布和健康检查组织为同一个版本化计划。默认 IM 安装不引入这些能力。

## 可复用入口

以下入口从 `@zhin.js/agent/runtime` 导出，供可信 Host 组合使用，不能直接暴露成模型可写的状态迁移工具：

| 入口 | 用途 |
| --- | --- |
| `createSoftwareDeliveryPlan` | 生成七阶段纯 Plan proposal；不执行模型，也不直接创建 Task facts |
| `createGitHubWorkroomCapability` | GitHub REST ref/草稿 PR 传输及查询恢复；注册到 `workroomGitHubCapabilityToken` |
| `workroomDeliveryProviderToken` | 挂载特定 CI/CD 系统的可信 provider |
| `WorkroomDeliveryGateway` | 核对 CI 证据、产物与环境，将部署及健康观察转换为 Effect receipt |

`createSoftwareDeliveryPlan` 输入要求需求引用、非空验收条件引用、仓库、环境、七个阶段的角色/能力/尝试预算、Scheduler policy、Project/Profile authority 和 Sponsor。需求与验收条件必须是带 SHA-256 摘要的不可变引用。模板生成 `requirements → design → implement → test → review → release → health`；依赖沿用 Kernel 的 accepted 语义。实现和 Review 角色必须不同，真正的 principal 职责分离仍由验收权威执行。

生成 proposal 后，可信 planning adapter 必须通过现有 `admitWorkflowPlan` 接受计划；模板不会授予调用者项目权限。`release` 带计划层 Sponsor gate。这个 gate 只允许任务进入执行，**不等于批准任何具体发布**；发布仍须经过绑定 exact Effect Intent 的 P7 授权。

## 安装外部连接

1. 按 [GitHub Workroom](./github-workroom.md) 建立 Project、成员和仓库绑定。
2. 在 generation Resource 中提供 Workspace Lease、分支保护权威、凭据端口和 P7 持久授权事实。凭据只能在可信 provider 内使用，不能进入 Plan、模型上下文或 Journal。
3. 用 `createGitHubWorkroomCapability({ credentials, binding })` 创建 GitHub provider，注册到 `workroomGitHubCapabilityToken`。GitHub Enterprise 可由 Host 固定配置 `apiBaseUrl`；请求禁止跟随重定向。每个 generation 创建自己的实例。`binding` 的 `ref`/`digest` 必须匹配 intent.capability；省略时 helper 使用自身 provider 身份。现有自定义 GitHub capability 必须补充显式 binding，缺失或错配会阻塞，不能沿用未绑定的宽泛授权。
4. 发布连接按 `WorkroomDeliveryProviderPort` 实现并注册到 `workroomDeliveryProviderToken`。标准 `installWorkroomEffectResources` 已路由 `delivery_release`；缺 provider 时保留可恢复 blocker。
5. 可信集成层用 `workroomEffectIntentWriterToken` 记录发布 intent；它只记录意图，不能授权或执行。既有后台 Effect runtime 调度和恢复执行。

GitHub REST provider **只发布已经上传到 GitHub 的 commit**，不上传本地 Git objects，不自动合并 PR。ref 与 PR 操作都读取 immutable base/head 的实际 diff 并检查 path scope；无法证明完整 diff 时拒绝。需要本地 Coding Agent/CI worker 在受控 workspace 中生成并上传 commit。仓库原有的分支保护与可信租约仍是必要边界。

## 发布的精确契约

`delivery_release` 的参数为：

```typescript
{
  kind: 'delivery_release',
  parameters: {
    repositoryId: 'github:owner/repo',
    headSha: '完整的 40 或 64 位 Git SHA',
    artifactDigest: 'sha256:构建产物的摘要',
    environment: 'staging',
    pipelineRef: '固定版本的发布流水线引用',
  },
}
```

此处展示字段形状，示意字符串不能作为有效摘要提交。完整 intent 还必须固定 candidate hash、provider capability、目标摘要、CI 证据引用/摘要、风险、幂等键和创建时间。

Provider 的三个方法各有明确职责：

- `inspect`：只读查询 CI。返回当前 candidate、目标及产物、非空检查结果、证据引用/摘要和有效期。证据必须来自受信 CI，检查集合由可信 policy 固定；模型不能声明哪些检查已经通过。
- `dispatch`：接收具体授权摘要、有效期、证据摘要和幂等键。外部执行端必须原子校验这些前置条件并去重，拒绝移动后的目标和过期授权。前置检查与真正执行之间的竞态不能仅靠本地先查询解决。
- `query`：按原始 Effect/幂等键查询实际部署及健康结果。不能重发、回滚或创建另一条发布。

Gateway 会在准备和执行前重新检查证据。只有 `status: succeeded` 且 `health: passed` 才产生 `committed`；部署失败，或部署成功但健康检查失败，产生 `failed`；部署状态尚未确定时保持 `outcome_unknown`。观察必须绑定同一 Effect、candidate、commit、产物、环境和流水线；落后于已持久观察时间的回执被拒绝。

发布失败不自动回滚。回滚必须作为新的受授权副作用明确绑定原产物和目标，不能把失败回执当成回滚授权。

## 人工 Gate 与恢复

Reviewer 和 Sponsor 控制重新核对认证主体、当前 Assignment/candidate、Contract/Policy 和 deadline。授权查询结束后再检查当前时钟，避免长期无人操作或授权查询耗时导致过期审批生效。事件记录同一检查时间，重放不会使用今天的时钟改写历史。

Effect attempt 在外部写之前持久化。进程重启、dispatch 响应丢失或未知健康状态都只查询原操作。重复投递不分配第二次写权限；同一项目内不同 intent 不能复用幂等键。Unknown blocker 只提供 `reconcile`，不把已开始的操作显示为可无条件重试或取消。

运维人员通过现有 Workroom 状态/验收投影和 Effect blocker 查看阻塞、owner、deadline 和恢复动作。此方案没有新增独立 Console 页面；Kernel Journal 与 Effect Ledger 各自继续是任务事实与副作用事实的唯一来源。审计摘要用于完整性校验，不宣称抵御拥有存储写权限的攻击者。

## 可重复验收与边界

```bash
pnpm check:delivery
```

验收覆盖真实 Kernel admission/调度/验收链、独立 Reviewer/Sponsor、拒绝过期和越权、文件 Journal 重启恢复、CI/产物/环境错配、未知结果仅查询、健康检查失败、GitHub HTTP 契约和统一 Host composition。

这些测试在本地运行，外部 GitHub/CI/CD 使用确定性 HTTP/typed provider fixtures。没有真实仓库、CI 配置、凭据和预发布环境的 smoke 结果，不能声称已完成实际生产交付。当前提供 GitHub ref/PR REST 连接和 CI/CD provider 接入契约；具体 CI/CD 产品的 provider、生产凭据管理及持续监控集成须由部署者装配。
