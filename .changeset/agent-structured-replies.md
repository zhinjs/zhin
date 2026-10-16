---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/core": patch
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
---

Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。
