---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
---

feat(agent): 长对话压缩、已告知账本与缓存友好的提示词顺序（#730）。
- 自动压缩改为在消息达到 `contextWindow × thresholdRatio`（新配置 `ai.agent.compaction.thresholdRatio`，默认 0.7）减去系统提示和工具定义占用时触发，插件运行时会话同样生效；以前要接近“窗口减 13k”才触发。
- 压缩摘要会保留已告知用户的结论和承诺。
- 新增按会话的“已告知”账本，最终回复和进度汇报共用：下一轮以 `[Already told the user]` 短块提供给模型，自动去重，最多 8 条。
- git 状态移到系统提示最后一段，便于缓存稳定前缀。
- 回合追踪记录 provider 返回的缓存命中 token。
