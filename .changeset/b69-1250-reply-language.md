---
"@zhin.js/agent": patch
---

AI 回复遵从用户用 `/language` 设置的个人语言（zhinjs/zhin#1250 第 69 批）。之前 `/language en` 只影响指令与固定回复，AI 仍跟随提问的语言作答；现在设置过个人语言的用户，用中文提问也会收到英文回复。

- 行为变化：IM 入站回合会核对发送者是否亲自设置过个人语言（复用 Root 的个人语言偏好端口，并写入可信回合元数据，适配器元数据无法冒充）。设置过时，本轮 `[Turn context]` 的语言行由 `Reply language fallback: en.` 改为 `Reply language (set by the user with /language): en.`，并说明：即使用户用另一种语言书写也照此回复，只有当前这条消息里的明确语言要求才能覆盖它，`[User profile]` 里的 language 只作参考。进度摘要与步数用尽后的总结使用同样的措辞。
- 稳定系统提示里的回复语言规则改为：明确要求 → 用户的 `/language` 设置 → 用户原文语言 → `Reply language fallback` → SOUL.md；规则仍与用户无关，缓存前缀结构不变。
- 未设置个人语言的用户、群里合并多人消息的回合、直播弹幕窗口和机器人主动插话的回合行为不变（仍是 `Reply language fallback`）；群里每人按自己的设置，互不影响；聊天创建的提醒与计划任务仍使用创建时记录的语言。
- `user_profile` 工具说明更新：language 维度只作参考、不决定回复语言；用户想改回复语言时应提示其发送语言指令（如 `/language en`），保存 language 时工具回执也会提示这一点。
- 不新增导出，公共类型不变。
