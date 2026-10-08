---
title: "@zhin.js/adapter-dingtalk"
package: "@zhin.js/adapter-dingtalk"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/dingtalk/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/dingtalk/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=5459ab2dcb19f26c -->

# @zhin.js/adapter-dingtalk

Zhin.js 钉钉适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + HMAC-SHA256 签名验证）
- Access Token 自动刷新
- Session Webhook 优先回复 / `/robot/send` 主动发送
- canonical `markdown` 段编码为钉钉原生 `msgtype: markdown`
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-dingtalk
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式薄入口 `adapters/dingtalk/index.ts`（`defineAdapter`）
- 实现：`src/endpoint.ts`（生命周期/出站/OpenAPI）、`src/webhook.ts`（验签入站）、`src/protocol.ts`
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation: ConversationRef, message: { conversation, id }, content: text, sender, metadata })`  
出站：`send({ conversation, payload })` → sessionWebhook 或 `/robot/send`

## 前置条件

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 创建企业内部应用 / 机器人
2. 获取 **AppKey**、**AppSecret**（可选 RobotCode）
3. 设置消息接收 URL 为 `https://your-domain/dingtalk/webhook`
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`id`、`appKey`、`appSecret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  dingtalk:
    apiBaseUrl: https://oapi.dingtalk.com # 可选，顶层共享
    endpoints:
      - id: my-dingtalk-bot
        appKey: ${DINGTALK_APP_KEY}
        appSecret: ${DINGTALK_APP_SECRET}
        robotCode: ${DINGTALK_ROBOT_CODE}
        webhookPath: /dingtalk/webhook   # 可选，默认 /dingtalk/webhook
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-dingtalk`（`instanceKey: dingtalk`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DINGTALK_APP_KEY` | 示例中由 YAML `${DINGTALK_APP_KEY}` 引用的 AppKey；变量名可自行定义 |
| `DINGTALK_APP_SECRET` | 示例中由 YAML `${DINGTALK_APP_SECRET}` 引用的 AppSecret；变量名可自行定义 |
| `DINGTALK_ROBOT_CODE` | 示例中由 YAML `${DINGTALK_ROBOT_CODE}` 引用的 RobotCode；变量名可自行定义 |

## 消息类型映射

| 钉钉类型 | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | text |
| picture | `[image]` | Markdown 图片链接（canonical HTTP(S) `url`） |
| file | `[file: name]` | — |
| audio / video | `[audio]` / `[video]` | — |
| markdown | 原文或 `[markdown]` | markdown |
| link | — | link |

### Stream 进阶验收边界

Stream 只承载入站事件，回复仍向本次入站的 `sessionWebhook` 发送 HTTP 请求。当前支持文本、Markdown 和可公网访问的图片 URL；图文组合通过 Markdown 保留文本与图片，图片能否实际显示必须由接收端确认。官方依据：[Stream Markdown 回复](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/nodejs/send-markdown/)、[Markdown 图片说明](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/faq/)。

canonical `reply` 原生引用、本地/base64 图片上传、音频/视频/文件目前未实现，请求前返回 `unsupported_operation`，不会发送 `[reply]` 或只发送剩余文字。撤回没有 Endpoint control 端口，属于 `unsupported`；不会自动申请上传或撤回 API 权限。远程图片是 Markdown 内嵌显示，不能据此宣称原生图片消息已验收。

发送需有效的入站会话：缓存尊重 `sessionWebhookExpiredTime`，缺少过期时间时最多保留 5 分钟，最多保存 1024 个会话。Stream 缺少或过期会话时在请求前返回 `session_unavailable`，不自动改走其他 API 或重放。请求发出后的断网、超时或响应缺少真实 `msgId` 仍是 `unknown`，不代表消息未送达；需要人工核对接收端，不能伪造 ID 或自动再次发送。

## Agent 工具

`agents/dingtalk/skills/dingtalk/tools/` 在 DingTalk Skill 激活后提供 get_user、部门、群聊、工作通知等 Tool。工具声明 `adapter: 'dingtalk'` 后，通过惰性的 `context.$client` 自动取得当前操作的 `DingTalkClient`；无需把 Endpoint id 暴露给模型。

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 测试

```bash
pnpm --filter @zhin.js/adapter-dingtalk build
pnpm --filter @zhin.js/adapter-dingtalk test
```

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 平台校验 URL 失败 | 确认公网 HTTPS 可达，HTTP Host 已监听，路径与 `webhookPath` 一致 |
| Webhook 返回 401/403 | 检查 `appSecret`、签名时间戳与服务器时钟 |
| 能收到但无法回复 | 检查 `robotCode`、应用权限与 session webhook 是否有效 |
| Endpoint 未出现 | 在日志查 Schema 或凭据错误，再到运行时能力核对 Endpoint |

## Stream 长连接

端点设置 `mode: stream`（默认 `webhook` 保持 HTTP 回调），使用现有 `appKey` / `appSecret`。钉钉后台创建企业内部应用、启用机器人并选择 Stream 模式，发布后加入测试群；无需公网回调地址。

```yaml
endpoints:
  - id: test-bot
    mode: stream
    appKey: ${DINGTALK_APP_KEY}
    appSecret: ${DINGTALK_APP_SECRET}
```

连接通过官方网关获取 WSS 地址和临时 ticket，WSS 握手成功后报告 open（与官方 SDK 一致，不要求可选 REGISTERED 帧）。连接失败会拒绝启动；断线由框架统一退避重连，stop 取消网关请求及 socket，防止迟到连接复活。机器人 CALLBACK 在入站链路成功后 ACK；失败或尚未 open 不 ACK，等待服务端重投。连接内缓存五分钟、最多一万条回调 ID 去重；跨进程业务幂等需要应用持久化处理。HTTP 和 Stream 共用消息归一化及统一出站链路。

协议依据：[钉钉官方 Stream SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)。本适配器直接实现该网关协议，使用共享 EndpointLifecycle 管理重连和心跳。当前新增模式已经过本地注入传输回归，真实租户验收仍需实际应用验证。


canonical `share` 编码为原生 `link` 卡片，映射 `url/title/description/image` 到 `messageUrl/title/text/picUrl`。必须实测卡片展示和链接点击；单次消息只支持一个链接卡片。

钉钉原生按钮通过配置关联应用的互动卡片模板实现，使用 Stream 卡片回调；传统 `actionCard` URL 导航不作为按钮业务回调。固定模板字段、数量配置、权限、会话/actor 校验及重启边界见 [模板配置指南](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/dingtalk/CARD-TEMPLATE.md)。未配置模板时返回 `card_template_required`，而不是声明平台不支持。
# Stream 可控断线验收

可选 `streamProxy: { port: 18443, serverName: "实际网关域名" }` 只将 WSS 的 TCP 连接转发到 `127.0.0.1:18443`。原始 HTTPS discovery 仍直连；真实 WSS URL、HTTP Host、ticket、TLS SNI 与证书校验保持原值，不修改系统网络，也不需要账号 B。此入口使用 [ws 的 createConnection 契约](https://github.com/websockets/ws/blob/master/doc/ws.md)，不关闭 TLS 校验。网关主机变化时明确拒绝连接，只记录安全 hostname，绝不回退直连或输出 ticket。

先通过临时启动配置加 `streamProxy`，若未知网关域名，可先填写占位域名；拒绝日志只显示实际 hostname。使用该域名启动 `scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host 实际网关域名 --upstream-port 443 --port 18443 --control-port 18444`，将 serverName 同步设为此域名。不要覆盖用户已有 `.env`。恢复正常验收后移除临时配置并停止代理。

正常收发后 `POST http://127.0.0.1:18444/cut`；现有 WSS 立即关闭，Endpoint 的 `transportState` 经统一 lifecycle 进入重连，期间健康记录不能认定在线。`POST /recover` 后仅允许新建连接；需观察重新 `open`，再发送新的唯一 probe，验证入站及可见回包。Stream 入站恢复与 sessionWebhook 出站恢复是不同链路：该代理仅切断 WSS，HTTP 发送未被切断；不能把这次试验记为所有平台网络故障、发送重试或离线消息无损验收。网关域名变化需停止验收并更新固定上游，不能绕代理继续取通过证据。
