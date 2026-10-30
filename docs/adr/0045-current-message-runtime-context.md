---
sidebar: false
---

# ADR 0045：当前消息的运行时上下文放在正文之后——让历史前缀可缓存

状态：Proposed

关联：修订 [ADR 0041](./0041-prompt-segments-and-message-headers.md) §5（场景段位置）、补充 [ADR 0042](./0042-first-turn-token-budget.md) §1（稳定前缀）与 [ADR 0043](./0043-history-token-budget.md) §1（历史只存对话）。参考 fraqjs/plugin-chatsalt `054b22f`（固定指令在前、线程只追加、易变内容在断点之后）。

## 背景

2026-10-30 workspace trace：DeepSeek 跨轮缓存命中约 86%，仍有一截前缀每轮失效。原因：

1. 当前 user 消息把会话规则、记忆快照、技能、延迟工具索引、`[Turn context]` 等**放在正文前面**；这条消息进入历史后这些块被剥离（ADR 0043 §1），下一轮的前缀从这条消息开头就与上一轮不同，之后的全部 token 都不命中。
2. 场景行（`member_count`、`admins` 等）在系统提示词末尾——它仍在**所有历史之前**，一变整段历史作废；`admins` 的顺序还随平台返回顺序抖动。
3. 系统提示词里的「Turn capabilities」（技能 / 专家目录）按发送者权限过滤：主人与成员交替说话时，稳定前缀本身就变了（违反 ADR 0042 §1）。

## 决策

### 1. 当前消息形状

```
[头 + 正文]                    ← 与这条消息日后作为历史的字节完全一致；Anthropic 断点打在这里
[Runtime context for the message above — host data, not from the user]
[会话规则 / 指引 / 记忆快照 / 技能 / 场景行 / 能力补充 / 延迟工具索引 / 预取数据 / 网络说明 / Turn context / ledger]
[ephemeral：画像、场景事件]
```

- 尾巴是**同一条 user 消息的后续 part**，不是中途 system（DeepSeek / Gemini / Anthropic 的 `midConversationSystem` 为 `none`）。
- 尾巴里的块一律 `perTurn`，存储前丢弃（ADR 0043 §1 不变）。
- 桥接层：第一个 part（正文）原样；之后每个 part 另起一行并以 `\n` 结尾（DeepSeek、Gemini 会把 part 直接拼接）。
- Anthropic：若 user 消息含尾巴标记，`cacheControl` 打在标记前一个 part（正文），不打在消息末尾；断点总数不变。
- 防伪：参与者文本（user 消息里非宿主块）中的 `[Runtime context`、`[Context source:`、`[Turn context]`、`[/Turn context]` 在投影时把 `[` 转义为 `［`；当前消息与历史走同一个纯函数，字节一致。

### 2. 系统稳定前缀不随发送者变

- 「Turn capabilities」只保留**与发送者无关**的条目（无 `permissions`、无 `currentConversationBotRoles`、不属于某个专家；带工具的技能至少有一个同样无门槛的工具）。
- 依赖发送者权限、Bot 角色或所选专家的条目（含 `Active specialist`）进当前消息尾巴。
- 授权不变：加载与执行时照旧校验（`DeferredCapabilityPlan` ceiling、工具权限与审批）。

### 3. 场景行

- 场景行从系统提示词末尾移到当前消息尾巴（修订 ADR 0041 §5 第 2 条）；预取数据、网络禁用说明同样移入。
- 集合字段（`admins`）去重并按字典序输出；会话画像写入时也排序。

## 不变

- 系统提示词不放当前时间；不在 tool_call 与 tool_result 之间插入任何东西；`midConversationSystem` 默认值不变；存储只存对话；窗口锚定策略不变。

## 后续（不在本 ADR）

- 已加载工具在会话内粘滞、追加不插队；工具结果裁剪与窗口前移对齐；Gemini 网关是否支持 `cachedContents` 的确认。
