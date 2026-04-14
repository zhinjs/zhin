# @zhin.js/devteam

多 Agent 协同开发插件 - 基于 GitHub Project 看板驱动的自动化研发流程。

## 概述

一个主 Agent（项目总监）管理五个子 Agent：

| 角色 | 职责 |
|------|------|
| 📋 项目经理 | 需求整理、评审协调、验收确认 |
| 🎨 设计师 | 设计稿产出、评审参与、走查验收 |
| 💻 开发人员 | 需求评审、编码开发、Bug修复、自测 |
| 🧪 测试人员 | 测试用例编写、完整测试、Bug跟踪 |
| 🚀 运维人员 | CI/CD管理、测试环境部署、生产上线 |

## 需求状态流转

```
用户反馈 → 待整理 → 等待设计(*) → 等待评审 → 评审中 → 评审完成 → 等待开发
                         ↑                                          ↓
                         └─────────────────────────────────────── 开发中
                                                                    ↓
等待走查 ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
    ↓
走查通过 / 走查不通过 → 修复 → 等待走查
    ↓
等待测试 → 测试中 → 等待上线 → 等待验收 → 已完成
```

(*) 等待设计阶段为可选，不需要设计的需求直接进入等待评审。

## 配置

在 `zhin.config.yml` 中添加：

```yaml
devteam:
  githubToken: 'ghp_xxxx'          # GitHub Personal Access Token
  owner: 'your-org'                # 仓库 Owner
  repo: 'your-repo'                # 仓库名
  projectNumber: 1                 # GitHub Project 编号
  productionBranch: 'main'         # 生产分支
  testEnvUrl: 'https://test.example.com'   # 测试环境 URL
  productionUrl: 'https://example.com'     # 生产环境 URL
  triageCron: '0 9 * * 1-5'       # 每日需求整理时间（工作日 9:00）
  pollIntervalMinutes: 5           # 看板状态同步间隔
```

## GitHub Project 看板设置

在 GitHub Project V2 中创建 **Status** 单选字段，添加以下选项：

- 待整理
- 等待设计
- 等待评审
- 评审中
- 评审完成
- 等待开发
- 开发中
- 等待走查
- 走查通过
- 走查不通过
- 等待测试
- 测试中
- 等待上线
- 等待验收
- 已完成
- 已关闭

## AI 工具列表

### 看板操作
- `devteam_create_requirement` - 创建新需求
- `devteam_update_status` - 更新需求状态
- `devteam_get_requirement` - 获取需求详情
- `devteam_list_requirements` - 列出需求
- `devteam_add_comment` - 添加评论/讨论

### 开发操作
- `devteam_create_branch` - 创建开发分支
- `devteam_create_pr` - 创建 Pull Request
- `devteam_merge_pr` - 合并 PR
- `devteam_check_ci` - 检查 CI/CD 状态
- `devteam_get_pr_status` - 获取 PR 详情

### 反馈管理
- `devteam_list_feedback` - 列出用户反馈
- `devteam_mark_feedback_processed` - 标记反馈已处理

## Agent 预设

插件包含 5 个 Agent 预设文件（`agents/*.agent.md`），框架自动发现并注册：

- `devteam-project-manager` - 项目经理
- `devteam-designer` - 设计师
- `devteam-developer` - 开发人员
- `devteam-tester` - 测试人员
- `devteam-ops` - 运维人员

## 架构

```
┌─────────────────────────────────────────────────┐
│                  主 Agent (总监)                  │
│         收集用户反馈 → feedbacks[]               │
└───────────────────────┬─────────────────────────┘
                        │ 事件总线 (DevTeamEventBus)
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  项目经理    │ │   设计师     │ │   开发人员   │
│  PM Agent    │ │ Designer     │ │  Developer   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       ▼                ▼                ▼
┌──────────────┐ ┌──────────────────────────────┐
│  测试人员    │ │         运维人员              │
│ Tester       │ │          Ops                  │
└──────────────┘ └──────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  GitHub Project  │
              │    看板 (V2)     │
              └──────────────────┘
```
