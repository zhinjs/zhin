# @zhin.js/adapter-weixin-ilink

通过微信 **iLink Endpoint API**（ClawBot 灰度入口）接入**个人微信**，支持文本与全量媒体收发、输入状态提示。

协议实现移植自 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT），已去除 OpenClaw 耦合，`bot_agent` 默认为 `Zhin.js/<version>`。

## 与 wechat-mp 的区别

| 项 | weixin-ilink | wechat-mp |
|---|---|---|
| 账号类型 | 个人微信（ClawBot） | 微信公众号 |
| 入站 | 长轮询 `getupdates` | Webhook 被动回复 |
| 登录 | 扫码 + 侧车凭证文件 | AppId/Secret/Token |
| 群聊 | 不支持（仅私聊） | 支持 |

可与 `@zhin.js/adapter-wechat-mp` **同时启用**。

## 前置条件

- 微信客户端需已灰度 **ClawBot** 入口（最新版微信 + 灰度资格）
- Node.js ^20.19.0 或 >=22.12.0
- 可选：`@zhin.js/host-router` + `@zhin.js/host-api` 用于 Web 控制台扫码登录

## 最小配置

```yaml
endpoints:
  - context: weixin-ilink
    name: my-wechat
    # botAgent: "Zhin.js/1.0.0"      # 可选，观测用
    # longPollTimeoutMs: 35000       # 可选
    # baseUrl: https://ilinkai.weixin.qq.com

plugins:
  - "@zhin.js/adapter-weixin-ilink"
  - "@zhin.js/host-router"   # 可选，Console + login-assist API
  - "@zhin.js/host-api"      # 可选
```

`zhin.config.yml` **只写 bot `name`**；`botToken` 保存在侧车文件（不进 git）：

```
data/weixin-ilink/<bot-name>.json
```

也可通过环境变量 `WEIXIN_ILINK_TOKEN` 或配置项 `botToken` 覆盖（CI 场景）。

## 登录流程

1. 首次启动无凭证时，bot 调用 `get_bot_qrcode` 并在控制台展示二维码（`loginAssist`）
2. 用户用微信扫码确认
3. 后台轮询 `get_qrcode_status` 直至 `confirmed`，写入 `data/weixin-ilink/<name>.json`
4. 调用 `notifyStart` 后进入长轮询

与 Host 同时启用时：

- Console 页面：`/weixin-ilink`（概览 + 登录辅助）
- HTTP API：`GET /api/login-assist/pending`、`POST /api/login-assist/submit`、`POST /api/login-assist/cancel`
- Endpoint 状态：`GET /api/weixin-ilink/endpoints`

## Typing Indicator

私聊使用 iLink `sendTyping` API，在微信侧显示**正在输入**（非文本消息、非 reaction）。长任务期间每 5s 保活一次（`keepaliveIntervalMs` 可配）。

```yaml
typingIndicator:
  enabled: true
  keepaliveIntervalMs: 5000
  privateConfig:
    type: typing
```

## 出站说明

回复必须携带入站时缓存的 `context_token`（按 `endpointId + peerUserId`）。若用户久未发消息导致 token 缺失，出站会拒绝并打 warn。

所有出站走标准链路：`Message.$reply` / `Adapter.sendMessage` → `before.sendMessage` → `endpoint.$sendMessage`。

**图文限制**：微信单条消息不支持图文混排。适配器会自动：
- **出站**：先单独发文本，再发纯媒体（不带 caption）
- **入站**：若同一条 iLink 消息同时含文字与媒体，拆成两条 `message.receive` 事件

## 故障排查

| 现象 | 可能原因 |
|---|---|
| 无法扫码 / 无 ClawBot 入口 | 未灰度；需最新微信 + 灰度资格 |
| 二维码过期 | 重启 Endpoint 重新获取 |
| 发不出消息 | 缺少 `context_token`；让用户先发一条消息 |
| `errcode -14` | 会话过期，适配器自动暂停 1 小时后重试 |
| Console 无待办 | 确认 `host-router` 已加载且访问 `/weixin-ilink` |

## 文档

- 架构与计划：仓库内 weixin-ilink 实现计划
- 适配器索引：[`plugins/adapters/README.md`](../README.md)
