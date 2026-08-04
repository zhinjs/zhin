---
"@zhin.js/ai": minor
---

feat(ai): agentLoop  harness 四项架构级优化

- **事件不可变**：`agent_end` 发快照副本，删除 `finally` 清空本地数组（此前已发出事件的 `messages` 会在生成器恢复后被置空，属定时炸弹）。
- **增量历史修复**：新增 `createIncrementalRepair`——修复不变量由 loop 持有，按最后一个 user 消息为边界，多轮迭代只重修活跃尾部（此前 `repairAgentMessagesForLlm` 每次 LLM 调用都 O(n) 全量扫描）；`Context.preRepaired` 让桥序列化跳过重复修复，外部调用方仍享安全默认。
- **并行工具结果按调用序落列**：tiered/parallel 桶并发执行不变，toolResult 统一按声明顺序写入消息流（此前按完成先后），对齐 Anthropic 类对块顺序敏感的协议。
- 清理：`toolExecution` 恒等三元死代码、`maxRecompletePerIteration` 每轮计数的语义注释。
