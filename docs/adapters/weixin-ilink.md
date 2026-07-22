---
title: "@zhin.js/adapter-weixin-ilink"
package: "@zhin.js/adapter-weixin-ilink"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/weixin-ilink/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/weixin-ilink/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=36c986830b317252 -->

# @zhin.js/adapter-weixin-ilink

通过微信 **iLink Endpoint API**（ClawBot 灰度入口）接入**个人微信**，支持文本与全量媒体收发。Plugin Runtime 约定式 `defineAdapter`（长轮询入站，无 host-router / Koa）。

协议实现移植自 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT），已去除 OpenClaw 耦合，`bot_agent` 默认为 `Zhin.js/<version>`。

## 与 wechat-mp 的区别

| 项 | weixin-ilink | wechat-mp |
|---|---|---|
| 账号类型 | 个人微信（ClawBot） | 微信公众号 |
| 入站 | 长轮询 `getupdates` → `messageGatewayToken` | Webhook（`httpHostToken`） |
| 登录 | 扫码 / 侧车凭证 / `botToken` | AppId/Secret/Token |
| 群聊 | 不支持（仅私聊） | 支持 |

可与 `@zhin.js/adapter-wechat-mp` **同时启用**。

## 前置条件

- 微信客户端需已灰度 **ClawBot** 入口（最新版微信 + 灰度资格）
- Node.js ^20.19.0 或 >=22.12.0

## 最小配置

```yaml
plugins:
  weixin-ilink:
    # botAgent: "Zhin.js/1.0.0"
    # longPollTimeoutMs: 35000
    # baseUrl: https://ilinkai.weixin.qq.com
    endpoints:
      - name: my-wechat
        # botToken: "..."                 # 或环境变量 WEIXIN_ILINK_TOKEN
```

`botToken` 也可保存在侧车文件（不进 git）：

```
data/weixin-ilink/<bot-name>.json
```

## 登录流程

1. 首次启动无凭证时，调用 `get_bot_qrcode` 并在日志中打印二维码内容
2. 用户用微信扫码确认
3. 后台轮询 `get_qrcode_status` 直至 `confirmed`，写入 `data/weixin-ilink/<name>.json`
4. 调用 `notifyStart` 后进入长轮询

> Console 扫码面板（旧 `loginAssist` + host-router）已从生产路径移除；优先用 `botToken` / 侧车凭证。

## 出站说明

回复必须携带入站时缓存的 `context_token`（按 `endpointId + peerUserId`）。若用户久未发消息导致 token 缺失，出站会拒绝并打 warn。

出站经 Runtime：`MessageGateway` → `endpoint.send({ target, payload })`。

**图文限制**：微信单条消息不支持图文混排。适配器会自动：

- **出站**：先单独发文本，再发纯媒体（不带 caption）
- **入站**：文字与媒体路径写入同一条 gateway `content` 文本

## 故障排查

| 现象 | 可能原因 |
|---|---|
| 无法扫码 / 无 ClawBot 入口 | 未灰度；需最新微信 + 灰度资格 |
| 二维码过期 | 重启适配器重新获取 |
| 发不出消息 | 缺少 `context_token`；让用户先发一条消息 |
| `errcode -14` | 会话过期，适配器自动暂停 1 小时后重试 |

## 文档

- 适配器索引：[`plugins/adapters/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/weixin-ilink/README.md)
- 原位迁移：[`docs/architecture/target-implementation/in-place-migration.md`](https://github.com/zhinjs/zhin/tree/main/plugins/docs/architecture/target-implementation/in-place-migration.md)
