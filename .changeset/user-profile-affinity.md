---
"@zhin.js/agent": patch
---

新增用户画像与好感度：按 `platform + user_id` 合并同一个人，存进新表 `ai_user_relations`（称呼、短笔记、语气标签、好感度 -100～100、关系 stranger/acquaintance/familiar/close、最近场景）。好感度按规则变化（聊天/夸奖加分，辱骂与连续只当工具用扣分，加分有冷却和每日上限，主人恒定满分），每轮开始注入简短的 `[Relationship]` 摘要，回合结束后异步写回，不阻塞回复。`user_profile` 工具新增 `note` / `unnote` / `call_me` / `tone`，并拒绝保存疑似密钥或证件号的内容。
