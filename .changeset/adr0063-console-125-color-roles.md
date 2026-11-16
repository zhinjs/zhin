---
"@zhin.js/console-ui": minor
---

ADR 0063 色板角色与信号色（zhinjs/console#125），外观有意改变：

- **令牌**：`tokens/tokens.mjs` 新增与配色无关的颜色角色（深浅两套）——`--console-brand`（`#76EEC6` / `#7FFFD4`，所有者 2026-11-16 决定）、`--console-brand-foreground`、`--console-brand-text`（链接、焦点环、选中态）、`--console-brand-tint`、`--console-signal-{danger,warning,success,info}-{fill,text}`（同色相同饱和度，只调亮度；警告填充为琥珀 `hsl(38 92% 50%)`）、`--console-chart-1`…`-8` / `-other`；Tailwind 主题提供同名颜色类（`bg-brand`、`text-signal-danger-text` 等）。旧名 `--destructive` / `--success` / `--warning` / `--info` 指向对应的 `signal-*-text`，`--chart-*` 指向 `--console-chart-*`，`--ring` 与焦点环改用 `brand-text`。
- **动效**：`--console-motion-fast` 120ms / `-base` 200ms / `-slow` 280ms，缓动统一 `--console-ease-out`，Tailwind `transition-*` 默认也用它们；`--console-duration-fast`（原 150ms）/ `--console-duration-page` 改为弃用别名。stylelint 新规则 `console/motion-tokens` 禁止写死时长与缓动（`createConsoleStylelintConfig({ motionTokens })` 可降为 `'warning'`）。
- **组件**：新增 `BrandMark`（favicon 形状，品牌色固定，可带「Zhin Console」）与 `CONSOLE_PRODUCT_NAME`；`Button` 新增 `primary`（品牌底 + 深色字，每个视图最多一个）与 `destructive-solid`（只用于确认对话框），`default` 改名 `soft`（`default` 保留为弃用别名，外观不变），`destructive` 改为幽灵样式（红字、无底）；`ConfirmDialog` 的危险确认改用 `destructive-solid`、普通确认用 `primary`；`PageAction` 的 `tone: 'primary'` 渲染为 `primary`。徽标、`StatCard`、`InfoHint`、`ProgressMeter`、`Sparkline`、`Timeline`、`MiniRingGauge` 改用信号 fill / text，danger 比 success 醒目；`StatCard` 数值为 0 时忽略 `tone`（新增 `isZeroValue`）。复选、单选、开关、下拉勾选与输入框焦点边框改用 `brand-text`。`styles.css` 在根上设置 `font-variant-numeric: tabular-nums`。
- **升级提示**：页面上直接用 `variant="destructive"` 作确认按钮的，改为 `destructive-solid`（或改用 `ConfirmDialog`）。
