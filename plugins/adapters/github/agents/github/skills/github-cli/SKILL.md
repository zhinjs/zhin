---
name: github-cli
platforms:
  - github
description: 使用 gh CLI 处理内置 GitHub Tool 未覆盖的 Issue、PR、Release、Workflow、搜索和 API 操作。
keywords:
  - "github"
  - "gh"
  - "issue"
  - "pull request"
  - "release"
  - "workflow"
  - "search"
  - "api"
---

# GitHub CLI

只有内置 GitHub Skill 不覆盖任务时才加载本 Skill。当前进程通过 `GH_TOKEN` 提供 gh CLI 身份；先执行 `gh auth status` 核对身份和权限。仓库参数统一使用 `owner/repo`。

## 常用命令

```bash
gh issue list -R owner/repo --state open --limit 20 --json number,title,state,labels,assignees
gh issue view 123 -R owner/repo --json number,title,body,state,labels,assignees
gh issue create -R owner/repo --title "标题" --body "正文"
gh pr list -R owner/repo --state open --limit 20 --json number,title,state,author,mergeable
gh pr view 456 -R owner/repo --json number,title,body,state,author,mergeable,reviewDecision
gh pr checks 456 -R owner/repo
gh pr diff 456 -R owner/repo
gh release list -R owner/repo --limit 10
gh run list -R owner/repo --limit 10 --json databaseId,displayTitle,status,conclusion
gh workflow list -R owner/repo
gh search issues "关键词" --repo owner/repo --limit 10 --json number,title,state
gh search code "函数名" --repo owner/repo --limit 10 --json path,textMatches
```

需要其他 API 时使用 `gh api` 或 `gh api graphql`。任何创建、修改、合并、关闭、重跑或发布操作都属于外部副作用，必须遵守执行工具的审批策略。

## 输出控制

- 列表必须使用 `--limit`，默认不超过 20 条。
- 使用 `--json` 与 `--jq` 只保留任务需要的字段。
- 正文最多读取 2000 字符，diff 最多读取 200 行。
- 单次调用输出应小于 15KB。

遇到 401 检查身份与 Token；404 同时检查资源存在性和权限；422 检查必填参数。不要把命令失败推断成资源不存在。
