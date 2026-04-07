---
name: github
platforms:
  - github
description: >-
  GitHub 全功能适配器：PR 管理（创建/合并/Review/关闭/Diff）、Issue 管理（创建/编辑/关闭/评论）、
  仓库操作（Star/Fork/搜索/标签）、CI/Release/Branch 查询、文件查看/编辑、提交历史、Webhook 订阅。
  channel ID 格式：owner/repo/issues/N 或 owner/repo/pull/N。
keywords:
  - github
  - adapter:github
  - pr
  - pull request
  - issue
  - merge
  - review
  - star
  - fork
  - branch
  - release
  - CI
  - workflow
  - repo
  - 合并
  - 仓库
  - 拉取请求
  - 代码审查
  - search
  - 搜索
  - label
  - assign
  - file
  - commit
  - compare
  - edit
  - webhook
  - subscribe
tags:
  - github
  - development
  - git
  - ci-cd
tools:
  - github_pr
  - github_issue
  - github_repo
  - github_subscribe
  - github_unsubscribe
  - github_subscriptions
  - github_bind
  - github_unbind
  - github_whoami
  - github_star
  - github_fork
  - github_search
  - github_label
  - github_assign
  - github_file
  - github_commits
  - github_edit
---

## 工具概览

| 工具 | 说明 | 子操作 |
|------|------|--------|
| `github_pr` | PR 操作 | list / view / diff / merge / create / review / close |
| `github_issue` | Issue 操作 | list / view / create / close / edit / comment |
| `github_repo` | 仓库信息查询 | — |
| `github_search` | 全局搜索 | issues / repos / code |
| `github_star` | Star/取消 Star | — |
| `github_fork` | Fork 仓库 | — |
| `github_label` | 标签管理 | add / remove / list |
| `github_assign` | 指派管理 | add / remove |
| `github_file` | 查看/编辑仓库文件 | — |
| `github_commits` | 提交历史查询 | — |
| `github_edit` | 文件直接编辑 | — |
| `github_subscribe` | 订阅仓库 Webhook 事件 | — |
| `github_unsubscribe` | 取消订阅 | — |
| `github_subscriptions` | 查看当前订阅列表 | — |
| `github_bind` | 绑定 GitHub 账号 | — |
| `github_unbind` | 解绑账号 | — |
| `github_whoami` | 查看当前绑定 | — |

## 执行规则

1. 确认 channel / repo 格式与参数完整
2. `github_pr` 的 `action` 参数决定子操作：list/view/diff/merge/create/review/close
3. `github_issue` 的 `action` 参数决定子操作：list/view/create/close/edit/comment
4. 搜索支持三种类型：issues、repos、code
5. 文件操作需要 owner/repo/path 参数
6. Webhook 订阅关联到当前聊天通道，仅在该通道接收事件通知
