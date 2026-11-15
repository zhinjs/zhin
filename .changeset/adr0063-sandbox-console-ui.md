---
"@zhin.js/adapter-sandbox": minor
---

Sandbox 会话页迁到 `@zhin.js/console-ui`（ADR 0063 P2，D13 两步）。

- 第一步：zhinjs/console 中只服务 Sandbox 的样式（`agent-playground.css` 全部、`im-workspace.css` 中 Sandbox 用到的规则）搬进插件 `pages/index/workspaceStyles.ts`，由页面自己注入、全部限定在 `.zhin-sandbox` 内，不再依赖 Console 的样式表与 Tailwind 扫描。
- 第二步：按钮、输入框、下拉框（原生 `<select>` 换成 `SelectField`）、开关、页签、「更多」菜单（`DropdownMenu`）、清空确认（`ConfirmDialog`）、提示条（`Alert`）改用 `@zhin.js/console-ui`；危险操作为描边按钮，实心红色只在确认对话框中出现；页面以 `definePage({ fullWidth: true })` 占满内容区，页头交给 Console 外壳（`usePageChrome`），无外壳时页面自己画「会话列表」「检查器」开关；手机上运行栏只保留运行状态、停止与「更多」，其余操作收进「更多」，可点控件不小于 44px。
- 修正 768–1180px 宽度下会话列表变成抽屉却没有开关、主区被挤进第一列的问题；会话抽屉不再用 `position: fixed` 盖住 Console 外壳；打开检查器时宽屏下输入区不再被挤出。
- `package.json` 新增 peerDependency `@zhin.js/console-ui`（`workspace:^`，发布为 `^0.1.0`），需要提供该共享模块的 Console。
