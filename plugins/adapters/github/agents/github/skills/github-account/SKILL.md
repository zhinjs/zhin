---
name: github-account
platforms:
  - github
description: GitHub 账号绑定、安装状态和身份查询能力。
keywords:
  - "github"
  - "账号"
  - "绑定"
  - "安装"
tools:
  - "bind"
  - "install"
  - "unbind"
  - "whoami"
---

# github-account

处理 GitHub 身份与绑定状态时加载。`bind` 使用 Device Flow 绑定用户 OAuth 身份；`install` 返回 GitHub App 安装入口；`whoami` 用于确认当前绑定。用户想用自己的账号执行操作时先绑定。解绑和安装相关操作遵守 Tool 审批，不回显 Token、Device Code 或其他凭据。
