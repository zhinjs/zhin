---
"@zhin.js/command": patch
"@zhin.js/core": patch
---

指令菜单降噪（#1250）：「子插件」只列出子树里有当前发送者可用指令的插件，不再列出适配器（如 icqq、github）和无指令的纯服务插件（仍可用「菜单 <插件名>」直接查看）；根菜单标题不再显示内部实例名「=== root 指令菜单 ===」，改用项目显示名（`metadata.displayName`）或「=== 指令菜单 ===」。会话历史回放带原生按钮的回复时，未渲染的 JSX 不再被序列化成 `[markdown]{"$jsx":"zhin.jsx/1",…}`：Markdown 取原文，按钮（键盘行与 `<button>`）降级为 `[标签]`。
