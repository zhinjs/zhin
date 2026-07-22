# @zhin.js/adapter-wecom

Zhin.js 企业微信（WeCom）适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` GET 验签解密 + POST 消息）
- AES-256-CBC 消息加解密与 SHA1 签名验证
- Access Token 自动刷新
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-wecom
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/wecom.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: FromUserName, content: text, sender, metadata })`  
出站：`send({ target, payload })` → 企业微信 `message/send` API

入站 `metadata.mentioned`：**未接线**。企业微信应用消息回调的 XML 事件不含 mentions/@ 字段，回调里的 `ToUserName` 是 CorpID（企业 ID）而非可比较的 bot 用户 id，配置中也没有 bot id/name 可作可靠判据，故无法可靠识别 @ 机器人。

## 前置条件

### 企业微信管理后台配置

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 「应用管理」→「自建」→ 创建应用，获取 **CorpId**、**AgentId**、**Secret**
3. 「接收消息」设置：
   - **URL**：`https://yourdomain.com/wecom/callback`
   - **Token** / **EncodingAESKey** 与配置一致
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`name`、`corpId`、`agentSecret`、`token`、`encodingAESKey`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  wecom:
    webhookPath: /wecom/callback       # 可选，默认 /wecom/callback
    apiBaseUrl: https://qyapi.weixin.qq.com  # 可选
    endpoints:
      - name: wecom-bot
        corpId: ${WECOM_CORP_ID}
        agentSecret: ${WECOM_AGENT_SECRET}
        token: ${WECOM_TOKEN}
        encodingAESKey: ${WECOM_AES_KEY}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-wecom`（`instanceKey: wecom`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `WECOM_CORP_ID` | 企业 ID |
| `WECOM_AGENT_SECRET` | 应用 Secret |
| `WECOM_TOKEN` | 回调签名 Token |
| `WECOM_AES_KEY` | EncodingAESKey（43 字符） |

## 消息类型支持

| 入站类型 | content 摘要 |
|----------|--------------|
| text | 原文 |
| image | `[image: url]` |
| voice | 识别结果或 `[voice]` |
| video / shortvideo | `[video]` |
| location | `[位置] …` |
| link | `[link: …]` |
| event | `[事件] …` |

| 出站 wire | 说明 |
|-----------|------|
| text | 支持 `<@userid>` |
| image | 需 `media_id` |
| markdown | 企业微信原生 Markdown |
| news | link 段映射 |

## 安全说明

企业微信回调始终加密：

- **签名**：SHA1 排序拼接 `[token, timestamp, nonce, encrypt]`
- **解密**：AES-256-CBC（Key = `encodingAESKey` + `=` 的 Base64，IV = Key 前 16 字节）

Access Token 在过期前 5 分钟自动刷新。

## 故障排查

| 现象 | 排查 |
|------|------|
| URL 验证失败 | `token` / `encodingAESKey` / `corpId` 与管理后台一致；Host 已 listen 且公网可达 |
| 收不到消息 | 应用已启用接收消息；可见范围包含发送者；endpoint 已 `open()` |
| 发送失败 | `corpId` + `agentSecret` 可换取 token；接收者在可见范围 |

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具（4 个） | `agent/tools/` |
| 技能说明 | `agent/skills/wecom.md` |

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 相关链接

- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [接收消息](https://developer.work.weixin.qq.com/document/path/90930)
- [发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)

## 许可证

MIT License
