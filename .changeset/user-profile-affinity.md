---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
---

新增会话画像。私聊是一个人的会话，群和频道是多人会话，两者共用一套模型：

- **人物关系与好感度**（新表 `ai_user_relations`，按 `platform + user_id` 合并同一个人）：称呼、短笔记、语气标签、好感度 -100～100、关系 stranger/acquaintance/familiar/close。好感度按规则变化（聊天/夸奖加分，辱骂与连续只当工具用扣分，加分有冷却和每日上限，主人恒定满分），回合结束后异步写回，不阻塞回复。
- **会话上下文与发言限制**（新表 `ai_session_profiles`，按 `platform + scene_key`）：话题、管理员、成员概况、Bot 自己的禁言/全员禁言/宿主限制。由会话事件和发送者角色按规则维护；话题由模型经 `session_profile` 工具更新。Bot 在会话里不能发言时，入站消息直接不进 AI 回合，也不跑旁听判定。
- **注入很短且只对本轮有效**：`[Relationship]` 只放本条消息的发起人（旁听时再加 1 个最近活跃的人），`[Session]` 只有一行；两者作为 ephemeral 内容块发给模型，存入 `agent_messages` 前丢弃，不会在之后的回合重放。`@zhin.js/ai` 的 `TextContentBlock` 新增 `ephemeral` 标记。
- `user_profile` 工具新增 `note` / `unnote` / `call_me` / `tone`，并拒绝保存疑似密钥或证件号的内容。
