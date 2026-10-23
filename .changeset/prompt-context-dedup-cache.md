---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/core": patch
---

减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
