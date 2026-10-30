# @zhin.js/adapter-wechat-mp

Zhin.js 微信公众号适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能特性

- Webhook 事件接收（`httpHostToken` GET 验签 + POST 消息）
- 签名验证与可选 AES 加解密
- Access Token 自动刷新
- XML 消息解析
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-wechat-mp
```

## Plugin Runtime

`WeChatMpEndpoint` 的 Client 实际拥有 axios API、Token 与签名/加密 Webhook；原始 XML 保留。框架生命周期只经 `endpointSpec` 接入。所属 `Adapter` 是账号期望状态与运行实例的唯一管理者，目录按实际内部身份路由。

- `@zhin.js/adapter` — 约定式 `adapters/wechat-mp/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation: { endpoint, kind: 'private', id: openid }, message: { conversation, id }, content: text, sender, metadata })`

出站：`send({ conversation, payload })` → 被动回复 XML（默认）或客服消息 API（`replyMode: customer_service`）

## 前置条件

| 要求 | 说明 |
|------|------|
| **公众号** | 已注册微信公众号，并在 [微信公众平台](https://mp.weixin.qq.com/) 获取 `AppID`、`AppSecret` |
| **服务器配置** | 配置 Token（与 `token` 字段一致）；服务器 URL 须公网可访问 |
| **host-http** | **必需** — Runtime Host 提供 HTTP；适配器在 `path` 上注册 GET/POST |
| **响应时限** | 微信要求 **5 秒内**响应；超时会导致接入失败 |
| **回复模式** | 默认 `replyMode: passive`（订阅号被动回复）；服务号可设 `customer_service` |
| **消息加密** | 可选；`encrypt: true` + `encodingAESKey`；`encryptMode: compatible`（默认）或 `secure` |

必填字段（`endpoints[i]`）：`id`、`appId`、`appSecret`、`token`。运行时由 AdapterIndex
把实例级默认值与每个 endpoint 合并；协议实现只接收一份展开后的 endpoint 配置。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  wechat-mp: "@zhin.js/adapter-wechat-mp"
wechat-mp:
  path: /wechat/webhook
  endpoints:
    - id: my-wechat-bot
      appId: "${WECHAT_APP_ID}"
      appSecret: "${WECHAT_APP_SECRET}"
      token: "${WECHAT_TOKEN}"
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-wechat-mp`（`instanceKey: wechat-mp`）。
Runtime Host（`http`）须已 listen，Webhook 才可达。

### 可选字段

- `path`：Webhook 路径，默认 `/wechat/webhook`
- `replyMode`：`passive`（默认）| `customer_service`
- `passiveReplyTimeoutMs`：被动回复等待上限，默认 `4500`
- `encrypt` / `encodingAESKey` / `encryptMode`

## 微信公众号配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 在「开发 → 基本配置」中获取 `AppID` 和 `AppSecret`
3. 配置服务器地址（URL）：`https://your-server/wechat/webhook`（无 `/api` 前缀；经反向代理时自行映射）
4. 设置 Token（与配置文件中的 `token` 一致）
5. 如需消息加解密，设置 EncodingAESKey

## Console 页面

在所属插件的 Console 页面管理账号：查看配置与运行状态，添加、编辑、启动、停止、替换或删除账号。首次修改启动账号前，管理员需确认迁移清单；保留原身份与历史。此后保存到 Host 运行时存储，不改启动配置或 `.env`，无需重启进程。

新增仅保存，需手动启动；运行账号的普通配置更新只重连该账号。身份变化走明确替换，新账号不会继承旧 Session 或登录状态。账号凭据变化先按平台实际只读接口核验；平台无法核验时需明确替换。空白或遮蔽的密码不会覆盖既有密码。

读取需要 `wechat-mp:read`，写入需要 `wechat-mp:write`；首次迁移还需管理员身份。无持久化存储时管理操作不可用，提交结果未知时先刷新核实，不重复提交。

## 故障排查

| 现象 | 排查 |
|------|------|
| 服务器配置验证失败 | `token` 与公众平台一致；URL 为 `https://<host>/wechat/webhook`；Runtime Host 已 listen 且公网可达 |
| 收不到用户消息 | 公众号类型是否支持消息接口；用户是否已关注；`path` 与公众平台 URL 一致；endpoint 已 `open()` |
| 回复超时 / 无回复 | 默认被动回复须在 **~4.5s** 内完成；可改 `replyMode: customer_service`（需客服接口权限） |
| `48001 api unauthorized` | 未认证订阅号无客服 API；保持默认 `replyMode: passive` |
| 加密模式报错 | `encodingAESKey`、`encrypt` 与公众平台「安全模式」设置一致 |

## AI 工具

技能说明见 `skills/wechat-mp/SKILL.md`。

## 文档链接

- [微信公众号适配器文档](https://zhin.js.org/adapters/wechat-mp)
- [适配器概览](https://zhin.js.org/essentials/adapters)
- [微信公众平台](https://mp.weixin.qq.com/)

## 许可证

MIT License
