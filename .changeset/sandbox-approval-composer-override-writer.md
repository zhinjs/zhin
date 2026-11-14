---
"@zhin.js/im-contract": minor
"@zhin.js/core": minor
"@zhin.js/agent": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/console-protocol": minor
"zhin.js": minor
---

Sandbox 会话页与功能自助反馈（#1250）：

- 审批标记：`UserInteractionRequest` 新增可选 `purpose: 'approval'`，Core 渲染为 keyboard 段 `data.purpose`（经正常出站链）；IM 审批端口（`createRuntimeApprovalPort`）发出的「操作确认」带此标记。Sandbox 页面只给带 `data.purpose === 'approval'` 的收到消息标「需要你的确认」，游戏卡片的「放弃」、菜单分页等普通按钮消息不再被误标。
- Sandbox 输入区：顶栏只保留状态、停止 / 重试、对话与轨迹，其余（模拟发送者、运行环境、运行检查器、清空会话）收进「更多」菜单；底部快捷键提示改为可折叠；快捷命令不再写死 `/help`、`ping`、`/status`，改由新接口 `GET /api/conversations/workspaces/commands`（权限 `endpoint.view`）按该会话的命令索引与 endpoint 实际 `commandPrefix` 生成（菜单的真实命令名优先，无前缀不带 `/`，未注册的命令不出现）。
- 功能覆盖记录操作者：`feature_overrides.updated_by` 在同一文本列内记录结构化写入者（来源 `chat` / `console` / `cli`、聊天身份 adapter + 平台用户 ID + 显示名，或 Console 用户 principal id + 显示名），旧记录照常读取（`chat:…` / `user:…` 推出身份）。`feature.get` 与 `feature.conversations` 返回可选 `operator`：只有对该层级有 `feature.configure` 的调用方看到完整写入者（Console 用户 id 与显示名、聊天身份与名字），仅有 `feature.view` 的只看到来源（`{ source }`）。能解析时返回会话显示名（Sandbox 会话名），只按该会话所属的 Sandbox Endpoint（适配器 + Endpoint）及其当前 owner 匹配，且只返回给同时有 `endpoint.view` 的调用方（与工作区目录同一权限）。**降级注意**：写入过结构化写入者的行，在旧版本里 `updatedBy` 会原样显示为 JSON 字符串（`{"f":1,"by":…,"op":…}`），不影响读取与覆盖生效。
- Sandbox 输入区新增「@ 机器人」按钮：插入对当前机器人（ready 帧的 endpoint id）的 mention，文本形式为 `[@<机器人 id>]`，与入站 `[@机器人名]` 解析一致；@ 候选列表里的机器人条目改为真实 id；快捷操作帮助同步说明。
- 页面兜底渲染：不认识的段不再只显示 `[type]`——`markdown` 显示原文，keyboard 与未渲染的 JSX（`{"$jsx":…}`）读出文本、按钮降级为 `[按钮标签]`，不再出现原始 JSX 对象。

已知限制：Sandbox 页面的「需要你的确认」标记只用于展示，依据收到消息里 keyboard 段的 `data.purpose`；能自行构造该段的插件可以让普通按钮也显示这个标记（不影响审批本身的鉴权）。
