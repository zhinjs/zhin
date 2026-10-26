---
title: "@zhin.js/adapter-bilibili"
package: "@zhin.js/adapter-bilibili"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/bilibili/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/bilibili/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=8e234a00fd9ec03a -->

# @zhin.js/adapter-bilibili

> **Experimental** — 基于 B 站 **非官方 Web 接口**，随时可能因平台改版失效；不进 stable smoke，接口与配置可能不兼容变更。

Zhin.js Bilibili 评论适配器（Plugin Runtime）：让 AI 辅助回复**你自己视频**下的评论。契约见 [ADR 0035：评论型平台适配器契约](https://github.com/zhinjs/zhin/blob/main/docs/adr/0035-comment-reply-adapter-contract.md)，讨论见 [#971](https://github.com/zhinjs/zhin/issues/971)。

## 先读这几条

- **以你的账号身份操作**：B 站开放平台没有评论读写权限，本适配器使用你的登录 Cookie（`SESSDATA` + `bili_jct`）。Cookie 等同于账号密码，只能用环境变量 / 密钥存储注入，**不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。
- **默认先审再发**：`sendMode` 默认 `review`，AI 写好的回复只进入草稿队列，**不会自动发到 B 站**。v1 不提供自动直发。
- **只管白名单视频**：只轮询 `videos` 里列出的视频（建议只填自己的稿件）。不做全站搜索、不去别人的评论区刷评论；请遵守 B 站用户协议，禁止用于营销、引流、刷屏。
- **风控即熔断**：遇到频繁 / 验证码 / 风控拦截 / 重复评论等错误码，endpoint 立即停止轮询并记录错误，不自动重试；人工确认账号状态后重启。

## 当前能力（v1 骨架）

| 能力 | 状态 |
|---|---|
| BV 号 → aid 解析 | ✅ 已实现 |
| 轮询白名单视频最新评论（`x/v2/reply`，仅视频 `type=1`） | ✅ 已实现（只读） |
| Cookie 登录态识别自身 uid、过滤自己的评论 | ✅ 已实现 |
| 一条评论楼 = 一个会话（`video:<aid>:<根评论rpid>`） | ✅ 已实现 |
| 首轮只建基线，不把历史评论灌给 AI | ✅ 已实现 |
| AI 回复进入草稿队列（`review`） | ✅ 已实现（进程内存，重启即丢） |
| 审批后真正发出（`x/v2/reply/add`） | 🚧 客户端方法已备，**未接线** |
| 「回复我的 / @我的」通知（`x/msgfeed/*`） | 🚧 未实现 |
| 扫码登录 / Cookie 持久化 | 🚧 未实现 |
| 动态 / 专栏评论 | 🚧 v1.1 |

## 前置条件

1. 一个你自己的 B 站账号，以及要管理的视频 BV 号（建议只填自己的稿件）
2. 浏览器登录 bilibili.com 后，从开发者工具 → Application → Cookies 取 `SESSDATA` 与 `bili_jct`
3. 把它们放进环境变量（如 `.env` 且 `.env` 已被 gitignore）：`BILIBILI_SESSDATA`、`BILIBILI_BILI_JCT`
4. Cookie 会过期；失效时日志出现 `bilibili_login_invalid`，重新获取即可

必填字段（`endpoints[i]`）：`id`。只读公开评论可不填 Cookie。

## 最小配置

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/adapter-bilibili"
bilibili:
  sendMode: review          # 默认；off = 完全禁止出站
  pollIntervalSec: 60       # 最小 60
  endpoints:
    - id: my-bilibili
      sessdata: ${BILIBILI_SESSDATA}
      biliJct: ${BILIBILI_BILI_JCT}
      videos:
        - BV1xx411c7mD       # 只填你自己的视频
```

不填 Cookie 也能只读轮询公开评论，但无法识别自己的账号（无法过滤自回环），也无法在后续版本中发送。

## 会话与消息

- `conversation.kind = 'channel'`，`id = video:<aid>:<根评论rpid>`，`parent = video:<aid>`
- `message.id` = 评论 `rpid`
- `sender` = 评论作者 uid / 昵称
- `metadata`：`resource`、`rootId`、`parentId`、`createdAt`、`likeCount`、`isUploader`

群聊式触发规则同样适用：评论楼是共享会话，默认需 @ / 前缀才触发 AI。

## 出站

`send({ conversation, payload })` 只接受评论楼会话，正文只保留纯文本（≤1000 字）。在 `review` 模式下它把回复放入 `endpoint.drafts`，并以 `EndpointDeliveryError('approval_pending', …, 'not_sent')` 告知调用方「未发送、待审批」。

## 已知限制

- 非官方接口，B 站改签名 / 字段后可能直接失效
- 只轮询每个视频评论第一页（按时间倒序 20 条）；高峰期两次轮询间超过 20 条新评论会漏
- 已见评论 id 与草稿只存在进程内存，重启后重新建基线、草稿丢失
- 只支持视频评论（`type=1`）

## 故障排查

| 现象 | 处理 |
|---|---|
| 日志 `bilibili_circuit_open` | 触发了风控（频繁 / 验证码 / 拦截 / 重复评论）。轮询已停止：去网页端确认账号状态、必要时完成验证，调大 `pollIntervalSec` 后重启 |
| 日志 `bilibili_login_invalid` | `SESSDATA` 失效，重新登录获取 Cookie |
| 日志 `bilibili_no_videos` | 没配 `videos`，适配器不会轮询任何内容 |
| AI 回复没出现在 B 站 | 预期行为：默认 `review` 模式只生成草稿（`bilibili_draft_queued`），v1 不会自动发出 |
