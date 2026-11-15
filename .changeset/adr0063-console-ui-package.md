---
"@zhin.js/console-ui": patch
"@zhin.js/client": patch
---

新增 `@zhin.js/console-ui`（ADR 0063 P1a，首发 1.0.0：package.json 记 1.0.0-0，由本 patch 升到 1.0.0）：Console 与插件页面共用的组件库。从 Console 迁入 `components/ui/*`（含 `SearchableSelectField`）、`PageShell`、`PageHeader`、`ConfirmDialog` / `useConfirm`、`StatCard`、`EmptyState`、`ErrorAlert`、`InfoHint`，属性与 Console 原组件一致、外观不变；新增 `RefreshControl`（「更新于 hh:mm:ss」+ 手动 / 5s / 15s / 30s 自动刷新 + 刷新按钮）、`usePageChrome({ actions, refresh })` 及外壳侧的 `PageChromeProvider` / `PageChromeActions`、`Button` 的 `variant="destructive-outline"`、语言 Provider `ConsoleUiI18nProvider`（内置 zh-CN / en，宿主可注入语言与覆盖文案）。发布产物带编译好的 `@zhin.js/console-ui/styles.css`（令牌 + 组件样式，使用方不需要 Tailwind）和只含令牌的 `tokens.css`。

`@zhin.js/client`：`cn()` 移入 `@zhin.js/console-ui`，`@zhin.js/client` 改为再导出，原有导入不变；`--zk-*` 变量标注为指向 `@zhin.js/console-ui` 令牌的弃用别名（取值不变）。
