---
"@zhin.js/agent": patch
"zhin.js": patch
---

日志写法统一（zhinjs/zhin#1250 第 19b 批）：Agent 的存储与清理失败日志由 `op=usage_persist status=failed; 说明` 改为与其余日志相同的 `usage_persist | status: failed | detail: 说明`，备用模型切换日志改为 `model_fallback | purpose: … | from: … | to: … | reason: … | phase: …`。实例的 Console 系统日志改用 `@zhin.js/logger` 的 `parseLogLine`，带日期的新格式与旧格式的行都能落库。
