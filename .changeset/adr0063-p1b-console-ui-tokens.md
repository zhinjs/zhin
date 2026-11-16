---
"@zhin.js/console-ui": minor
---

ADR 0063 P1b：令牌与组件规则（有意改变外观）。

- **三层令牌、单一事实来源**：`tokens/tokens.mjs` 定义基础尺度（字号 `label` / `body` / `section` / `title` / `display`，字重 `regular` / `medium` / `strong`，`space-1`…`space-8`，`r-0`…`r-4` / `r-full`，`hairline` / `focus`，`e-0`…`e-3`，断点 `sm` 40rem / `md` 48rem / `lg` 64rem / `xl` 90rem，内容宽度 `reading` 60rem / `data` 120rem）、语义令牌（`--console-card-padding`、`--console-control-height` 等）和按尺寸取值；由它生成 `tokens.css`、Tailwind 4 主题 `@zhin.js/console-ui/theme.css`（间距只保留 `0`、`px`、`1`、`2`、`3`、`4`、`6`、`8`、`12`、`16`，默认字号、字重、圆角、阴影、断点和颜色清空）、`custom-media.css` 与 `scale.json`。页面级令牌按视口取值，其余令牌按所在 `.console-cq` 容器的宽度取值。
- **取值变化**：`--console-content-max` 默认为 `data`（120rem，原 90rem），`PageShell width="reading"` 为 60rem；圆角 6 / 10 / 14 / 18px，不再用 `calc(… - Npx)`；静态卡片改为 hairline 描边、无阴影；手机宽度下控件 44px；`--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-*`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card`、`--console-control-height-sm/-lg`、`--console-text-body-sm` 等旧名改为别名，P4 删除。
- **组件**：`PageShell` 新增 `width`（`reading` / `data` / `full`）与 `inset`，自带页面边距并解析 `--console-content-max`；`PageHeader` 与 `usePageChrome` 新增 `menuActions` / `moreActions`，窄于 40rem 时收进「更多」菜单；`Table` 在窄于 40rem 的容器里每行变卡片（`priority="secondary"` 的列隐藏，单元格标签取自表头或 `label`）；下拉、菜单、弹出层和对话框在手机上以底部抽屉出现；`Badge` 的 `success` 与新组件 `StatusBadge` 把「正常」渲染为弱化文字；新增 `Section`、`Grid`、`ListDetail`、`MoreMenu`、`RowActions`、`PageActions`、`useContainerAtLeast`。
- **约束工具（可被 zhinjs/console 复用）**：`@zhin.js/console-ui/stylelint`（`createConsoleStylelintConfig()`）、`@zhin.js/console-ui/eslint`（`configs.recommended`：禁任意值、尺度外类名、原生控件）、`@zhin.js/console-ui/tailwind-classes`、`@zhin.js/console-ui/audit`（Playwright 布局审计 `auditPage` / `runLayoutAudit` / `auditPluginPages`，豁免写 `data-zhin-ui-ignore="<检查项>: <理由>"`）。
