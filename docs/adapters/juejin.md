---
title: "@zhin.js/adapter-juejin"
package: "@zhin.js/adapter-juejin"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/juejin/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/juejin/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=441bd9c4bcaa063a -->

# @zhin.js/adapter-juejin

> **Experimental** — 基于掘金 **非官方 Web 接口**，随时可能因平台改版失效；不进 stable smoke，接口与配置可能不兼容变更。**真实发送（回复评论）的请求在纯 HTTP 下未经实测验证**，见下方「人工验证清单」。

账号由 `JuejinAdapter` 管理。Endpoint 直接继承 `JuejinEndpoint`；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入。

Zhin.js 掘金评论适配器（Plugin Runtime）：让 AI 辅助回复**你自己的掘金文章**下的评论。契约见 [ADR 0035：评论型平台适配器契约](https://github.com/zhinjs/zhin/blob/main/docs/adr/0035-comment-reply-adapter-contract.md)，讨论见 [#971](https://github.com/zhinjs/zhin/issues/971)。

## 先读这几条

- **以你的账号身份操作**：掘金没有开放的评论读写 API，本适配器在发送时使用你的登录 Cookie。Cookie **只能经环境变量注入**（如 `cookie: ${JUEJIN_COOKIE}`），不会被写入数据目录。Cookie 等同于账号密码：**不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。不提供扫码登录。
- **默认先审再发**：`sendMode` 只有 `review`（默认）和 `off`。AI 写好的回复只进入草稿队列，**不会自动发到掘金**；只有你在 Console「掘金评论审批」页点「发送」，或 master 执行 `juejin-draft send <id>` 后才真正发出。不提供自动直发。
- **只回复评论，不发顶层评论**：出站只能回复白名单文章下已有的评论楼（或楼内回复），不会在文章下新开评论。
- **只管白名单文章**：只轮询 `articles` 里列出的文章（只填你自己的）；留空就不轮询。不做全站搜索、不去别人的评论区；请遵守掘金用户协议，禁止用于营销、引流、刷屏。
- **风控即熔断**：遇到频繁 / 验证码 / 风控 / 非 JSON 响应等情况，endpoint 立即停止轮询与发送，不自动重试；人工确认账号状态后重启。

## 当前能力

| 能力 | 状态 |
|---|---|
| 文章 id / `juejin.cn/post/<id>` 链接解析 | ✅ 已实现 |
| 轮询白名单文章最新评论（`interact_api/v1/comment/list`，公开接口，不需要 Cookie） | ✅ 已实现（只读，实测） |
| 一条评论楼 = 一个会话（`article:<文章id>:<根评论id>`） | ✅ 已实现 |
| 首轮只建基线，不把历史评论灌给 AI；按评论 id 去重 | ✅ 已实现 |
| 过滤自己的评论（登录 uid，或接口标记的作者本人） | ✅ 已实现 |
| AI 回复进入草稿队列（`review`） | ✅ 已实现 |
| 草稿持久化（重启不丢，发送中断会提示先确认） | ✅ 已实现（`data/juejin/<账号>/drafts.json`，权限 600） |
| master 审批后真正发出（`juejin-draft send` → `interact_api/v1/reply/publish`） | ⚠️ 已实现但**未实测**（带发送间隔与风控熔断，结果不明时不当作「未发送」） |
| 审批前改写 / 丢弃草稿（`juejin-draft edit` / `drop`） | ✅ 已实现 |
| Cookie 失效识别（`err_no 403 must login`） | ✅ 已实现 |
| Console「掘金评论审批」页：登录状态、白名单文章、待审草稿的发送 / 改写 / 丢弃 | ✅ 已实现 |
| 新草稿 / 登录失效主动推送给你（`notify`） | ✅ 已实现（可选） |
| 扫码登录 | ❌ 不提供（未能安全验证） |
| 消息中心「评论我的」通知 | ❌ 不提供 |

## 前置条件

1. 一个你自己的掘金账号，以及要管理的文章 id（`https://juejin.cn/post/<id>` 里的数字，建议只填自己的）
2. 只读轮询不需要登录。要发送回复时：浏览器登录 juejin.cn 后，从开发者工具 → Network 里任意 `api.juejin.cn` 请求的 `Cookie` 请求头复制整行，放进 `.env`（已被 gitignore）：`JUEJIN_COOKIE=...`
3. 数据目录 `data/` 不要提交到仓库
4. Cookie 会过期；失效时页面显示「登录已失效」、日志出现 `juejin_login_invalid`，更新环境变量后重启

必填字段（`endpoints[i]`）：`id`。

## 最小配置

```yaml
configVersion: 2
plugins:
  juejin: "@zhin.js/adapter-juejin"
juejin:
  sendMode: review          # 默认；off = 完全禁止出站。不支持 auto
  pollIntervalSec: 60       # 最小 60
  minSendIntervalSec: 30    # 审批后两次真实发送的最小间隔，最小 10
  notify:                   # 可选：新草稿 / 登录失效时提醒你
    adapter: icqq
    endpoint: my-qq
    id: "10001"
  endpoints:
    - id: my-juejin
      cookie: ${JUEJIN_COOKIE}   # 只用环境变量；不要写明文
      articles:
        - "7129482663794049032"  # 一定加引号：文章 id 超过 JS 安全整数
```

### Console「掘金评论审批」页

装了 Console 时，导航里会出现「掘金评论审批」。页面上可以看登录状态（并「重新检查登录」）、看待审回复（原评论 + 拟回复）并点「发送」「修改」「丢弃」，以及看正在管理的文章（只读）。

| 权限 | 允许 |
|---|---|
| `juejin:read` | 打开页面、看状态和草稿 |
| `juejin:review` | 发送 / 改写 / 丢弃草稿 |
| `juejin:login` | 重新检查登录 |

审批命令只认 master 角色（在你平时和机器人聊天的适配器配置里设置 `master`）。

## 会话与消息

- `conversation.kind = 'channel'`，`id = article:<文章id>:<根评论id>`，`parent = article:<文章id>`
- `message.id` = 评论 id 或回复 id；`sender` = 作者 uid / 昵称
- `metadata`：`resource`（`articleId` / `url`）、`rootId`、`parentId`、`createdAt`、`likeCount`、`isAuthor`
- 楼内回复带 `replyTo`

## 出站

`send({ conversation, payload })` 只接受评论楼会话，正文只保留纯文本（≤1000 字）。它**永远**只把回复放入 `endpoint.drafts`，并以 `EndpointDeliveryError('approval_pending', …, 'not_sent')` 告知调用方「未发送、待审批」。payload 里带 `reply` 段（且是同一楼里已知的回复 id）时回复那条楼内回复，否则回复楼主。

### 审批草稿

| 命令 | 作用 |
|---|---|
| `juejin-draft list` | 列出待审草稿 |
| `juejin-draft show <id>` | 看一条草稿全文 |
| `juejin-draft edit <id> <新内容>` | 改写草稿，改完仍需 `send` |
| `juejin-draft send <id>` | 审批并发出，成功后返回文章链接 |
| `juejin-draft drop <id>` | 丢弃草稿，不发送 |
| `juejin-login status` | 查看登录状态与待审数量 |

发送保护：`sendMode: off`、已熔断、没有 Cookie 或登录失效、文章已不在白名单、距上次发送不足 `minSendIntervalSec` 时直接拒绝（草稿保留，不自动重试）。发送请求的响应无法解析（空响应、非 JSON、网络中断）时，草稿标记「可能已经发出」并保留，**不会自动重发**；请先到掘金确认。进程在发送中退出的草稿重启后同样标记。

程序里也可以直接调用 `endpoint.approveDraft(id)` / `editDraft(id, text)` / `discardDraft(id)` / `recheckLogin()`。

### 风控与熔断

掘金没有公开的错误码表。以下情况会熔断（停止轮询与发送，日志 `juejin_circuit_open`）：

| 触发 | 说明 |
|---|---|
| HTTP 403 / 429 | 被拦截或限流 |
| 非 JSON 响应（内部 code `-2`） | 通常是验证页 / 风控页 |
| `err_msg` 含「频繁 / 过快 / 太快 / 风控 / 验证码 / 人机 / 安全验证」或 captcha / verify / too many / too frequent / rate limit | 平台限频或人机验证 |
| 登录账号 uid 变化（内部 code `-3`） | Cookie 换了人，需要重启 |

`err_no: 403`（`must login`）按登录失效处理，不熔断。

## 已知限制

- 非官方接口，掘金改版后可能直接失效
- 只轮询每篇文章第一页（最新 20 条评论）；两次轮询间超过 20 条新评论会漏
- 评论列表只附带每条评论**最早的 2 条**回复；之后的新楼内回复不会入站（`reply/list` 接口未能验证，不使用）
- 已见评论 id 只在内存里，重启后重新建基线
- 发送请求体来自社区实现（[androidZzT/juejin-mcp](https://github.com/androidZzT/juejin-mcp) 在无头浏览器内调用），**纯 HTTP 调用可能需要额外的反爬签名**，未经实测
- 不提供扫码登录、不做 Cookie 续期

## 人工验证清单

首次在真实账号上使用发送前，请用一篇自己的测试文章逐项确认：

1. 只配置轮询（不配 `cookie`），确认首轮只建基线、新评论能入站、自己的评论被过滤
2. 配置 `cookie: ${JUEJIN_COOKIE}`，在 Console 点「重新检查登录」，确认显示正确昵称 / uid
3. 让 AI 生成一条草稿，确认掘金上**没有**出现任何回复
4. 在自己的测试评论楼上 `juejin-draft send <id>` 一次，到掘金网页确认回复出现在正确的评论楼下（不是顶层评论）
5. 若发送返回「结果不明」或熔断：不要重试，到网页确认后在 issue 里附上脱敏后的日志

## 故障排查

| 现象 | 处理 |
|---|---|
| 日志 `juejin_circuit_open` | 触发风控熔断。去网页端确认账号状态、必要时完成验证，调大 `pollIntervalSec` 后重启 |
| 日志 `juejin_login_invalid` / 页面「登录已失效」 | Cookie 失效，更新 `JUEJIN_COOKIE` 后重启 |
| 日志 `juejin_no_articles` | 没配 `articles`，不会轮询任何内容 |
| AI 回复没出现在掘金 | 预期行为：只生成草稿（`juejin_draft_queued`），需要审批 |
| 发送提示结果不明 | 草稿已标记「可能已经发出」，先到掘金确认，不要直接重发 |
| 日志 `juejin_notify_failed` | `notify` 指向的会话发不出去 |
| 日志 `juejin_draft_persist_failed` | 数据目录不可写；草稿仍在内存里 |
