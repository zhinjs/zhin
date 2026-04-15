---
name: github
platforms:
  - github
description: >-
  GitHub 全功能适配器技能：通过适配器内置工具完成用户交互操作（Star/Fork/账号绑定/Webhook 订阅/App 安装），
  通过 bash + gh CLI 完成仓库自动化操作（Issue/PR/Release/CI/搜索/文件/Discussion）。
  Bot 操作使用 GitHub App 身份，Star/Fork 等用户操作使用个人绑定的 OAuth Token。
  每个 Zhin 实例通过 GH_TOKEN 环境变量注入身份，支持多实例协同。
  channel ID 格式：owner/repo/issues/N 或 owner/repo/pull/N。
keywords:
  - github
  - gh
  - cli
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
  - bind
  - unbind
  - whoami
  - 绑定
  - 授权
  - label
  - assign
  - file
  - commit
  - compare
  - edit
  - webhook
  - subscribe
  - discussion
tags:
  - github
  - development
  - git
  - ci-cd
tools:
  - bash
  - github_star
  - github_fork
  - github_bind
  - github_unbind
  - github_whoami
  - github_install
  - github_subscribe
  - github_unsubscribe
  - github_subscriptions
always: false
requires:
  bins:
    - gh
  env:
    - GH_TOKEN
---

# GitHub 全功能操作指南

本技能提供两种操作方式：
- **适配器内置工具**（`github_*`）：用户交互类操作，具备账号绑定、Device Flow 授权、频道级订阅等适配器专有逻辑
- **bash + gh CLI**：仓库自动化操作，灵活覆盖 GitHub API 全场景

## 一、适配器内置工具

以下工具由 GitHub 适配器注册，具有特殊行为（用户 OAuth 绑定、频道绑定等），**不能用 gh CLI 替代**。

### 账号与身份

| 工具 | 说明 |
|------|------|
| `github_bind` | 绑定用户的 GitHub 账号（Device Flow 授权，无需输入密码）。用户想 star/fork 或操作自己的账号时，先引导使用此工具 |
| `github_unbind` | 解除用户绑定的 GitHub 账号 |
| `github_whoami` | 查看用户已绑定的 GitHub 账号信息 |
| `github_install` | 获取安装 GitHub App 的链接，安装后 Bot 可访问用户的仓库 |

### 用户操作（使用绑定账号）

| 工具 | 说明 |
|------|------|
| `github_star` | Star 或取消 Star 一个仓库。优先使用用户绑定的 GitHub 账号，未绑定则降级为 Bot 默认账号 |
| `github_fork` | Fork 一个仓库。优先使用用户绑定的 GitHub 账号，未绑定则降级为 Bot 默认账号 |

### Webhook 订阅（频道级）

| 工具 | 说明 |
|------|------|
| `github_subscribe` | 订阅仓库的 Webhook 事件，推送到**当前聊天通道** |
| `github_unsubscribe` | 取消订阅仓库的 Webhook 事件 |
| `github_subscriptions` | 查看当前聊天通道的订阅列表 |

### 内置工具执行规则

1. `github_star` 和 `github_fork` 优先使用用户绑定的 GitHub 账号，未绑定则降级为 Bot 默认账号
2. 当用户想操作自己的 GitHub 账号时，先引导用户使用 `github_bind` 绑定
3. Webhook 订阅关联到当前聊天通道，仅在该通道接收事件通知

---

## 二、gh CLI 全场景速查

当适配器内置工具不能满足需求（如 Release 管理、Workflow 触发、Discussion、gh api 万能调用），或需要更灵活的参数控制时，使用 `bash` 工具调用 `gh` CLI。当前进程已通过 `GH_TOKEN` 环境变量注入身份凭据。

### 0. 前提检查

```bash
gh --version
gh auth status
```

### 1. 仓库（gh repo）

```bash
gh repo view owner/repo
gh repo list owner --limit 10 --json name,description
gh repo clone owner/repo
gh repo create owner/new-repo --public --description "描述"
```

### 2. Issue（gh issue）

```bash
gh issue list -R owner/repo --state open --limit 20 --json number,title,state,labels,assignees
gh issue view 123 -R owner/repo --json number,title,body,state,labels,assignees --jq '{number,title,state,labels,assignees,body: .body[:2000]}'
gh issue create -R owner/repo --title "标题" --body "正文" --label "bug" --assignee "user1"
gh issue close 123 -R owner/repo
gh issue reopen 123 -R owner/repo
gh issue comment 123 -R owner/repo --body "评论内容"
gh issue edit 123 -R owner/repo --title "新标题"
gh issue edit 123 -R owner/repo --add-label "enhancement" --remove-label "bug"
gh issue edit 123 -R owner/repo --add-assignee "user2" --remove-assignee "user1"
```

### 3. Pull Request（gh pr）

```bash
gh pr list -R owner/repo --state open --limit 20 --json number,title,state,author,mergeable
gh pr view 456 -R owner/repo --json number,title,body,state,author,mergeable,reviewDecision --jq '{number,title,state,author,mergeable,reviewDecision,body: .body[:2000]}'
gh pr create -R owner/repo --title "标题" --body "描述" --base main --head feature-branch
gh pr merge 456 -R owner/repo --squash --delete-branch
gh pr close 456 -R owner/repo
gh pr reopen 456 -R owner/repo
gh pr comment 456 -R owner/repo --body "评论内容"
gh pr review 456 -R owner/repo --approve
gh pr review 456 -R owner/repo --request-changes --body "需要修改的内容"
gh pr review 456 -R owner/repo --comment --body "一般性建议"
gh pr checks 456 -R owner/repo
gh pr diff 456 -R owner/repo | head -n 200
```

### 4. Release（gh release）

```bash
gh release list -R owner/repo --limit 10
gh release view v1.0.0 -R owner/repo
gh release create v1.0.0 -R owner/repo --title "v1.0.0" --notes "发布说明" --target main
gh release delete v1.0.0 -R owner/repo --yes
```

### 5. Workflow / CI（gh run & gh workflow）

```bash
gh run list -R owner/repo --limit 10 --json databaseId,displayTitle,status,conclusion
gh run view 12345 -R owner/repo
gh run rerun 12345 -R owner/repo --failed
gh workflow list -R owner/repo
gh workflow run ci.yml -R owner/repo --ref main
```

### 6. 搜索（gh search）

```bash
gh search issues "关键词" --repo owner/repo --limit 10 --json number,title,state
gh search repos "关键词" --limit 10 --json fullName,description,stargazersCount
gh search code "函数名" --repo owner/repo --limit 10 --json path,textMatches
```

### 7. 标签与指派

```bash
gh label list -R owner/repo
gh label create "priority:high" -R owner/repo --color FF0000 --description "高优先级"
gh issue edit 123 -R owner/repo --add-label "priority:high"
gh issue edit 123 -R owner/repo --remove-label "priority:low"
gh issue edit 123 -R owner/repo --add-assignee "user1"
gh issue edit 123 -R owner/repo --remove-assignee "user2"
```

### 8. 文件与提交

```bash
gh api /repos/owner/repo/contents/path/to/file --jq '.content' | base64 -d
gh api /repos/owner/repo/commits --jq '.[0:10] | .[] | {sha: .sha[:7], message: .commit.message[:80], author: .commit.author.name, date: .commit.author.date}'
gh api /repos/owner/repo/compare/main...feature --jq '{ahead_by, behind_by, files: [.files[:20][] | {filename, status, changes}]}'
```

### 9. Discussion

```bash
gh api /repos/owner/repo/discussions --jq '.[0:10] | .[] | {number, title, category: .category.name}'
gh api /repos/owner/repo/discussions/categories --jq '.[] | {id: .node_id, name, slug}'
gh api graphql -f query='mutation {
  createDiscussion(input: {
    repositoryId: "REPO_NODE_ID",
    categoryId: "CATEGORY_NODE_ID",
    title: "标题",
    body: "正文"
  }) { discussion { number url } }
}'
gh api -X POST /repos/owner/repo/discussions/{number}/comments -f body="评论内容"
```

### 10. 万能 fallback：gh api

```bash
gh api /repos/owner/repo/xxx
gh api -X POST /repos/owner/repo/xxx -f key=value
gh api -X PATCH /repos/owner/repo/xxx -f key=value
gh api graphql -f query='{ repository(owner:"owner", name:"repo") { ... } }'
```

---

## 三、输出控制黄金规则

**所有 gh CLI 命令都必须控制输出大小**，防止 token 爆炸：

| 手段 | 示例 |
|------|------|
| `--json` + `--jq` | 精确控制返回字段和条数 |
| `--limit N` | 列表不超过 20 条 |
| `--jq '.body[:2000]'` | 截断长文本字段 |
| `\| head -n 200` | 截断 diff 等大文本 |

**目标：单次调用输出 < 15KB。**

## 四、常见错误与修复

| 错误 | 原因 | 修复 |
|------|------|------|
| `gh: command not found` | 未安装 gh CLI | 需管理员安装 |
| `HTTP 401` | Token 无效或过期 | 检查 GH_TOKEN 环境变量 |
| `HTTP 404` | 仓库/资源不存在或无权限 | 确认 owner/repo 和 Token scope |
| `HTTP 422` | 参数不合法 | 检查必填字段是否缺失 |
| `GraphQL: ...` | GraphQL 查询语法错误 | 检查 query 拼写与字段名 |
