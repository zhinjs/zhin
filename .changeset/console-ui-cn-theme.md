---
"@zhin.js/console-ui": patch
---

修复 `cn()` 把 console-ui 主题里的字号类（`text-label`、`text-body` 等）当成文字颜色：同时出现时会删掉变体的文字颜色（例如 `size="sm"` 的 `destructive` / `destructive-outline` / `link` 按钮失去红色或链接色），或删掉字号。`cn()` 现在按 `@zhin.js/console-ui/theme.css` 的字号、字重、圆角、阴影、断点与边框宽度合并类名（zhinjs/console#138 升级时发现）。
