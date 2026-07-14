# @zhin.js/adapter-github

把 GitHub 当聊天通道 — Issue/PR 评论区即群聊，通过 GitHub App 认证，纯 REST API 对接，零 CLI 依赖。

查询 · 管理 · 通知 · OAuth 用户绑定 四合一。

## 功能特性

- ✅ **聊天通道**：Issue/PR 评论区映射为群聊，支持收发消息
- ✅ **仓库管理**：PR 合并/创建/Review/关闭、Issue 创建/关闭/评论
- ✅ **信息查询**：Star、Branch、Release、CI Workflow 等
- ✅ **事件通知**：Webhook 订阅，跨平台推送到任意聊天
- ✅ **GitHub App 认证**：JWT → Installation Token，自动刷新
- ✅ **OAuth 用户绑定**：用户可绑定自己的 GitHub 账号，star/fork 以个人身份执行
- ✅ **Bot 开发工作流**：托管 git 工作区 + App 身份 push/开 PR（HITL 确认）
- ✅ **无 router 也能运行**：核心功能不依赖 HTTP 服务，有 router 时自动注册 Webhook 和 OAuth 路由

## 安装

```bash
pnpm add @zhin.js/adapter-github
```

## 依赖

- `@zhin.js/host-router`（可选）— 提供 Webhook 路由，用于接收 GitHub 事件推送

## GitHub App 创建

1. 访问 [GitHub Developer Settings](https://github.com/settings/apps)
2. 点击 **New GitHub App**
3. 填写基本信息：
   - **App name**: 你的 bot 名称
   - **Homepage URL**: 任意
   - **Webhook URL**: `http://your-server:port/pub/github/webhook`（有 HTTP 服务时）
   - **Webhook secret**: 自定义密钥
4. 权限设置（Permissions）：
   - **Repository → Issues**: Read & Write
   - **Repository → Pull requests**: Read & Write
   - **Repository → Contents**: Read & Write（Bot 提交代码）
   - **Repository → Metadata**: Read
   - **Repository → Actions**: Read（查看 CI）
5. 订阅事件（Subscribe to events）：
   - Issue comment、Pull request、Pull request review、Pull request review comment
   - Push、Star、Fork（用于通知）
6. 创建后记录 **App ID**，点击 **Generate a private key** 下载 `.pem` 文件
7. 安装 App 到目标仓库/组织

## 配置

```yaml
# zhin.config.yml
endpoints:
  - context: github
    name: my-github-bot
    app_id: 123456
    private_key: ./data/github-app.pem   # PEM 文件路径或直接粘贴内容
    webhook_secret: your-secret          # 可选；配置后启用 Webhook
    webhook_path: /pub/github/webhook    # 可选
    auto_reply_repos:                    # 可选：这些 repo 的评论自动触发 AI
      - zhinjs/zhin
    workspace_root: ./data/github-workspaces  # 可选：Bot git 工作区

plugins:
  - database
  - "@zhin.js/adapter-github"
  - "@zhin.js/host-router"                # Webhook 需要
```

```env
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-secret
# MCP server-github（可选；PAT = 人身份，默认关闭）
# ai.githubMcp.enabled: true
# GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxxxxxxxxxx
```

`private_key` 支持两种写法：
- 文件路径：`./data/github-app.pem`
- 直接内容：`"-----BEGIN RSA PRIVATE KEY-----\n..."`

## Channel ID 格式

GitHub adapter 将 Issue/PR 映射为聊天频道：

| 类型 | Channel ID | 示例 |
|------|-----------|------|
| Issue | `owner/repo/issues/N` | `zhinjs/zhin/issues/42` |
| PR | `owner/repo/pull/N` | `zhinjs/zhin/pull/108` |

## AI 工具

### 适配器内置（Zhin 专有）

| 工具 | 说明 |
|------|------|
| `github_star` | Star / Unstar / 检查（per-user OAuth 或 Endpoint 默认） |
| `github_bind` / `github_unbind` / `github_whoami` | 用户 GitHub 账号绑定 |
| `github_install` | GitHub App 安装链接 |
| `github_subscribe` / `github_unsubscribe` / `github_subscriptions` | 频道级 Webhook 订阅 |
| `github_prepare_workspace` | Clone/fetch 托管工作区并 checkout 分支 |
| `github_patch_file` | Contents API 单文件更新（Bot 身份） |
| `github_push_branch` | git commit + push（**需 HITL**） |
| `github_create_pr` | 创建 PR（**需 HITL**） |

### Bot 工作流（App 身份）

- 评论回复：Webhook → `$reply`，Installation Token，UI 显示 `{slug}[bot]` + **Bot** 徽章
- 开发提交：`github_prepare_workspace` → bash 改代码 → `github_push_branch`（确认）→ Issue 场景 `github_create_pr`
- PR 线程：push 到现有 PR head 分支，不新开 PR
- 工作区默认：`data/github-workspaces/{owner}/{repo}`

### MCP（`@modelcontextprotocol/server-github`，可选）

仅当 `ai.githubMcp.enabled: true` 且配置 PAT 时注册。`mcp_github_*` 以**用户 PAT** 操作，**不能**作为 Bot 写仓库。Bot 写操作请用上方 `github_*` 工具。

### 使用示例

```
AI: 列出 zhinjs/zhin 的 PR
AI: 合并 zhinjs/zhin 的 PR #108
AI: 查看 zhinjs/zhin 的 star 数
AI: 订阅 zhinjs/zhin 的 push 和 pr 事件
AI: 搜索 zhinjs 相关的仓库
AI: 给 zhinjs/zhin 的 issue #42 加上 bug 标签
AI: 查看 zhinjs/zhin 的 README.md 文件
AI: 对比 zhinjs/zhin 的 main 和 dev 分支
AI: 编辑 zhinjs/zhin 的 issue #42 标题
AI: 绑定我的 GitHub 账号
AI: star zhinjs/zhin
AI: fork zhinjs/zhin   # 使用 mcp_github_fork_repository
```

## Webhook 事件通知

配置好 Webhook 后，支持以下事件的跨平台推送：

| 事件 | 参数 | 说明 |
|------|------|------|
| Push | `push` | 代码推送 |
| Issue | `issue` | Issue 创建/更新/关闭 |
| Star | `star` | 仓库被 star |
| Unstar | `unstar` | 仓库被 unstar |
| Fork | `fork` | 仓库被 fork |
| Pull Request | `pr` / `pull_request` | PR 创建/更新/合并 |

### Webhook 端点

```
POST /pub/github/webhook
```

Headers:
- `X-GitHub-Event`: 事件类型
- `X-Hub-Signature-256`: 签名（配置了 secret 时）

## OAuth 用户绑定（Device Flow）

用户通过工具 **`github_bind`** 绑定 GitHub 账号（[OAuth Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)），**不是**浏览器 OAuth 回调页面。

### 认证策略

| 操作类型 | 使用的 Token | 原因 |
|---------|------------|------|
| 读取 issue/PR/repo 信息 | App JWT | 不涉及用户身份 |
| 评论（bot 发言） | App Installation Token | 以 `{slug}[bot]` 机器人身份发言 |
| push / 开 PR | App Installation Token + git author | UI **Bot** 徽章（非 Member） |
| star / unstar | User OAuth | 个人行为 |
| fork | User OAuth | 个人行为 |

### 绑定流程

1. 用户在聊天中触发 `github_bind`（或说「绑定 GitHub」）
2. Endpoint 返回 **verification URI** 与 **user code**（GitHub Device Flow）
3. 用户在浏览器打开链接并输入 code 完成授权
4. Token 写入 `github_oauth_users` 表；可用 `github_whoami` / `github_unbind` 管理

**Client ID**：从 GitHub App 的 `/app` API 自动获取（`GhClient.getClientId()`），**无需**在 Endpoint 配置里写 `client_id` / `client_secret`。

### 前置条件

- 需要 **`database`** 插件（`github_oauth_users` 模型）
- Device Flow 在 IM 内完成，**不依赖** `/pub/github/oauth` HTTP 路由

## 数据库表

### github_subscriptions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 主键 |
| repo | text | 仓库名 (owner/repo) |
| events | json | 订阅的事件列表 |
| target_id | text | 目标频道 ID |
| target_type | text | 类型 (private/group/channel) |
| adapter | text | 适配器名称 |
| endpoint | text | 机器人名称 |

### github_events

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 主键 |
| repo | text | 仓库名 |
| event_type | text | 事件类型 |
| payload | json | 事件载荷 |

### github_oauth_users

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 主键 |
| platform | text | 聊天平台 |
| platform_uid | text | 平台用户 ID |
| github_login | text | GitHub 用户名 |
| access_token | text | Device Flow 获得的 token |
| created_at | integer | 创建时间戳 |

## 架构说明

```
adapter-github/
├── src/
│   ├── index.ts              # 插件入口：provide、useContext、模型表
│   ├── adapter.ts            # GitHubAdapter
│   ├── endpoint.ts                # GitHubEndpoint（Issue/PR 频道）
│   ├── gh-client.ts          # GitHub REST（App JWT / Installation Token）
│   ├── register-github-mcp.ts # orchestrator.addMcp(server-github)
│   ├── agent-prompt.ts       # 平台 prompt / deferred 工具筛选
│   └── types.ts              # EndpointConfig、Webhook payload、Channel ID
├── package.json
└── README.md
```

- **无 `@zhin.js/host-router` 时**：REST 工具与轮询仍可用，但无法注册 Webhook
- **有 `@zhin.js/host-router` 时**：注册 Webhook；MCP 通过 `orchestrator.addMcp`（需 PAT 或 `ai.githubMcp.token`）

## 许可证

MIT
