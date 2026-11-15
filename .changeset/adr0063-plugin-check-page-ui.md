---
"@zhin.js/cli": minor
---

`zhin plugin check` 新增页面 UI 检查（ADR 0063 决策 4 与 D20 第 1–6 条），检查插件的 `pages/**`：原生 `<select>`、自定义页头（`<h1>`，或从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage`）、固定内容宽度、原始样式数值、尺度外的 Tailwind 类名（任意值、尺度外的间距键、默认 `shadow-*`）和原生基础控件（`<button>`、`<input>`、`<textarea>`、`<table>`、`<dialog>`）。每条都说明含义并给出 `@zhin.js/console-ui` 组件或令牌的替换建议；它们只是提示，不计入错误和警告，`--strict` 与 `zhin pub` 不受影响。确需保留的写法用行内注释 `zhin-ui-ignore <检查项>: <理由>` 豁免；`--json` 的结果新增 `ui` 与 `hintCount`。
