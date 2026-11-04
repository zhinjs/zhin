---
title: "@zhin.js/adapter-wecom"
package: "@zhin.js/adapter-wecom"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/wecom/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/wecom/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=2faf5393dac43815 -->

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

`WecomEndpoint` 的 Client 实际拥有 Token/API HTTP 与加密 Webhook；原始 XML 保留。`agentId` 是独立必填应用身份，不以 secret 替代。所属 `Adapter` 是账号期望状态与运行实例的唯一管理者，目录按实际内部身份路由。

- `@zhin.js/adapter` — 约定式 `adapters/wecom/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation, message: { conversation, id: MsgId }, content: text, sender, metadata })`（`conversation` 为 `ConversationRef`，`@chatroom` → kind `group`，其余 → kind `private`）

出站：`send({ conversation, payload })` → 企业微信 `message/send` API

入站 `metadata.mentioned`：**未接线**。企业微信应用消息回调的 XML 事件不含 mentions/@ 字段，回调里的 `ToUserName` 是 CorpID（企业 ID）而非可比较的 bot 用户 id，配置中也没有 bot id/name 可作可靠判据，故无法可靠识别 @ 机器人。

## 前置条件

### 企业微信管理后台配置

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 「应用管理」→「自建」→ 创建应用，获取 **CorpId**、**AgentId**、**Secret**
3. 「接收消息」设置：
   - **URL**：`https://yourdomain.com/wecom/callback`
   - **Token** / **EncodingAESKey** 与配置一致
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`id`、`corpId`、`agentId`、`agentSecret`、`token`、`encodingAESKey`。
运行时由 AdapterIndex 把实例级默认值与每个 endpoint 合并；协议实现只接收一份展开后的
endpoint 配置。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  wecom: "@zhin.js/adapter-wecom"
wecom:
  webhookPath: /wecom/callback # 可选，默认 /wecom/callback
  apiBaseUrl: https://qyapi.weixin.qq.com # 可选
  endpoints:
    - id: wecom-bot
      corpId: ${WECOM_CORP_ID}
      agentId: "100001"
      agentSecret: ${WECOM_AGENT_SECRET}
      token: ${WECOM_TOKEN}
      encodingAESKey: ${WECOM_AES_KEY}
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-wecom`（`instanceKey: wecom`）。

## 环境变量

环境变量通过 `zhin.config.yml` 的 `${...}` 引用解析；适配器协议层不会直接读取它们。

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

## Console 页面

在所属插件的 Console 页面管理账号：查看配置与运行状态，添加、编辑、启动、停止、替换或删除账号。首次修改启动账号前，管理员需确认迁移清单；保留原身份与历史。此后保存到 Host 运行时存储，不改启动配置或 `.env`，无需重启进程。

新增仅保存，需手动启动；运行账号的普通配置更新只重连该账号。身份变化走明确替换，新账号不会继承旧 Session 或登录状态。账号凭据变化先按平台实际只读接口核验；平台无法核验时需明确替换。空白或遮蔽的密码不会覆盖既有密码。

读取需要 `wecom:read`，写入需要 `wecom:write`；首次迁移还需管理员身份。无持久化存储时管理操作不可用，提交结果未知时先刷新核实，不重复提交。

## 故障排查

| 现象 | 排查 |
|------|------|
| URL 验证失败 | `token` / `encodingAESKey` / `corpId` 与管理后台一致；Host 已 listen 且公网可达 |
| 收不到消息 | 应用已启用接收消息；可见范围包含发送者；endpoint 已 `open()` |
| 发送失败 | `corpId` + `agentSecret` 可换取 token；接收者在可见范围 |

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `PERMITS.md` |
| 平台工具（4 个） | `tools/` |
| 技能说明 | `agents/wecom/skills/wecom/SKILL.md` |

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 相关链接

- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [接收消息](https://developer.work.weixin.qq.com/document/path/90930)
- [发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)

## 许可证

MIT License
