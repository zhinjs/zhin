---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Replace the process-wide proxy URL and fetch cache with provider-owned `AiHttpTransport` instances. Model discovery, text generation, image generation, and generated-image downloads now use the owning provider's transport, and disposing `AIService` waits for proxy agents to close.
