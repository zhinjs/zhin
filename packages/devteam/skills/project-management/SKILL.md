---
name: project-management
description: 多Agent协同开发项目管理能力，管理需求从用户反馈到上线的完整生命周期
keywords: [项目管理, 需求, 开发流程, 看板, 协同开发, DevTeam]
tags: [devteam, management]
tools: [devteam_create_requirement, devteam_update_status, devteam_get_requirement, devteam_list_requirements, devteam_add_comment, devteam_list_feedback, devteam_mark_feedback_processed, devteam_create_branch, devteam_create_pr, devteam_merge_pr, devteam_check_ci, devteam_get_pr_status]
always: false
---

# 项目管理技能

管理多Agent协同开发的完整研发流程，基于 GitHub Project 看板驱动需求从用户反馈到上线验收的全生命周期。

## 流程概览

1. **需求整理**：项目经理从用户反馈中整理需求
2. **设计阶段**（可选）：设计师根据原型图产出设计稿
3. **需求评审**：开发、测试、设计三方对齐需求细节
4. **编码开发**：开发人员从生产分支切出分支进行开发
5. **设计走查**：设计师验证开发实现是否符合设计稿
6. **测试验证**：测试人员执行完整测试用例
7. **部署上线**：运维合并PR到生产分支并部署
8. **验收确认**：项目经理在生产环境验证需求

## 状态流转

待整理 → 等待设计/等待评审 → 评审中 → 评审完成 → 等待开发 → 开发中 → 等待走查 → 走查通过/走查不通过 → 等待测试 → 等待上线 → 等待验收 → 已完成
