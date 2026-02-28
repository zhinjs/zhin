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
- ✅ **AI Skill**：所有工具自动暴露给 AI 调用
- ✅ **无 router 也能运行**：核心功能不依赖 HTTP 服务，有 router 时自动注册 Webhook 和 OAuth 路由

## 安装

```bash
pnpm add @zhin.js/adapter-github
```

## 依赖

- `@zhin.js/http`（可选）— 提供 Webhook 路由，用于接收 GitHub 事件推送

## GitHub App 创建

1. 访问 [GitHub Developer Settings](https://github.com/settings/apps)
2. 点击 **New GitHub App**
3. 填写基本信息：
   - **App name**: 你的 bot 名称
   - **Homepage URL**: 任意
   - **Webhook URL**: `http://your-server:port/api/github/webhook`（有 HTTP 服务时）
   - **Webhook secret**: 自定义密钥
4. 权限设置（Permissions）：
   - **Repository → Issues**: Read & Write
   - **Repository → Pull requests**: Read & Write
   - **Repository → Contents**: Read
   - **Repository → Metadata**: Read
   - **Repository → Actions**: Read（查看 CI）
5. 订阅事件（Subscribe to events）：
   - Issue comment、Pull request、Pull request review、Pull request review comment
   - Push、Star、Fork（用于通知）
6. 创建后记录 **App ID**，点击 **Generate a private key** 下载 `.pem` 文件
7. 如需 OAuth 用户绑定功能，记录 **Client ID** 和 **Client Secret**（在 App 设置页的 General 中）
8. 在 App 设置页配置 **Callback URL**: `https://your-domain/github/oauth/callback`
9. 安装 App 到目标仓库/组织

## 配置

```yaml
# zhin.config.yml
bots:
  - context: github
    name: my-github-bot
    app_id: 123456
    private_key: ./data/github-app.pem   # PEM 文件路径或直接粘贴内容
    # installation_id: 78901234           # 可选，不填则自动获取第一个
    # webhook_secret: your-secret         # 可选，Webhook 签名验证
    # client_id: Iv1.xxxxxxxxxx           # 可选，OAuth 用户绑定
    # client_secret: xxxxxxxxxxxx         # 可选，配合 client_id 使用
    # public_url: https://bot.example.com # 可选，OAuth 回调和绑定链接的公开地址

plugins:
  - "@zhin.js/adapter-github"
  - "@zhin.js/http"                       # 可选，提供 Webhook + OAuth 能力
```

`.env` 文件：
```env
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-secret
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxx
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

适配器自动注册以下工具供 AI 调用：

| 工具 | 说明 | 操作 |
|------|------|------|
| `github.pr` | PR 管理 | list / view / diff / merge / create / review / close |
| `github.issue` | Issue 管理 | list / view / create / close / comment |
| `github.repo` | 仓库查询 | info / branches / releases / runs(CI) / stars |
| `github.search` | 全局搜索 | issues / repos / code |
| `github.label` | 标签管理 | list / add / remove |
| `github.assign` | 指派管理 | add / remove |
| `github.file` | 读取仓库文件 | 返回文件内容或目录列表 |
| `github.commits` | 提交查询 | list / compare |
| `github.edit` | 编辑 Issue/PR | 修改标题、正文、状态 |
| `github.subscribe` | 订阅事件通知 | 订阅仓库的 push/issue/star/fork/pr 事件 |
| `github.unsubscribe` | 取消订阅 | — |
| `github.subscriptions` | 查看订阅列表 | — |
| `github.bind` | 绑定 GitHub 账号 | 生成 OAuth 授权链接 |
| `github.unbind` | 解除绑定 | — |
| `github.whoami` | 查看绑定信息 | — |
| `github.star` | Star / Unstar 仓库 | 需要用户绑定 OAuth |
| `github.fork` | Fork 仓库 | 需要用户绑定 OAuth |

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
AI: fork zhinjs/zhin
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
POST /api/github/webhook
```

Headers:
- `X-GitHub-Event`: 事件类型
- `X-Hub-Signature-256`: 签名（配置了 secret 时）

## OAuth 用户绑定

支持聊天平台用户绑定自己的 GitHub 账号。绑定后，star/fork 等个人操作将以用户自己的身份执行。

### 认证策略

| 操作类型 | 使用的 Token | 原因 |
|---------|------------|------|
| 读取 issue/PR/repo 信息 | App JWT | 不涉及用户身份 |
| 评论（bot 发言） | App JWT | 以机器人身份发言 |
| star / unstar | User OAuth | 个人行为 |
| fork | User OAuth | 个人行为 |
| 创建 issue / PR | 视场景选择 | 已绑定用用户 token，未绑定用 App |

### 绑定流程

1. 用户在聊天中发送"绑定 GitHub 账号"或触发 `github.bind` 工具
2. Bot 返回一个带有 `state` 的 OAuth 授权链接
3. 用户点击链接 → 浏览器跳转到 GitHub 授权页面
4. 用户授权后 → GitHub 回调到 `/api/github/oauth/callback`
5. 服务端交换 code → access_token，获取用户信息，存入数据库
6. 用户看到"绑定成功"页面

### OAuth 端点

| 路由 | 说明 |
|------|------|
| `GET /github/oauth?state=xxx` | 发起 GitHub 授权重定向 |
| `GET /github/oauth/callback?code=xxx&state=xxx` | GitHub 回调，完成绑定 |

> OAuth 路由注册在 `/github/` 而非 `/api/` 下，因此不受 API Token 认证限制，用户浏览器可直接访问。

### 前置条件

- 需要配置 `client_id` 和 `client_secret`
- 需要 `@zhin.js/http` 插件（提供 HTTP 路由）
- GitHub App 设置页中的 Callback URL 须指向 `https://your-domain/github/oauth/callback`

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
| bot | text | 机器人名称 |

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
| platform | text | 聊天平台 (icqq / kook / discord) |
| platform_uid | text | 聊天平台用户 ID |
| github_login | text | GitHub 用户名 |
| github_id | integer | GitHub 用户 ID |
| access_token | text | OAuth access_token |
| scope | text | 授权范围 |
| created_at | date | 创建时间 |
| updated_at | date | 更新时间 |

## 架构说明

```
adapter-github/
├── src/
│   ├── index.ts     # GitHubBot + GitHubAdapter + 工具注册 + Webhook
│   ├── api.ts       # GitHub REST API 客户端 (JWT 认证)
│   └── types.ts     # 类型定义 (BotConfig, Webhook Payloads, Channel ID)
├── package.json
└── README.md
```

- **无 `@zhin.js/http` 时**：适配器正常运行，可使用所有 API 工具（PR/Issue/Repo 管理），但无法接收 Webhook 推送和 OAuth 绑定
- **有 `@zhin.js/http` 时**：通过 `useContext('router')` 自动注册 Webhook 路由 + OAuth 路由，获得事件通知、聊天消息接收和用户绑定能力

## 许可证

MIT
