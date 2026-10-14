---
title: "把 GitHub 仓库作为 Workroom"
description: "让一个 GitHub 仓库的 Issue 与 PR 事件进入多 Agent 协作流程：绑定方式、配置步骤，以及与 GitHub Project 的边界"
---

# 把 GitHub 仓库作为 Workroom

Workroom 是多个 Agent 协作完成任务的空间。这一页讲怎样把一个 GitHub 仓库变成一个 Workroom：仓库里的 Issue 和 PR 评论会进入同一个协作项目，由 Agent 规划、分派、审核。

适合想让仓库事件驱动 Agent 协作的团队。Workroom 本身的规则见 [Agent 深入：Workroom Kernel](../ai/agent.md#workroom-kernel)。

## 一个仓库对应一个 Workroom

Workroom 由**完整的仓库地址**识别，而不是由 Bot 识别。所以一个 GitHub App 账号（Endpoint）可以同时服务多个仓库，事件按 `owner/repo` 进入各自的项目，不会串。

```json
{
  "kind": "repository",
  "adapter": "github",
  "endpoint": "github-app",
  "sceneId": "zhinjs/zhin",
  "agent": "orchestrator"
}
```

## 实施步骤

1. 安装并配置 GitHub 适配器，确认 Webhook 事件里带有稳定的 `owner/repo` 信息。
2. 在 Console 的 Workroom 页面新建项目，配置成员、角色和负责统筹的 Orchestrator Agent。
3. 把协作空间类型设为 `repository`，选择 Endpoint，填写规范的仓库地址（如 `zhinjs/zhin`）。
4. 保存后立即在仓库发一条 Issue 或 PR 评论试试，不需要重启。
5. 在 Workroom 任务看板查看提案和分派，在 Agent 执行记录中查看具体每一步。

## 验收清单

- 同一仓库的 Issue 和 PR 事件进入同一个项目。
- 一个 Endpoint 服务多个仓库时，事件不会进错 Workroom。
- 两人同时编辑配置时，后保存的人会被提示刷新，而不是悄悄覆盖对方。
- 同步 GitHub Project Item 失败，不会改变 Zhin 中已经记录的任务状态。

## 与 GitHub Project 的关系

**Zhin 的任务状态以 Workroom 为准**，GitHub Project Item 只是可选的外部展示。Console 的任务页面是 Workroom 事件日志（Journal）的只读视图，不会直接修改任务状态。

::: details 想把任务同步到 GitHub Project V2？
需要单独实现一个 Integration Port：维护幂等的 `task-key ↔ item-id` 映射，并定义冲突处理策略。不要把 Item ID 当成 Workroom 的身份，也不要让 Console 绕过 Workroom Kernel 直接写状态。

Console 保存 Workroom 配置时使用 revision CAS（比较版本号后再写入），这就是并发编辑会提示刷新的原因。
:::

## 下一步

- [受治理的研发交付](./governed-software-delivery.md)：从需求、独立 Review 到 CI/CD 和健康检查的完整计划模板
- [Agent 深入：Workroom Kernel](../ai/agent.md#workroom-kernel)：Workroom 的完整字段和规则
