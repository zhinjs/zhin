---
title: GitHub 仓库 Workroom
---

# 把一个 GitHub 仓库作为一个 Workroom

适合让仓库事件进入多人 Agent 协作流程的团队。一个仓库天然对应一个 Project Workroom；Issue 与 PR 评论共享同一项目边界。

## 身份模型

Workroom 的身份来自完整 `repository` 地址，而不是 Bot。一个 GitHub App Endpoint 可以服务多个 Workroom；`owner/repo` 决定事件进入哪个 Project Inbox。

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

1. 安装并配置 GitHub 适配器，确认 Webhook 带有稳定的 `owner/repo` 元数据。
2. 在 Console 的 Workrooms 新建 Project，配置成员、角色与 Orchestrator Agent。
3. 将协作空间设为 `repository`，选择 Endpoint 并填写规范化仓库地址。
4. 保存 Catalog 后立即发送 Issue 或 PR 评论；无需重启 Host。
5. 在 Workroom Task 看板确认提案、Assignment 与 Journal 事实，在 Agent 轨迹查看具体执行。

## Task 与 Project Item

Zhin Task 是 Workroom Kernel 的事实；GitHub Project Item 只是外部投影目标。当前 Console Task 页面是 Journal 与 Kernel 的只读视图，不会直接修改任务状态。

若要同步 Project V2，需要单独实现 Integration Port、幂等 `task-key ↔ item-id` 映射与冲突策略。不要把 Item ID 当成 Workroom 身份，也不要让 Console 绕过 Kernel 写状态。

## 验收清单

- 同一仓库的 Issue 与 PR 事件进入同一个 Project。
- 同一个 Endpoint 服务多个仓库时，事件不会串到其他 Workroom。
- 修改 Catalog 通过 revision CAS 生效；并发编辑会提示刷新，而非静默覆盖。
- Project Item 同步失败不改变 Kernel 中已提交的任务事实。

完整字段见 [Agent 深入：Workroom Kernel](/ai/agent#workroom-kernel)。
