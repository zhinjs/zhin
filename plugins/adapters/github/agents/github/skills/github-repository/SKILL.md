---
name: github-repository
platforms:
  - github
description: GitHub 工作区准备、文件补丁、分支推送和 PR 创建能力。
keywords:
  - "github"
  - "repository"
  - "patch"
  - "branch"
  - "pull request"
tools:
  - "prepare_workspace"
  - "patch_file"
  - "create_pr"
  - "push_branch"
---

# github-repository

这些 Tool 使用 GitHub App Installation Token，以 Bot 身份写仓库。按 `prepare_workspace`、`patch_file`、`push_branch`、`create_pr` 的顺序操作，每一步使用上一步返回的稳定引用。Issue 线程创建新分支后开 PR；PR 线程推送到现有 head 分支。不要改用人身份 PAT 的 MCP 工具完成 Bot 写入。推送和创建 PR 前复核仓库、base/head 分支与变更内容，并遵守 HITL 审批。
