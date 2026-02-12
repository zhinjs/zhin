# GitHub 通知插件

为 Zhin.js 提供 GitHub 仓库事件通知功能。支持好友或群管理订阅仓库的 push、issue、star、fork、unstar、PR 等事件。

## 功能特性

- ✅ 支持多种事件类型：push、issue、star、fork、unstar、pull_request
- ✅ 基于 GitHub Webhook 实时推送
- ✅ 权限控制：仅好友或群管理可订阅
- ✅ 多平台支持：适配所有 Zhin 适配器
- ✅ 数据持久化：使用数据库存储订阅信息
- ✅ 签名验证：支持 Webhook Secret 验证

## 安装

```bash
pnpm add @zhin.js/plugin-github-notify
```

## 配置

在 `zhin.config.yml` 中添加插件：

```yaml
plugins:
  - http               # 必需：提供 HTTP 服务
  - github-notify      # GitHub 通知插件

# GitHub Notify 配置
github-notify:
  webhook_secret: your-webhook-secret   # 可选：Webhook 签名密钥
```

或使用 TypeScript 配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: ['http', 'github-notify'],
})
```
```

## 使用方法

### 1. 订阅仓库

**订阅所有事件**：
```
github.subscribe zhinjs/zhin
```

**订阅指定事件**：
```
github.subscribe zhinjs/zhin push issue star
```

**订阅 PR 事件**：
```
github.subscribe zhinjs/zhin pr
```

### 2. 查看订阅列表

```
github.list
```

### 3. 取消订阅

```
github.unsubscribe zhinjs/zhin
```

## GitHub Webhook 配置

### 步骤 1: 订阅仓库

在聊天中使用命令订阅仓库后，会收到提示信息。

### 步骤 2: 配置 GitHub Webhook

1. 访问仓库设置页面：`https://github.com/owner/repo/settings/hooks`
2. 点击 "Add webhook"
3. 填写配置：
   - **Payload URL**: `http://your-domain:port/api/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: 与插件配置中的 `webhook_secret` 保持一致（可选）
   - **Events**: 选择需要的事件类型
     - Just the push event（仅 push）
     - Send me everything（所有事件）
     - Let me select individual events（自定义选择）
       - Pushes
       - Issues
       - Stars
       - Forks
       - Pull requests

### 步骤 3: 测试

配置完成后，GitHub 会发送一个测试 Webhook。如果成功，你将在日志中看到：

```
收到 GitHub Webhook: ping - owner/repo
```

之后任何符合订阅的事件都会自动推送到订阅的聊天中。

## 事件类型

| 事件类型 | 命令参数 | GitHub 事件 | 说明 |
|---------|---------|------------|------|
| Push | `push` | push | 代码推送 |
| Issue | `issue` | issues | Issue 创建/更新/关闭 |
| Star | `star` | star (created) | 仓库被 star |
| Unstar | `unstar` | star (deleted) | 仓库被 unstar |
| Fork | `fork` | fork | 仓库被 fork |
| Pull Request | `pr` / `pull_request` | pull_request | PR 创建/更新/合并 |

## 通知消息格式

### Push 事件
```
📦 zhinjs/zhin
🌿 username pushed to main

📝 3 commits:
  • abc1234 feat: add new feature
  • def5678 fix: resolve bug
  • ghi9012 docs: update README

🔗 https://github.com/zhinjs/zhin/tree/main
```

### Issue 事件
```
🐛 zhinjs/zhin
👤 username 打开了 issue #123

📌 Bug: Something is broken

🔗 https://github.com/zhinjs/zhin/issues/123
```

### Star 事件
```
⭐ zhinjs/zhin
👤 username starred the repository

🔗 https://github.com/zhinjs/zhin
```

### Fork 事件
```
🍴 zhinjs/zhin
👤 username forked to username/zhin

🔗 https://github.com/username/zhin
```

### Pull Request 事件
```
🔀 zhinjs/zhin
👤 username 打开了 PR #456

📌 feat: Add awesome feature

🔗 https://github.com/zhinjs/zhin/pull/456
```

## 权限控制

- **私聊**: 所有好友都可以订阅
- **群聊**: 仅群管理员可以订阅（需要适配器支持权限检查）

## 数据库结构

### github_subscriptions 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 主键 |
| repo | text | 仓库名 (owner/repo) |
| events | json | 订阅的事件列表 |
| target_id | text | 目标 ID（用户或群） |
| target_type | text | 类型 (private/group) |
| adapter | text | 适配器名称 |
| bot | text | 机器人名称 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### github_events 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 主键 |
| repo | text | 仓库名 |
| event_type | text | 事件类型 |
| payload | json | 事件载荷 |
| created_at | datetime | 创建时间 |

## API 端点

### POST /api/github/webhook

接收 GitHub Webhook 事件。

**Headers**:
- `X-GitHub-Event`: 事件类型
- `X-Hub-Signature-256`: 签名（如果配置了 secret）

**Body**: GitHub Webhook Payload (JSON)

**Response**:
```json
{
  "message": "OK",
  "notified": 3
}
```

## 开发

### 构建

```bash
pnpm build
```

### 测试

```bash
# 使用 ngrok 或其他工具暴露本地端口
ngrok http 8086

# 使用生成的 URL 配置 GitHub Webhook
# 例如: https://abc123.ngrok.io/api/github/webhook
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
