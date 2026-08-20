---
'@zhin.js/ai': patch
---

Fix Anthropic-protocol reasoning round-trip (MiniMax / Claude): do not re-send unsigned thinking parts that trigger AI SDK `unsupported reasoning metadata` warnings. Capture Anthropic thinking signatures when present; keep openai-compatible DeepSeek placeholder behavior unchanged.
