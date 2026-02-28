# @zhin.js/adapter-github

把 GitHub 当聊天通道 — Issue/PR 评论区即群聊，通过 GitHub App 认证，纯 REST API 对接，零 CLI 依赖。

查询 · 管理 · 通知 三合一。

## 功能特性

- ✅ **聊天通道**：Issue/PR 评论区映射为群聊，支持收发消息
- ✅ **仓库管理**：PR 合并/创建/Review/关闭、Issue 创建/关闭/评论
- ✅ **信息查询**：Star、Branch、Release、CI Workflow 等
- ✅ **事件通知**：Webhook 订阅，跨平台推送到任意聊天
- ✅ **GitHub App 认证**：JWT → Installation Token，自动刷新
- ✅ **AI Skill**：所有工具自动暴露给 AI 调用
- ✅ **无 router 也能运行**：核心功能不依赖 HTTP 服务，有 router 时自动注册 Webhook 路由

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
7. 安装 App 到目标仓库/组织

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

plugins:
  - "@zhin.js/adapter-github"
  - "@zhin.js/http"                       # 可选，提供 Webhook 能力
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
| `github.subscribe` | 订阅事件通知 | 订阅仓库的 push/issue/star/fork/pr 事件 |
| `github.unsubscribe` | 取消订阅 | — |
| `github.subscriptions` | 查看订阅列表 | — |

### 使用示例

```
AI: 列出 zhinjs/zhin 的 PR
AI: 合并 zhinjs/zhin 的 PR #108
AI: 查看 zhinjs/zhin 的 star 数
AI: 订阅 zhinjs/zhin 的 push 和 pr 事件
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

- **无 `@zhin.js/http` 时**：适配器正常运行，可使用所有 API 工具（PR/Issue/Repo 管理），但无法接收 Webhook 推送
- **有 `@zhin.js/http` 时**：通过 `useContext('router')` 自动注册 Webhook 路由，获得事件通知和聊天消息接收能力

## 许可证

MIT
