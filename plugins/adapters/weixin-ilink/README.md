# @zhin.js/adapter-weixin-ilink

通过微信 **iLink Endpoint API**（ClawBot 灰度入口）接入**个人微信**，支持文本与全量媒体收发。Plugin Runtime 约定式 `defineAdapter`（长轮询入站，无 host-router / Koa）。

协议实现移植自 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT），已去除 OpenClaw 耦合，`bot_agent` 默认为 `Zhin.js/<version>`。

## 与 wechat-mp 的区别

| 项 | weixin-ilink | wechat-mp |
|---|---|---|
| 账号类型 | 个人微信（ClawBot） | 微信公众号 |
| 入站 | 长轮询 `getupdates` → `endpointSpec.events` | Webhook（`httpHostToken`） |
| 登录 | 扫码 / 侧车凭证 / `botToken` | AppId/Secret/Token |
| 群聊 | 不支持（仅私聊） | 支持 |

可与 `@zhin.js/adapter-wechat-mp` **同时启用**。

## 前置条件

- 微信客户端需已灰度 **ClawBot** 入口（最新版微信 + 灰度资格）
- Node.js >=22.19.0

## 最小配置

```yaml
configVersion: 2
plugins:
  weixin-ilink: "@zhin.js/adapter-weixin-ilink"
weixin-ilink:
  # botAgent: "Zhin.js/1.0.0"
  # longPollTimeoutMs: 35000
  # baseUrl: https://ilinkai.weixin.qq.com
  # dataDir: data/weixin-ilink
  endpoints:
    - id: my-wechat
      # botToken: "..."                 # 可选；不填则读取状态文件或扫码
```

`AdapterIndex` 会把实例默认值与 endpoint 覆盖值合并后再调用 adapter。协议层只接受这份
展开后的 endpoint 配置，不读取环境变量，也不再次解析嵌套 `endpoints`。

Endpoint 通过一个 `WeixinIlinkStateStore` 统一拥有凭据、长轮询 cursor、context token 和媒体文件。
`botToken` 也可保存在 `dataDir` 下的状态文件（不进 git）：

```
data/weixin-ilink/<id>/credentials.json
```

## 登录流程

1. 首次启动无凭证时，调用 `get_bot_qrcode` 并在日志中打印二维码内容
2. 用户用微信扫码确认
3. 后台轮询 `get_qrcode_status` 直至 `confirmed`，写入 `dataDir/<id>/credentials.json`
4. 调用 `notifyStart` 后进入长轮询

> Console 扫码面板（旧 `loginAssist` + host-router）已从生产路径移除；优先用 `botToken` / Endpoint 状态凭证。

## 出站说明

回复必须携带入站时缓存的 `context_token`（按 `endpointId + peerUserId`）。若用户久未发消息导致 token 缺失，出站会拒绝并打 warn。

出站经 Runtime：`OutboundMessageService` → `createEndpointSpecification` 注册的 send 钩子（`conversation` 为入站归一化出的 `ConversationRef`，kind 恒为 `private`，`id` 即对端 user_id）。

**图文限制**：微信单条消息不支持图文混排。适配器会自动：

- **出站**：先单独发文本，再发纯媒体（不带 caption）
- **入站**：文字与媒体路径写入同一条 gateway `content` 文本

## Console 页面

在所属插件的 Console 页面管理账号：查看配置与运行状态，添加、编辑、启动、停止、替换或删除账号。首次修改启动账号前，管理员需确认迁移清单；保留原身份与历史。此后保存到 Host 运行时存储，不改启动配置或 `.env`，无需重启进程。

新增仅保存，需手动启动；运行账号的普通配置更新只重连该账号。身份变化走明确替换，新账号不会继承旧 Session 或登录状态。账号凭据变化先按平台实际只读接口核验；平台无法核验时需明确替换。空白或遮蔽的密码不会覆盖既有密码。

读取需要 `weixin-ilink:read`，写入需要 `weixin-ilink:write`；首次迁移还需管理员身份。无持久化存储时管理操作不可用，提交结果未知时先刷新核实，不重复提交。

未提供 `botToken` 时，启动沿既有凭据文件或日志二维码登录流程；本平台当前没有 Console 二维码待办。新账号的状态目录按内部实例身份隔离。

## 故障排查

| 现象 | 可能原因 |
|---|---|
| 无法扫码 / 无 ClawBot 入口 | 未灰度；需最新微信 + 灰度资格 |
| 二维码过期 | 重启适配器重新获取 |
| 发不出消息 | 缺少 `context_token`；让用户先发一条消息 |
| `errcode -14` | 会话过期，适配器自动暂停 1 小时后重试 |

## 文档

- 适配器索引：[`plugins/adapters/README.md`](../README.md)
