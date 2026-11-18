---
"@zhin.js/console-ui": patch
---

`Tabs` 未选中页签的文字改用新令牌 `--tab-inactive`（Tailwind `text-tab-inactive`）：浅色为同色相、亮度 34%，深色沿用 `--muted-foreground`。原来的 `muted-foreground`（亮度 39%）写在页签栏底色（页面底 + 6% 前景）上只有 4.45:1，现在 8 种配色、深浅主题都 ≥ 4.5:1（zhinjs/console#151 的组件库侧）。
