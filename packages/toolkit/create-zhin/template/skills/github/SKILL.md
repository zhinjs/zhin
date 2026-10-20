---
name: github
description: "Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects. Use when asked to write an issue, PR description, changelog entry, or review comment. Triggers: 写 issue, PR 描述, 提 PR, release notes, gh pr."
keywords:
  - github
  - issue
  - pull request
  - pr
  - release notes
  - 写 issue
tags:
  - github
  - collaboration
  - documentation
---

# GitHub

为 Zhin 生态仓库生成可直接粘贴的 GitHub 文案（Issue / PR / Review / Release），不代替 `gh` 执行发布。

## 何时使用

- 写 Bug 报告、功能请求、PR 说明、Review 意见、版本发布说明
- 需要把本地验证结果整理成「Test plan」
- 不要用来改代码逻辑（除非用户明确要求附带补丁说明）

## 工作流

### Issue

1. **标题**：`[area] 简短问题陈述`（area 如 `agent` / `adapter-icqq` / `cli`）
2. 输出完整 Markdown（可直接贴 GitHub）：

```markdown
## 环境
- Node: v24.x
- zhin.js / @zhin.js/*: （版本或 commit）
- 适配器: icqq / telegram / ...
- OS: macOS / Linux

## 复现步骤
1. ...
2. ...

## 期望行为
...

## 实际行为
...

## 日志 / 截图
（脱敏；无 token）
```

### Pull Request

1. 输出完整 Markdown：

```markdown
## Summary
- ...

## Test plan
- [x] `pnpm --filter @zhin.js/core test`
- [x] `pnpm type-check`
- [ ] `pnpm test`（如未跑则写原因）

## Risk
- Breaking: `zhin.config` `bots` → `endpoints`（如适用）
- DB: 自动迁移 `bot_id` → `endpoint_id`（如适用）

## Changeset
- [ ] 已添加 changeset（monorepo 发布包时必填）
```

2. monorepo 常用验证命令（按改动范围选子集）：

```bash
pnpm --filter <pkg> build
pnpm --filter <pkg> test
pnpm type-check
pnpm check:architecture   # 跨层改动时
```

### Review

- 按文件或主题分组
- 区分 **blocking** vs **nit**
- 给出具体修改建议，避免空泛「建议优化」

### Release notes

- 按 Keep a Changelog：`Added` / `Changed` / `Fixed` / `Breaking`
- Breaking 必须写迁移步骤（如 `bots:` → `endpoints:`）

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| 信息不足 | 列出缺失项（版本、配置、日志），🔴 暂停生成 | 用户补充后再写 |
| 含 token/密钥 | 删除敏感字段，用 `<REDACTED>` 占位 | 提醒用户轮换已泄漏凭证 |
| `gh` 不可用 | 只输出 Markdown；给出 `gh issue create` / `gh pr create` 示例命令 | 用户手动在网页创建 |

## 🔴 CHECKPOINT · 敏感信息

生成前扫描：API token、`.env` 内容、私聊 ID、内网 URL。命中则不得写入 Issue/PR 正文。

## 不要做什么

- 不要在 Issue/PR 里贴完整 `zhin.config.yml` 密钥
- 不要编造未运行的测试结果为「已通过」
- 不要把内部机器 hostname/IP 写进公开 issue
- 不要用 PR 描述代替 Changeset（monorepo 发布流程）
- 不要对非 Zhin 仓库套用 `packages/im` 分层术语

## 工具

用户要求代发时，在项目根用 `gh`（需已 `gh auth login`）：

```bash
gh issue create --title "..." --body-file /tmp/issue.md
gh pr create --title "..." --body-file /tmp/pr.md
```

## 延伸阅读

| 文档 | 路径 |
|------|------|
| 贡献与 PR 流程 | `docs/agents/issue-tracker.md` |
| Changeset | 根目录 `pnpm changeset` |
| 架构约束 | `AGENTS.md` |
