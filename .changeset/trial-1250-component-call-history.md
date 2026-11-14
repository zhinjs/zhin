---
"@zhin.js/core": patch
---

出站历史与消息预览不再把组件调用显示成 JSON（#1250）：`/card` 返回的 `component('status-card', props)` 在 Sandbox 历史里曾显示为 `{"$content":"zhin.component-call/1","name":"status-card",…}`。`flattenContent` 现在把组件调用读作其文本子节点，没有时读作 `[组件名] 标题`（`title` / `text` / `label`）或 `[组件名]`；`untrustedContent` 读作它包装的内容，`raw()` 读作 `[raw]`。
