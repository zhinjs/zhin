---
"@zhin.js/client": minor
"@zhin.js/console-ui": minor
---

ADR 0063 P2：声明式渲染器改用 `@zhin.js/console-ui`，`@zhin.js/client/ui` 弃用。

`@zhin.js/client`：

- `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 只渲染内容区块：标题、说明、无表单的动作、状态徽标和 `RefreshControl`（更新于 hh:mm:ss、手动 / 5s / 15s / 30s 自动、刷新）通过 `usePageChrome` 交给 Console 的页面外壳；外层没有 `PageChromeProvider`（旧版 Console）时在内容区内自己画页头。`AdapterConsolePage embedded` 不上报页头。宿主可读 `DECLARATIVE_PAGE_CAPABILITIES` / `ADAPTER_CONSOLE_PAGE_CAPABILITIES` 的 `pageChrome: true` 判断。
- 删除首字母方块：蓝图与评论审批 spec 的 `mark` 被忽略，使用时控制台告警一次（后续 minor 删除）。
- `variant: 'danger'` 的动作（页头、表单、行操作、批量操作）渲染为 `destructive-outline` 描边按钮并弹出确认对话框，没写 `confirm` 时自动补「确认<动作名>？」；实心红色只在确认按钮上；`confirmText` 照常可用。
- 渲染器里不再有原生 `<select>`（选择字段、自动刷新间隔、适配器页布尔字段与平台动作选项均为 Radix 下拉），也不再注入 `zk-` 样式；删除 `adapter-console/styles.ts`、`review-console/styles.ts`。统计卡片为弹性网格，`DataTable` 基于新表格组件并在窄容器里每行变成一张卡片（列的 `fixed`、`responsiveStack` 不再起作用），原始 ID 与 JSON 默认收起，正常状态的徽标弱化。
- 非 UI 导出迁到根入口：`usePluginRpc`、`usePluginData`、`useRpcResource`、`useLocale`、`detectLocale`、`translate`、`formatClock`、`resolvePluginId`、`resolveSyncPluginId`、`resolveAdapterConsolePluginId`、`DeclarativePageView`、`createDeclarativePage`、`DataTable` 及类型。`@zhin.js/client/ui` 改为弃用的再导出层（原样再导出这些名字和旧 `zk-` 组件，首次导入告警一次，`zk-` 类名弃用），升级对照见 docs/authoring/console-pages.md「从 @zhin.js/client/ui 升级」。`adapterConsoleStyles`、`conversationPickerStyles` 弃用期内为空字符串。
- 独立的适配器页与评论审批页的定时刷新改由 `RefreshControl` 驱动（适配器页默认 6 秒、评论审批页默认 10 秒，扫码登录等待时评论审批页仍每 2 秒轮询）；嵌入模式与 `AdapterAccountsProvider` 照旧自己轮询。

`@zhin.js/console-ui`：新增内容区块 `ContentSection`、`ContentStack`、`ContentGrid`、`MetricCard`、`FormField`、`KeyValueList`、`ProgressMeter`、`Sparkline`、`Timeline`、`Disclosure`、`CodeText`、`JsonBlock`、`MediaPreview`、`ResponsiveTable`、`RecordCard`（按所在容器宽度切换布局，样式在 `styles.css` 里）；`usePageChrome` 可上报 `title` / `description`；`RefreshControl` 新增 `onAutoRefresh`（自动刷新与手动刷新做的事不同时使用）。

另：`DeclarativePageView` 现在也接受函数形式的蓝图（`definePageBlueprint` / `defineCommentReviewPage` 返回的页面函数本身），评论审批蓝图不再被误当成普通蓝图渲染。
