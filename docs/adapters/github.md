---
title: "@zhin.js/adapter-github"
package: "@zhin.js/adapter-github"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/github/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/github/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=9ff0c7673eb7000f -->

# @zhin.js/adapter-github

GitHub Plugin Runtime 适配器 — Issue/PR 评论区即聊天通道，GitHub App 认证，Webhook 入站经 `httpHostToken`。

## 功能特性

- **聊天通道**：Issue/PR 评论区映射为群聊，支持收发消息
- **Webhook 入站**：HMAC-SHA256 验签 → `messageGatewayToken`
- **出站**：`send({ conversation, payload })` → Issue/PR comment（`conversation.id` 为 channel ID）
- **GitHub App 认证**：JWT → Installation Token
- **Agent 工具**：`agent/` 下 star/bind/subscribe/workspace 等保留

## 安装

```bash
pnpm add @zhin.js/adapter-github
```

Webhook 需要 Root 提供 `@zhin.js/host-http`（`zhin runtime start` 默认装配）。

## 前置条件

1. 创建 GitHub App，记录 App ID、私钥与 Webhook Secret。
2. 授予目标仓库所需的 Issues、Pull requests 与 Contents 权限。
3. 将 Webhook 指向公网 HTTPS 的 `/github/webhook`，并订阅 Issue、PR 与评论事件。
4. 把 App 安装到目标仓库；仓库 Workroom 使用稳定的 `owner/repo` 地址匹配。

## 配置（Plugin Runtime）

```yaml
# zhin.config.yml
plugins:
  github:
    webhook_path: /github/webhook
    auto_reply_repos:
      - zhinjs/zhin
    workspace_root: ./data/github-workspaces
    endpoints:
      - name: my-github-bot
        app_id: 123456
        private_key: ./data/github-app.pem
        webhook_secret: your-secret
```

```env
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-secret
```

`private_key` 支持文件路径或 PEM 内容。未配置 `webhook_secret` 时仅 API 出站 / agent 工具可用（无入站）。

多 App：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`name` 必填）：

```yaml
plugins:
  github:
    endpoints:
      - name: app-a
        app_id: 123456
        private_key: ./data/app-a.pem
      - name: app-b
        app_id: 234567
        private_key: ./data/app-b.pem
```

## 已移除的配置

- **`ai.githubMcp.enabled` / `ai.githubMcp.token`**：Plugin Runtime 迁移后 `register-github-mcp`（stdio `@modelcontextprotocol/server-github`，PAT 人身份）已移除，该配置不再生效。如需 MCP 工具，请按新运行时 `mcp/<name>.ts`（`@zhin.js/mcp-feature`）约定自行装配。
- **`poll_interval`**：轮询降级已删除，仅 webhook 入站；该字段目前解析但不生效（deferred）。

## Channel ID

| 类型 | Channel ID | 示例 |
|------|-----------|------|
| Issue | `owner/repo/issues/N` | `zhinjs/zhin/issues/42` |
| PR | `owner/repo/pull/N` | `zhinjs/zhin/pull/108` |

## AI 工具

见 `agent/tools/`：`github_star`、`github_bind`、`github_subscribe`、`github_prepare_workspace` 等。

## 架构

| 路径 | 职责 |
|------|------|
| `plugin.ts` | 插件元数据；有 DatabaseHost 时定义 `github_oauth_users` |
| `adapters/github.ts` | 薄 `defineAdapter` 入口（发现约定） |
| `src/endpoint.ts` | Endpoint 生命周期、出站、admit |
| `src/webhook.ts` | HMAC 验签与事件分发 |
| `src/oauth-users.ts` | OAuth 表 SSOT + token 查找 |
| `src/protocol.ts` | 协议纯函数（channel / payload） |
| `src/gh-client.ts` | GitHub API 客户端 |

- 入站：`httpHostToken` POST → `messageGatewayToken.receive`
- 出站：`send({ conversation, payload })`

## 故障排查

| 现象 | 排查 |
| --- | --- |
| Webhook 401 | 检查 Secret、`X-Hub-Signature-256` 与原始请求体 |
| App 鉴权失败 | 检查 App ID、私钥 PEM/文件路径与服务器时钟 |
| 评论没有进入 Workroom | 先查 Endpoint 收件箱，再核对 Catalog 的 Endpoint 与 `owner/repo` |
| 能收事件但不能回复 | 检查 installation 与仓库权限；PAT MCP 不替代 App 出站 |

## License

MIT
