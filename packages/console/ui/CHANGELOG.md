# @zhin.js/console-ui

## 1.2.0

### Minor Changes

- 3cf5a4f: ADR 0063 P4：删除弃用期已满（至少一个 minor）的接口。按 ADR 0063 D11（所有者决定），删除走 minor，不等 major。

  `@zhin.js/client`（1.3.0 弃用）：

  - 删除 `@zhin.js/client/ui` 子路径（`exports["./ui"]`）及其 `zk-` 组件（`PluginPage`、`PageHeader`、`Button`、`Select`、`Modal`、`ConfirmButton` 等）和 `pluginUiStyles`。数据、语言、插件 ID 工具、声明式渲染器与会话选择工具从 `@zhin.js/client` 根入口导入（名字不变）；组件改用 `@zhin.js/console-ui`；页头交给页面外壳（`usePageChrome`）。
  - 删除 `adapterConsoleStyles`、`conversationPickerStyles`（弃用期内为空字符串）：删掉导入和注入它们的 `<style>`。
  - 删除 `zk-` 类名：适配器页账号编辑器不再带 `zk-account-editor-host`，宿主改用 `[data-adapter-account-editor]` 定位。
  - 蓝图与评论审批 spec 不再读取 `mark`，也不再为它告警。

  `@zhin.js/console-contract`（1.3.1 标注、随 client 1.3.0 这一轮宣布弃用）：删除 `DeclarativePageSpec.mark` 与 `CommentReviewBlueprintSpec.mark`，写了会报类型错误，删掉即可。

  `@zhin.js/console-ui`（1.1.0 弃用）：

  - 删除旧令牌别名 `--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-xs/sm/md/lg/xl/panel/hover/button`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card/-card-sm`、`--console-control-height-sm/-lg`、`--console-border-width`、`--console-focus-width`、`--console-duration-fast/-page`、`--console-text-caption/-code/-body-sm/-section-sm/-title-compact`、`--radius`，以及无后继的 `--console-shadow-ring`。对照：`radius-sm/md/lg/xl/2xl` → `radius-1/2/3/4/4`；`shadow-xs/button` → `elevation-0`，`shadow-sm/panel` → `card-elevation`，`shadow-md` → `elevation-2`，`shadow-lg/xl` → `elevation-3`，`shadow-hover` → `card-hover-elevation`；`space-page-x/-y` → `page-padding-inline/-block`，`space-section` → `section-gap`，`space-stack` → `stack-gap`，`space-card(-sm)` → `card-padding`；`control-height-sm/-lg` → `control-height-compact` / `control-height`；`border-width` / `focus-width` → `border-hairline` / `border-focus`；`duration-fast/-page` → `motion-fast` / `motion-base`；`text-caption/-code/-body-sm` → `text-label`，`text-section-sm` → `text-section`，`text-title-compact` → `text-title`；`--radius` → `--console-control-radius`（均带 `--console-` 前缀）。`scale.json` 的 `css.aliasTokens` 改为 `css.removedTokens`（旧名 → 新名）。
  - stylelint 规则 `console/no-deprecated-tokens` 改为报出这些已删除的名字并给出新名；`createConsoleStylelintConfig({ deprecatedTokens })` 不变。
  - 删除 `Button` 的 `variant="default"`（1.1.0 起是 `soft` 的弃用别名）：改写 `variant="soft"`，或不写 `variant`（默认就是 `soft`）。

  `@zhin.js/pagemanager`：独立页外壳的样式不再覆盖 `.zk-root` / `--zk-*`，构建时注入的 `defineCommentReviewPage` 不再把 `mark` 写进蓝图。`@zhin.js/cli`：`zhin plugin check` 第 2 条在从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage` 的提示中注明该子路径已在 `@zhin.js/client` 1.4.0 删除。`@zhin.js/adapter-sandbox`：按钮由已删除的 `variant="default"` 改为 `soft`，外观不变。

  第三方插件：已经构建好的插件把自己用的 `@zhin.js/client` 打进了包里，子路径和 `zk-` 的删除不会让它们失效，升级依赖重新构建时按 docs/authoring/console-pages.md「从 @zhin.js/client/ui 升级」与「ADR 0063 P4 删除的其他接口」迁移。`@zhin.js/console-ui` 由 Console 作为共享单例提供，Console 升级到 1.2 后，还在用 `variant="default"` 的按钮会退回基础样式，读旧令牌名的样式取不到组件库的值，请改成新名。

### Patch Changes

- 6c7e79c: `Tabs` 未选中页签的文字改用新令牌 `--tab-inactive`（Tailwind `text-tab-inactive`）：浅色为同色相、亮度 34%，深色沿用 `--muted-foreground`。原来的 `muted-foreground`（亮度 39%）写在页签栏底色（页面底 + 6% 前景）上只有 4.45:1，现在 8 种配色、深浅主题都 ≥ 4.5:1（zhinjs/console#151 的组件库侧）。

## 1.1.1

### Patch Changes

- d7f8100: 修复 `cn()` 把 console-ui 主题里的字号类（`text-label`、`text-body` 等）当成文字颜色：同时出现时会删掉变体的文字颜色（例如 `size="sm"` 的 `destructive` / `destructive-outline` / `link` 按钮失去红色或链接色），或删掉字号。`cn()` 现在按 `@zhin.js/console-ui/theme.css` 的字号、字重、圆角、阴影、断点与边框宽度合并类名（zhinjs/console#138 升级时发现）。

## 1.1.0

### Minor Changes

- 94dcb49: ADR 0063 色板角色与信号色（zhinjs/console#125），外观有意改变：

  - **令牌**：`tokens/tokens.mjs` 新增与配色无关的颜色角色（深浅两套）——`--console-brand`（`#76EEC6` / `#7FFFD4`，所有者 2026-11-16 决定）、`--console-brand-foreground`、`--console-brand-text`（链接、焦点环、选中态）、`--console-brand-tint`、`--console-signal-{danger,warning,success,info}-{fill,text}`（同色相同饱和度，只调亮度；警告填充为琥珀 `hsl(38 92% 50%)`）、`--console-chart-1`…`-8` / `-other`；Tailwind 主题提供同名颜色类（`bg-brand`、`text-signal-danger-text` 等）。旧名 `--destructive` / `--success` / `--warning` / `--info` 指向对应的 `signal-*-text`，`--chart-*` 指向 `--console-chart-*`，`--ring` 与焦点环改用 `brand-text`。
  - **动效**：`--console-motion-fast` 120ms / `-base` 200ms / `-slow` 280ms，缓动统一 `--console-ease-out`，Tailwind `transition-*` 默认也用它们；`--console-duration-fast`（原 150ms）/ `--console-duration-page` 改为弃用别名。stylelint 新规则 `console/motion-tokens` 禁止写死时长与缓动（`createConsoleStylelintConfig({ motionTokens })` 可降为 `'warning'`）。
  - **组件**：新增 `BrandMark`（favicon 形状，品牌色固定，可带「Zhin Console」）与 `CONSOLE_PRODUCT_NAME`；`Button` 新增 `primary`（品牌底 + 深色字，每个视图最多一个）与 `destructive-solid`（只用于确认对话框），`default` 改名 `soft`（`default` 保留为弃用别名，外观不变），`destructive` 改为幽灵样式（红字、无底）；`ConfirmDialog` 的危险确认改用 `destructive-solid`、普通确认用 `primary`；`PageAction` 的 `tone: 'primary'` 渲染为 `primary`。徽标、`StatCard`、`InfoHint`、`ProgressMeter`、`Sparkline`、`Timeline`、`MiniRingGauge` 改用信号 fill / text，danger 比 success 醒目；`StatCard` 数值为 0 时忽略 `tone`（新增 `isZeroValue`）。复选、单选、开关、下拉勾选与输入框焦点边框改用 `brand-text`。`styles.css` 在根上设置 `font-variant-numeric: tabular-nums`。
  - **升级提示**：页面上直接用 `variant="destructive"` 作确认按钮的，改为 `destructive-solid`（或改用 `ConfirmDialog`）。

- 9dbddcc: ADR 0063 D28–D33（zhinjs/console#125 第三阶段，组件库一侧），外观有意改变：

  - **空状态**：`EmptyState` 改为 64px 线稿插画 + 一句说明 + 至多一个操作。新增 `illustration`（`messages`、`tasks`、`logs`、`table`、`record`、`not-found`、`generic`，1.5px 描边、`brand-text` 单色）与 `action`（`{ label, onSelect?, href?, variant?: 'soft' | 'primary', icon? }` 或元素）；新增 `EmptyIllustration`、`EMPTY_ILLUSTRATIONS`。原有属性不变；没传 `illustration` 时图标改为 `brand-text`，不再是 opacity 0.3 的灰图标。不再单独显示「暂无数据」：只给 `title` 时只显示标题，`empty.noData` 的文案改为「这里还没有内容」/「Nothing here yet」，新增各插画的默认说明。
  - **表单**：`Input`、`Textarea`、`SelectTrigger` / `SelectField`、`SearchableSelectField` 新增 `variant="ghost"`（平时无边框，悬停、聚焦或展开时才有边框；类型 `ControlVariant`，新增导出类型 `InputProps`、`TextareaProps`、`SelectTriggerProps`）。新增 `DateField`（`YYYY-MM-DD`）与 `DateTimeField`（`YYYY-MM-DDTHH:mm`）替代原生日期框：本地时间 ISO 值、可清空、键盘操作、`min` / `max`，基于 Popover + 月历，不引入新依赖；新增日期纯函数 `parseDateValue`、`parseDateTimeValue`、`formatDateValue`、`formatDateTimeValue`、`calendarMonth`、`addDays`、`addMonths`。
  - **图标**：组件库内的 lucide 图标统一 `strokeWidth 1.75`（原为 2），新增 `CONSOLE_ICON_STROKE_WIDTH`、`CONSOLE_ICON_SIZE`（控件 16、导航 18）。
  - **代码标识**：新增 `InlineCode`（`tone`：`subtle` / `plain`）与 `console-code` 类，等宽、极浅底色、无边框；`CodeText` 外观与之相同。
  - **焦点与动效**：鼠标操作对话框、菜单、下拉与日期选择后不留焦点环（视觉回归检查）；抽屉、底部抽屉与骨架屏动画只在 `prefers-reduced-motion: no-preference` 下运行。
  - **字体**：`--console-font-sans` / `--console-font-mono` 字体栈不变（Inter / JetBrains Mono 优先），文档写明本包不打包字体、由宿主加载。

- 021d052: ADR 0063 P1b：令牌与组件规则（有意改变外观）。

  - **三层令牌、单一事实来源**：`tokens/tokens.mjs` 定义基础尺度（字号 `label` / `body` / `section` / `title` / `display`，字重 `regular` / `medium` / `strong`，`space-1`…`space-8`，`r-0`…`r-4` / `r-full`，`hairline` / `focus`，`e-0`…`e-3`，断点 `sm` 40rem / `md` 48rem / `lg` 64rem / `xl` 90rem，内容宽度 `reading` 60rem / `data` 120rem）、语义令牌（`--console-card-padding`、`--console-control-height` 等）和按尺寸取值；由它生成 `tokens.css`、Tailwind 4 主题 `@zhin.js/console-ui/theme.css`（间距只保留 `0`、`px`、`1`、`2`、`3`、`4`、`6`、`8`、`12`、`16`，默认字号、字重、圆角、阴影、断点和颜色清空）、`custom-media.css` 与 `scale.json`。页面级令牌按视口取值，其余令牌按所在 `.console-cq` 容器的宽度取值。
  - **取值变化**：`--console-content-max` 默认为 `data`（120rem，原 90rem），`PageShell width="reading"` 为 60rem；圆角 6 / 10 / 14 / 18px，不再用 `calc(… - Npx)`；静态卡片改为 hairline 描边、无阴影；手机宽度下控件 44px；`--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-*`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card`、`--console-control-height-sm/-lg`、`--console-text-body-sm` 等旧名改为别名，P4 删除。
  - **组件**：`PageShell` 新增 `width`（`reading` / `data` / `full`）与 `inset`，自带页面边距并解析 `--console-content-max`；`PageHeader` 与 `usePageChrome` 新增 `menuActions` / `moreActions`，窄于 40rem 时收进「更多」菜单；`Table` 在窄于 40rem 的容器里每行变卡片（`priority="secondary"` 的列隐藏，单元格标签取自表头或 `label`）；下拉、菜单、弹出层和对话框在手机上以底部抽屉出现；`Badge` 的 `success` 与新组件 `StatusBadge` 把「正常」渲染为弱化文字；新增 `Section`、`Grid`、`ListDetail`、`MoreMenu`、`RowActions`、`PageActions`、`useContainerAtLeast`。
  - **约束工具（可被 zhinjs/console 复用）**：`@zhin.js/console-ui/stylelint`（`createConsoleStylelintConfig()`）、`@zhin.js/console-ui/eslint`（`configs.recommended`：禁任意值、尺度外类名、原生控件）、`@zhin.js/console-ui/tailwind-classes`、`@zhin.js/console-ui/audit`（Playwright 布局审计 `auditPage` / `runLayoutAudit` / `auditPluginPages`，豁免写 `data-zhin-ui-ignore="<检查项>: <理由>"`）。

- 8941172: ADR 0063 P2：声明式渲染器改用 `@zhin.js/console-ui`，`@zhin.js/client/ui` 弃用。

  `@zhin.js/client`：

  - `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 只渲染内容区块：标题、说明、无表单的动作、状态徽标和 `RefreshControl`（更新于 hh:mm:ss、手动 / 5s / 15s / 30s 自动、刷新）通过 `usePageChrome` 交给 Console 的页面外壳；外层没有 `PageChromeProvider`（旧版 Console）时在内容区内自己画页头。`AdapterConsolePage embedded` 不上报页头。宿主可读 `DECLARATIVE_PAGE_CAPABILITIES` / `ADAPTER_CONSOLE_PAGE_CAPABILITIES` 的 `pageChrome: true` 判断。
  - 删除首字母方块：蓝图与评论审批 spec 的 `mark` 被忽略，使用时控制台告警一次（后续 minor 删除）。

  `@zhin.js/console-contract`：蓝图与评论审批 spec 的 `mark` 标注为弃用，评论审批 spec 的 `mark` 改为可选，`defineCommentReviewPage` 不再把它写进蓝图。`@zhin.js/adapter-bilibili`、`@zhin.js/adapter-juejin`：评论审批页不再设置 `mark`。

  - `variant: 'danger'` 的动作（页头、表单、行操作、批量操作）渲染为 `destructive-outline` 描边按钮并弹出确认对话框，没写 `confirm` 时自动补「确认<动作名>？」；实心红色只在确认按钮上；`confirmText` 照常可用。
  - 渲染器里不再有原生 `<select>`（选择字段、自动刷新间隔、适配器页布尔字段与平台动作选项均为 Radix 下拉），也不再注入 `zk-` 样式；删除 `adapter-console/styles.ts`、`review-console/styles.ts`。统计卡片为弹性网格，`DataTable` 基于新表格组件并在窄容器里每行变成一张卡片（列的 `fixed`、`responsiveStack` 不再起作用），原始 ID 与 JSON 默认收起，正常状态的徽标弱化。
  - 非 UI 导出迁到根入口：`usePluginRpc`、`usePluginData`、`useRpcResource`、`useLocale`、`detectLocale`、`translate`、`formatClock`、`resolvePluginId`、`resolveSyncPluginId`、`resolveAdapterConsolePluginId`、`DeclarativePageView`、`createDeclarativePage`、`DataTable` 及类型。`@zhin.js/client/ui` 改为弃用的再导出层（原样再导出这些名字和旧 `zk-` 组件，首次导入告警一次，`zk-` 类名弃用），升级对照见 docs/authoring/console-pages.md「从 @zhin.js/client/ui 升级」。`adapterConsoleStyles`、`conversationPickerStyles` 弃用期内为空字符串。
  - 独立的适配器页与评论审批页的定时刷新改由 `RefreshControl` 驱动（适配器页默认 6 秒、评论审批页默认 10 秒，扫码登录等待时评论审批页仍每 2 秒轮询）；嵌入模式与 `AdapterAccountsProvider` 照旧自己轮询。

  `@zhin.js/console-ui`：新增内容区块 `ContentStack`、`FormField`、`KeyValueList`、`ProgressMeter`、`Sparkline`、`Timeline`、`Disclosure`、`CodeText`、`JsonBlock`、`MediaPreview`、`RecordCard`（由 `Card` + `KeyValueList` 组成）、`LoadingBlock`（按所在 `.console-cq` 容器宽度切换布局，只用语义令牌，样式在 `styles.css` 里）；分区、网格、统计卡片与表格卡片直接复用 P1b 的 `Section`、`Grid`、`StatGrid` / `StatCard`、`Table`，不另设组件：`Section`、`Grid` 透传 HTML 属性，`StatGrid` 透传 `data-*`，`StatCard` 新增可选 `unit` / `badge` / `footer`，`icon` 改为可选并接受元素或图片 URL；`usePageChrome` 可上报 `title` / `description`；`RefreshControl` 新增 `onAutoRefresh`（自动刷新与手动刷新做的事不同时使用）。

  另：`DeclarativePageView` 现在也接受函数形式的蓝图（`definePageBlueprint` / `defineCommentReviewPage` 返回的页面函数本身），评论审批蓝图不再被误当成普通蓝图渲染。

## 1.0.0

### Patch Changes

- a257dae: 新增 `@zhin.js/console-ui`（ADR 0063 P1a，首发 1.0.0：package.json 记 1.0.0-0，由本 patch 升到 1.0.0）：Console 与插件页面共用的组件库。从 Console 迁入 `components/ui/*`（含 `SearchableSelectField`）、`PageShell`、`PageHeader`、`ConfirmDialog` / `useConfirm`、`StatCard`、`EmptyState`、`ErrorAlert`、`InfoHint`，属性与 Console 原组件一致、外观不变；新增 `RefreshControl`（「更新于 hh:mm:ss」+ 手动 / 5s / 15s / 30s 自动刷新 + 刷新按钮）、`usePageChrome({ actions, refresh })` 及外壳侧的 `PageChromeProvider` / `PageChromeActions`、`Button` 的 `variant="destructive-outline"`、语言 Provider `ConsoleUiI18nProvider`（内置 zh-CN / en，宿主可注入语言与覆盖文案）。发布产物带编译好的 `@zhin.js/console-ui/styles.css`（令牌 + 组件样式，使用方不需要 Tailwind）和只含令牌的 `tokens.css`。

  `@zhin.js/client`：`cn()` 移入 `@zhin.js/console-ui`，`@zhin.js/client` 改为再导出，原有导入不变；`--zk-*` 变量标注为指向 `@zhin.js/console-ui` 令牌的弃用别名（取值不变）。
