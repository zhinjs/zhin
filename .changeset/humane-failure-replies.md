---
"@zhin.js/ai": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
