---
"@zhin.js/command": patch
"@zhin.js/core": patch
"@zhin.js/adapter-telegram": patch
---

安装 HTML 渲染能力时，内置指令菜单通过统一发送链生成菜单图；渲染失败或平台无法投递图片时保留原有文本菜单。菜单采用可自定义标题、配色与背景的三列主题，每页最多 30 项，支持根菜单与插件菜单翻页。平台同时支持原生 Markdown 与按钮时自动附加上一页、下一页控件，在边界禁用；其他平台保留文本导航。Telegram 禁用按钮映射为 Bot API 10.3 DisabledButton。补充中英文文档。
