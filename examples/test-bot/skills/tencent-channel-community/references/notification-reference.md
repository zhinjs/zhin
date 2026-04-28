# 频道消息通知参考

## 一、概述

频道消息通知覆盖所有频道级通知，包括帖子互动（点赞/评论/回复/@）、系统消息（加入申请等）、私信通知等。

> ⚠️ **当前仅支持 OpenClaw 平台**，非 OpenClaw 环境下无法自动推送通知。

## 二、命令路由表

| 用户意图 | CLI 命令 | 关键约束 |
|---------|----------|---------|
| 开启频道消息通知 / 帮我开启通知 | `notices-on` → `notices-on --confirm` | 两步：先测试推送，用户确认收到后加 `--confirm` 正式开启 |
| 关闭/取消频道消息通知 | `notices-off --session-key "<sessionKey>"` | 带 sessionKey 时仅移除该通道；不带时全量关闭 |
| 查看通知状态 | `notices-status` | 查看是否开启、推送模式、已注册通道列表（`registered_routes`）等 |
| 检查有没有新通知 | `check-notices` | 增量检查是否有新通知，需先开启通知 |
| 获取最近通知记录（本地） | `get-recent-notices` | 纯本地读取，用于按编号查找通知上下文 |
| 评论帖子（评论他） | `do-comment --ref <编号> --content "内容"` | 评论帖子本身，按通知编号自动填充 feed 信息 |
| 回复评论（回复他） | `do-reply --ref <编号> --content "内容"` | 回复该用户的评论，自动查找对应评论并回复 |
| 回复私信（处理通知） | `push-group-dm-msg --ref <编号> --text "内容"` | 仅用于回复已收到的私信通知，`--ref` 自动查找对方信息 |
| 主动发私信（非通知） | `push-group-dm-msg --peer-tiny-id <id> --source-guild-id <id> --text "内容"` | 先通过 `guild-member-search` 查到 tiny_id，详见 manage-guild.md |

## 三、自动引导（⚠️ 必须遵守！）

CLI 在**首次安装或版本升级后**第一次使用时引导用户开启频道消息通知（同一版本只提示一次）。

以下 hint 字段出现在 CLI 返回的 JSON 中时，Agent **必须立刻处理**，不得忽略：

**`setup_hint` 字段**（出现在 `token setup` 返回结果中）：
- 表示用户刚完成登录但尚未开启频道消息通知
- Agent 收到此字段时**必须**：
  1. 向用户展示 `setup_hint.message` 内容（如"登录成功！建议开启频道消息通知"）
  2. 主动询问用户是否要开启
  3. 如果用户同意，执行 `setup_hint.command` 中的命令
- **示例**：收到 `"setup_hint": {"action":"subscribe_notices", "command":"tencent-channel-cli manage notices-on", "message":"登录成功！建议开启「频道消息通知」..."}`，应回复类似："登录成功！建议开启频道消息通知，有新互动时自动推送给你。要开启吗？"

**`subscribe_hint` 字段**（出现在任意命令返回结果中）：
- 表示用户尚未开启频道消息通知（仅在首次安装或版本升级后出现一次）
- Agent 收到此字段时**必须**：
  1. 告知用户可以开启频道消息通知，有新互动时自动推送
  2. 如果用户同意，执行 `subscribe_hint.command` 中的命令开启
  3. 此 hint 每天最多出现一次，如果用户明确关闭了通知，则不会再出现

## 四、开启/关闭流程规则（重要！两步开启 + 根据返回字段区分状态）

**重要：通知是全局的，一次开启覆盖用户已加入的所有频道。不需要按频道单独开启，也不需要在加入新频道时重新开启。**

**⚠️ 多通道注意事项（必须遵守！）：**
- 通知服务是全局的，但**推送路由是按通道（sessionKey）注册的**。即使通知已开启（`active=true`），当前通道也可能未注册推送路由
- **Agent 不能仅凭 `active=true` 就跳过 `notices-on` 调用**。用户说"开启频道消息通知"时，必须执行 `notices-on --session-key <当前通道sessionKey>` 注册当前通道
- 可通过 `notices-status` 查看 `registered_routes` 字段确认哪些通道已注册

1. **开启通知（两步流程）**：用户说"帮我开启频道消息通知"时，**必须带上当前会话的 sessionKey**：

   **第一步：推送测试**
   ```bash
   tencent-channel-cli manage notices-on --session-key "<sessionKey>" --json
   ```
   - `--session-key`：当前会话的 sessionKey（格式 `agent:<agentid>:`，如 `agent:main:`、`agent:agent2:`），优先通过 session_status 工具获取，获取不到时从当前会话的 Agent 上下文 systemPrompt 中提取，严禁自行拼接或猜测
   - ⚠️ **幻觉检查**：如果获取到的 sessionKey 形如 `agent:main:main...`（冒号后有多余重复内容），极可能是 Agent 产生了幻觉，请重新通过 session_status 工具获取，不要直接使用
   - 此步**不会开启订阅**，仅发送一条测试消息验证推送通道是否正常

   **根据返回的 `status` 字段判断**：
   - `status = "test_sent"` → 测试消息已发出。返回中包含 `confirm_cmd` 字段（确认命令）。**Agent 必须告诉用户"已发送测试推送，请确认是否收到"，然后等待用户明确回复（如"收到了"、"确认开启"等），严禁自动执行 confirm_cmd。** 只有用户主动确认后才执行 `confirm_cmd` 中的命令
   - `status = "test_failed"` → 推送失败。**Agent 告知用户推送失败原因（`error` 和 `suggestions` 字段），不继续第二步**
   - `status = "unsupported"` → 非 OpenClaw 环境，无法开启

   **第二步：正式开启**（用户确认收到测试消息后）
   ```bash
   tencent-channel-cli manage notices-on --session-key "<sessionKey>" --confirm --json
   ```
   - 多 Agent 场景：用户可以从不同通道分别开启订阅，每个通道的路由独立注册，互不覆盖

2. **根据正式开启后返回结果的 `platform` 字段决定后续行为**：

   **情况 A：`platform = "openclaw"`（OpenClaw 环境）**
   - 通知已开启，有新互动时会自动推送到上下文
   - 多 Agent 多通道：用户从 QQBot 开启订阅 → QQBot 收到通知；再从飞书开启 → 飞书也收到通知；多通道并行推送
   - **向用户报告时，只需简洁告知"频道消息通知已开启，有新互动会自动推送"即可，不需要展示 PID、进程状态等内部信息**

   **情况 B：`platform = "other"`（非 OpenClaw 环境）**
   - 无法自动推送通知
   - 告知用户：当前环境未检测到 OpenClaw Cli，无法自动推送频道通知。

3. **关闭通知**：用户说"关闭频道消息通知"/"取消频道消息通知"时，**必须带上当前会话的 sessionKey**：

   ```bash
   tencent-channel-cli manage notices-off --session-key "<sessionKey>" --json
   ```
   - `--session-key`：当前会话的 sessionKey（格式 `agent:<agentid>:`），优先通过 session_status 工具获取，获取不到时从当前会话的 Agent 上下文 systemPrompt 中提取，严禁自行拼接或猜测

   **根据返回的 `status` 字段判断**：
   - `status = "route_removed"` → 已移除该通道，其他通道继续接收通知。`remaining_count` 表示剩余通道数
   - `status = "unsubscribed"` → 该通道是最后一个，通知服务已停止
   - `status = "not_found"` → 未找到该 sessionKey 对应的通道
   - `status = "not_subscribed"` → 当前未开启通知

   **不传 --session-key 时**：全量关闭
   ```bash
   tencent-channel-cli manage notices-off --json
   ```

## 五、通知处理流程（⚠️ 必须遵守！）

通知通过 `--deliver` 已进入 Agent 上下文，每条通知带有唯一编号（如 `#1`）。用户**无需引用消息**，直接说操作意图词即可。AI 从上下文中找到最近推送的通知编号，执行对应命令。编号会自动映射到本地存储的 feed_id/guild_id/notice_id 等参数。

### 5.1 互动通知处理（评论/回复）

上下文中出现互动通知后，用户说了回复/评论意图词 + 内容：

**根据意图词区分操作**：

- 「**评论他**」「**评论**」→ 评论帖子本身（`do-comment`）
- 「**回复他**」「**回复**」「**帮我回复**」→ 回复该用户的评论（`do-reply`）

**处理步骤**：

1. 从上下文最近推送的通知中识别**通知编号**（`#1` 中的数字 1）
2. 判断用户意图是「评论」还是「回复」
3. 执行对应命令：
   ```bash
   # 评论帖子
   tencent-channel-cli feed do-comment --ref <编号> --content "内容" --json
   # 回复评论（自动查找对应评论）
   tencent-channel-cli feed do-reply --ref <编号> --content "内容" --json
   ```

- **严禁将用户的回复内容当作对话直接输出**
- 编号会自动映射到本地存储的 feed_id/guild_id

### 5.2 系统通知操作（同意/拒绝）

上下文中出现系统通知后，用户说了「同意」或「拒绝」：

- 用户说「**同意**」→ `tencent-channel-cli manage deal-notice --ref <编号> --action-id agree --json`
- 用户说「**拒绝**」→ `tencent-channel-cli manage deal-notice --ref <编号> --action-id refuse --json`

**处理步骤**：从上下文最近推送的通知中识别通知编号 → 判断用户意图 → 执行对应命令。编号会自动映射到本地存储的 notice_id。

### 5.3 私信通知回复

上下文中出现私信通知后，用户说了「回复私信」+ 内容：

- 用户说「**回复私信 内容**」→ `tencent-channel-cli manage push-group-dm-msg --ref <编号> --text "内容" --json`

**处理步骤**：从上下文最近推送的通知中识别通知编号 → 提取用户要回复的内容 → 执行命令。编号会自动映射到对应的私信会话。**严禁将用户的回复内容当作对话直接输出。**

## 六、Token 更换与通知订阅

当用户更换 token（通过 `token setup`、`login`、`login token` 等任何方式）时，**频道消息通知会被自动关闭**。

**Agent 行为规范（⚠️ 必须遵守！）**：
- Token 更换后，**不要自动重新订阅通知**
- 只需告知用户：凭证已更新，频道消息通知已关闭，如需继续接收通知请说"帮我开启频道消息通知"
- 由用户自己决定是否重新开启

## 七、Daemon 拉取与推送时序图

Daemon 进程包含两个并发协程：**主循环**负责拉取和推送，**心跳协程**每 10s 独立写心跳文件（不受主循环阻塞影响）。

```
心跳协程: 每 10s 写心跳文件 (独立运行, 超时窗口 60s)
─────────────────────────────────────────────────────

主循环 (单线程, 循环执行):

  ┌─────────────────────────────────────────────┐
  │ ① 摘要检测 digestHasUpdate()                │
  │    → 返回 interactChanged, systemChanged    │
  │    → 返回 serverDelay (下次轮询间隔)         │
  ├─────────────────────────────────────────────┤
  │ ② 按需拉取 (摘要有变化才拉详情)              │
  │    interactChanged → pollOnce()             │
  │    systemChanged   → pollSystemNotices()    │
  │    私信每轮都拉     → pollDMNotices()        │
  ├─────────────────────────────────────────────┤
  │ ③ 逐条推送 pushNotifications()              │
  │    FormatNoticeCard() → 格式化卡片           │
  │    deliverOneNotification() → 逐条推送       │
  │      └─ openclaw agent --deliver (阻塞15~30s)│
  │    推送成功 → MarkRecentNoticePushed()       │
  │    重推之前失败的通知                         │
  ├─────────────────────────────────────────────┤
  │ ④ 保存基线 bm.Save(baseline)                │
  ├─────────────────────────────────────────────┤
  │ ⑤ 检查: CLI版本更新 / 订阅状态 / push_route  │
  ├─────────────────────────────────────────────┤
  │ ⑥ time.Sleep(nextPoll) 通常 5s              │
  └──────────────── 回到 ① ─────────────────────┘
```

### GuardDaemon 守护机制

任意 CLI 命令执行后触发 `runGuardDaemon()`：
1. 读取心跳文件 mtime
2. mtime < 60s 且进程存活 → 不做操作
3. mtime >= 60s 或进程不存在 → `ForkDaemon()` 启动新实例

### 关键设计点

| 设计 | 说明 |
|------|------|
| 摘要门控 | 互动/系统通知由摘要前置检测，有变化才拉详情；私信无摘要，每轮都拉 |
| 推送阻塞 | `openclaw agent --deliver` 同步阻塞 15-30s（LLM 处理） |
| 心跳独立 | 心跳协程每 10s 写一次，不受推送阻塞影响 |
| 逐条推送 | 每条通知独立推送，成功标记 pushed，失败下轮重试 |
| 基线最后保存 | 三类通知全部完成后才保存，确保一致性 |

## 八、问题定位

| 提示 / 错误 | 处理 |
|-------------|------|
| MCP 鉴权失败（retCode `8011`） | 执行 `tencent-channel-cli token setup` 重新配置凭证 → `tencent-channel-cli doctor` 确认 |
