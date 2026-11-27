---
"@zhin.js/console-ui": minor
"@zhin.js/cli": patch
---

**组件库改为「柔光卡片」设计规范**（ADR 0063 增补 D34–D41）：黑白主色、浅色多彩的内容，大圆角、无描边卡片、胶囊按钮，浅色和深色两套。已有组件的 API 不变。`--background`、`--primary` 等原有名字都映射到新颜色，但 Console 自己的 `theme-tokens.css` / `design-system.css` 在本包之后加载、会覆盖同名变量：**要等 Console 删掉自己的调色板（`:root`、`[data-palette]`、`.dark` 颜色块）和与本包同名的 `--console-*` 尺寸覆盖之后**（ADR 0063 第 37 条），Console 和插件页面才会换上新外观。

令牌：

- **颜色**：新增柔光卡片调色板 `--console-bg`、`-surface`、`-sunken`、`-raised`、`-line`、`-control`、`-ink`、`-muted`、`-faint`、`-primary`（浅色黑、深色白）、`-on-primary`、`-primary-hover`、`-primary-soft`、`-primary-line`、`-focus`、`-tint-1`…`5`、`-accent-1`…`5`、`-ok` / `-warn` / `-danger` 及其 `-bg`、`-danger-solid`、`-progress`、`-inverse`、`-on-inverse`，以及 `-scrim`、`-gradient-hero(-2)`、`-hero-overlay`、`-aurora-1`…`4`。`--background`、`--card`、`--primary`、`--muted-foreground`、`--border`、`--destructive` 等原有名字都映射到新颜色；Tailwind 主题新增 `bg-surface`、`text-ink`、`bg-tint-2`、`text-accent-2`、`bg-ok-bg` 等颜色类。`data-palette` 不再改变颜色；品牌色只用于 `BrandMark`，主按钮改为黑 / 白；信号色与图表色改用调色板（不含蓝紫；`chart-2` 孔雀青与 `ok` 绿拉开色相，`chart-7` 改为暖色赭石，每个图表色在卡片上 ≥ 3:1）。
- **主题**：浅色 `:root` / `.light` / `[data-theme="light"]`，深色 `.dark` / `[data-theme="dark"]`；**什么都不写仍是浅色**（和以前一样，只切 `.dark` 的宿主不受影响）。跟随系统改为可选：`<html data-theme="system">`。Tailwind 的 `dark:` 同步，并且在 `.light` / `[data-theme="light"]` 岛内不生效。
- **字号**：8 档 `xs` 12、`sm` 13、`md` 14、`lg` 15、`xl` 17、`2xl` 22、`title` 26、`display` 32（取代「最多 5 种字号」）；`label` / `body` / `section` 是 `sm` / `md` / `xl` 的别名（`section` 16 → 17，`title` 22 → 26，`display` 28 → 32）。
- **其他**：间距新增 20、40（Tailwind `p-5`、`p-10`）；圆角新增 `r-5` 20、`r-6` 24、`r-7` 28，卡片 24 / 28、输入框 14、按钮胶囊；阴影改为暖色 shadow-sm / md / lg，深色用内描边；卡片无描边、静态卡片带 shadow-sm；控件高 36 / 40 / 48；新增 `--console-motion-exit`、`-motion-pulse`、`-ease-fast`、`-ease-exit`，`--console-ease-out` 改为 `cubic-bezier(0.2, 0, 0, 1)`；`data` 内容宽度改为 80rem（1280px）。

组件：

- **改外观**：`Badge variant="success"` 与 `StatusBadge` / `StatusDot` 的 `ok` 从不着色改为 ok 绿（修订 ADR 0063 D15 第 1 条）；`Button` 胶囊（新增变体 `white`、`text`、`danger-text`、`danger`，尺寸 `icon-sm`，`loading`）；`Card` 无描边白卡；`Badge` 浅底胶囊（新增 `neutral`、`solid`、`tone`）；`StatusBadge` 改为「点 + 文字」，五种 `ok` / `warn` / `danger` / `neutral` / `progress`（旧状态名照常可用）；输入框、下拉、日期框高 48、圆角 14；`Switch` 46 × 28、`Checkbox`、`Radio` 按新设计；`Tabs` 改为分段样式（默认按文字宽度排列，`<Tabs fill>` 才占满等宽）；`Dialog` 圆角 28、从 96% 放大；`Sheet` 网页端是右侧 480 宽浮起抽屉、手机是底部弹层；`DropdownMenu` 圆角 20、每项 46（新增 `variant="danger"` 菜单项）；菜单项与下拉选项的键盘焦点是 primary-soft 底加 2px 焦点环，指针悬停只有 sunken 填充；`Table`、`Skeleton`、`Alert`（提示条）、`EmptyState`（图标块 + 标题 + 按钮，新增 `presets`）、`PageHeader`、`StatCard` 按新规范调整。
- **新增**：`Tile`、`Chip`、`Segmented`（`role="tablist"`，纯筛选可用 `role="radiogroup"`；使用方的 `onKeyDown` 先执行）、`Stepper`（到上下限时 `aria-disabled`，焦点不丢）、`StatusDot`（及 `statusTone()`）、`Banner`、`Toast` / `Toaster` / `useToast` / `createToastStore` / `toastDuration` / `TOAST_DURATION_MS` / `TOAST_UNDO_DURATION_MS`（带「撤销」至少 5 秒；悬停或焦点在内时暂停；`Toaster` 是唯一的 live region；没有 `Toaster` 时 `useToast()` 不显示，开发模式下告警一次）、`HeroCard`、`ListGroup` / `ListRow` / `ListCaption` / `ChangedDot`（按钮行选中写 `aria-pressed`，`disabled` 的链接行不再跳转）、`NavPill` / `NavIcon` / `IconButton`、`TabBar` / `TabBarItem`、`Aurora`、`ActionBar`。
- 动画在 `prefers-reduced-motion: reduce` 下只保留淡入。

护栏：stylelint、ESLint 与 Tailwind 类名白名单、`scale.json` 和布局审计按新尺度更新（8 档字号、`r-0`…`r-7`、间距键 `5` / `10`、卡片允许 shadow-sm；一致性只按本包 `button` / `badge` / `icon-button` / `tile` / `hero` 的已知变体细分，`aria-current="false"` 不算选中；描边、选中竖条、输入框焦点这几种复合阴影只允许出现在对应组件上；新导出 `AUDIT_VARIANT_SLOTS`、`AUDIT_RING_SLOTS`）。审计的 `setConsoleTheme()` 改为 Console 的切换方式（深色 `.dark`、浅色什么都不写）。`zhin plugin check` 第 5 条的间距键同步加入 `5` 和 `10`（`@zhin.js/cli`）。
