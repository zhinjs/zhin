---
"@zhin.js/agent": patch
---

`aiCompletion.completeText`：用量配额在调用前预留提示词估算量（并发调用互相可见），调用失败或 provider 未返回 usage 时按估算计费；不再自动 fallback 到同 provider 的其他模型（避免静默切换到更贵的模型）。
