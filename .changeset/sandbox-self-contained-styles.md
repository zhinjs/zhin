---
"@zhin.js/adapter-sandbox": patch
---

Sandbox 工作台页面现在自带完整样式：改用 Console 主题 token（含回退值）、最小 12px 字号、手机端 44px 点按目标、暗色可用的遮罩色，移除对 Tailwind 工具类和 `adapterConsoleStyles` 的依赖，并为 Markdown 表格/代码块/列表与快捷键提示行补齐样式；表情列表加载失败与消息解析失败会以内联提示显示。本版本发布后 Console 可以删除 `agent-playground.css` 以及 `remote-entry-style-contract.ts` 中的 Sandbox 类名登记。
