---
sidebar: false
---

# ADR 0035：评论型平台适配器契约（Bilibili 先行）

状态：Accepted（Experimental 实现）

关联：[#971](https://github.com/zhinjs/zhin/issues/971)

## 背景

掘金、Bilibili、抖音这类内容平台的交互不是 IM 会话，而是「内容下的评论 + 楼中楼回复」。用户希望 AI 辅助回复自己内容下的评论，但这些平台普遍没有官方评论开放接口，且对自动化回复有严格的风控与用户协议约束。

现有 `plugins/adapters/github` 已经证明「评论流」可以直接复用 `Endpoint` 契约：评论进 `message.receive`，`send` 即回复评论。本 ADR 把评论型平台的共同约定固化下来，避免每个平台各造一套。

## 决策

### 1. 不新开通道，沿用 `message.receive` / `send`

评论型 adapter 仍继承 `Endpoint`，只在语义上约定：

| 项 | 约定 |
|---|---|
| conversation | **一条评论楼 = 一个 conversation**（不是整条稿件）。`kind = 'channel'`，`id = <资源类型>:<资源id>:<根评论id>`，`parent = { kind: 'channel', id: <资源类型>:<资源id> }` |
| message.id | 平台评论 id（B 站 `rpid`），原样字符串，不拼接 |
| sender | 评论作者平台 uid；`displayName` 为昵称 |
| metadata | `resource`（type/oid/bvid）、`rootId`、`parentId`、`createdAt`、`likeCount`、`isUploader` 等平台事实 |
| send | **只能回复已有评论楼**：从 conversation 反解 `oid` / `root`，不允许凭空发一级评论 |
| identity | 登录后 `reportSelfUserId(uid)`；过滤 bot 自己的评论防自回环；同一评论 id 只入站一次 |

### 2. 作用范围必须显式白名单

配置必须列出要管理的资源（B 站为 BV 号 / av 号）。adapter **不做全站搜索、不主动去别人的评论区**。空白名单 = 不轮询。

### 3. 默认「先审再发」

`sendMode` 默认 `review`：AI 生成的回复只进入草稿队列，`send` 返回 `EndpointDeliveryError('approval_pending', …, 'not_sent')`，**`send` 永远不调用平台写接口**。

真正发出必须由人审批：adapter 插件提供仅 master 可用的 `bili-draft list|show|edit|send|drop` 命令（可在任意已接入的聊天平台里执行），`send` 调用 `endpoint.approveDraft(id)` 后才走平台写接口。审批发送同样受保护：已熔断、缺凭据、`sendMode: off`、距上次发送不足最小间隔（默认 30s）时直接拒绝，草稿保留，不排队、不自动重试；发送遇风控码熔断整个 endpoint。

自动直发（`auto`）不在 v1 范围。插件同时提供 Console「评论审批」页（与「群聊插话」同类的普通人页面，动作走插件 RPC 并各自声明权限），新草稿可经 `OutboundHost` 主动推送到配置的聊天会话（`notify`）。草稿落盘到本地数据目录，重启不丢；发送中被打断的草稿恢复为待审并标记「可能已发出」。接入 `ApprovalPort` 留作后续。

`sendMode: off` 完全禁止出站。

### 4. 保守限流与风控熔断

- 入站轮询默认 ≥ 60s，带随机抖动；单次只拉第一页最新评论。
- 平台返回风控类错误码（B 站 `-352`、`-412`、`-509`、`12015`、`12051` 等）时立即**熔断**：停止该 endpoint 的轮询并记录错误，不自动重试，需人工处理后重启。
- 首轮轮询只建立基线（记录已有评论 id），不把历史评论当新消息灌入 Agent。

### 5. 凭据

- 非官方接口只能走 Web 登录态 Cookie（B 站 `SESSDATA` + `bili_jct`/csrf）。
- Cookie 不写入仓库、YAML、日志；README 必须明确「这是以你的账号身份操作」。
- 两种来源：环境变量 / 密钥存储注入（有效时优先），或扫码登录（`passport.bilibili.com` Web 扫码接口，Experimental）后落到本地数据目录（`<dataDir>/<endpoint>/credentials.json`，权限 600）。二维码只在本机渲染、只在 Console 页或私聊里展示。
- 平台判定未登录（`-101`）时清除失效的扫码凭据、登录态置为失效并提醒重新扫码；不做自动续期。

### 6. 平台优先级

1. **Bilibili（v1）**：仅视频评论（`type=1`）；动态（11/17）、专栏（12）留到 v1.1。
2. **掘金**：第二个实现，用来验证本契约是否足够通用。
3. **抖音：v1 不做**。个人号无可用评论能力，企业号接口需审核且风控最严。

## Bilibili MVP 范围

| 能力 | v1 状态 |
|---|---|
| 解析 BV → aid（`x/web-interface/view`） | 实现 |
| 读取白名单视频最新评论（`x/v2/reply`，`sort=0`） | 实现（只读轮询） |
| 登录态识别自身 uid（`x/web-interface/nav`） | 实现（有 Cookie 时） |
| 「回复我的 / @我的」通知（`x/msgfeed/reply`、`x/msgfeed/at`） | 实现（可选 `notifications`，需 Cookie；只收视频评论；默认只收白名单视频；以 `mentioned: true` 入站） |
| 草稿队列（`review` 模式） | 实现（落盘到本地数据目录，重启恢复） |
| 审批后真正发出（`x/v2/reply/add`） | 实现：Console「评论审批」页或 master 执行 `bili-draft send <id>`；带最小发送间隔与风控熔断 |
| 新草稿推送 / Console 审批页 / 草稿持久化 | 实现（推送需配置 `notify`） |
| 扫码登录 / Cookie 持久化 | 实现（Console 页或 `bili-login start`；环境变量仍可用且优先） |

## 结果

- 评论型平台与 IM 平台共享同一 Agent 回合管线，无需新运行时。
- 默认不自动发帖，降低封号与违反用户协议的风险。
- 非官方接口随时可能变更，adapter 标记 **Experimental**，不进 stable smoke。
