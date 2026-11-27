# @zhin.js/console-ui

Zhin Console 与插件页面共用的组件库（[ADR 0063](../../../docs/adr/0063-console-plugin-ui-unification.md)）：基于 Radix 的 React 组件、页面外壳、刷新控件，以及一份设计令牌。样式随包发布、已经编译好，使用方不需要 Tailwind。

**1.3.0 起按「柔光卡片」规范绘制**（ADR 0063 D34–D41）：黑白主色 + 浅色多彩内容，大圆角、无描边卡片、胶囊按钮，浅色和深色两套。已有组件的 API 不变。`--background`、`--primary` 等原有名字都映射到新颜色，但宿主自己在本包之后定义的同名变量会覆盖它们：Console 删掉自己 `theme-tokens.css` 的调色板（`:root`、`[data-palette]`、`.dark` 颜色块）与 `design-system.css` 中同名的 `--console-*` 之后（ADR 0063 第 37 条），Console 和插件页面才会换上新外观。新增 `Tile`、`Chip`、`Segmented`、`Stepper`、`StatusDot`、`Banner`、`Toast` / `Toaster` / `useToast`、`HeroCard`、`ListGroup` / `ListRow` / `ListCaption` / `ChangedDot`、`NavPill` / `NavIcon` / `IconButton`、`TabBar` / `TabBarItem`、`Aurora`、`ActionBar`。见下文「柔光卡片」。

> 状态：P1b（三层令牌、单一事实来源、组件规则、lint 与布局审计；外观有意改变，见 ADR 0063 D15–D22）；P2 起 `@zhin.js/client` 的三个声明式渲染器改用本包，并新增「内容区块」（见下文）；色板角色、信号色、`primary` 按钮、`BrandMark` 与动效令牌见 ADR 0063 D23–D27（zhinjs/console#125）；空状态插画、ghost 控件、日期选择、图标、代码标识、焦点环与字体见 D28–D33（#125 第三阶段）。P4 删除了旧令牌别名与 `Button` 的 `default` 变体（见下文「令牌」）；`@zhin.js/client/ui` 已删除，升级对照见 [Console 页面与布局](../../../docs/authoring/console-pages.md#upgrade-client-ui)。

只给浏览器用：本包与 `radix-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 不在 `zhin.js` 的依赖树里。React 是 peerDependency。

## 引入

```ts
import '@zhin.js/console-ui/styles.css'; // 令牌 + 组件样式（含 Tailwind preflight），只需引入一次
import { Button, PageShell, PageHeader, RefreshControl } from '@zhin.js/console-ui';
```

- `@zhin.js/console-ui/styles.css`：完整样式，自带 preflight、主题、组件用到的 Tailwind 工具类、令牌和 `console-*` 组件类。和自己的 Tailwind 一起用时，先引入它，再引入自己的样式，同一层（`@layer base` 等）里后者优先。
- `@zhin.js/console-ui/tokens.css`：只有令牌（颜色与三层尺寸令牌）。深色由祖先上的 `.dark` 或 `data-theme="dark"` 切换，`.light` / `data-theme="light"` 固定浅色，**什么都不写就是浅色**；跟随系统要显式启用：`<html data-theme="system">`（D38）。`data-palette` 不再改变颜色。
- `@zhin.js/console-ui/theme.css`：生成的 Tailwind 4 主题，只暴露尺度内的键（见下文「令牌」）。自己用 Tailwind 的使用方（Console）在 `@import "tailwindcss"` 之后引入它。
- `@zhin.js/console-ui/custom-media.css`：外壳用的 `@custom-media --console-sm` 等（需要 postcss-custom-media）。
- `@zhin.js/console-ui/scale.json`、`@zhin.js/console-ui/scale`：允许值清单（JSON / ESM），供 lint、`zhin plugin check` 与审计使用。
- `@zhin.js/console-ui/cn`：只有 `cn()`（`@zhin.js/client` 由此再导出 `cn`）。

插件的手写 `.tsx` 页面把本包声明为 `peerDependencies`（例如 `"@zhin.js/console-ui": "^1.0.0"`）：`@zhin.js/pagemanager` 不会把它打进插件，页面拿到的是 Console 已加载的那份组件和 CSS；版本不兼容时会明确报错，见下文「共享模块版本」。

## 导出

| 类别 | 导出 |
| --- | --- |
| 基础组件（`components/ui/*`） | `Accordion*`、`Alert`/`AlertTitle`/`AlertDescription`、`Badge`/`badgeVariants`、`Button`/`buttonVariants`、`Card*`、`Checkbox`、`DateField`/`DateTimeField`、`Dialog*`、`DropdownMenu*`、`Input`、`ListItemButton`、`Popover`/`PopoverTrigger`/`PopoverAnchor`/`PopoverContent`、`RadioGroup`/`RadioGroupItem`、`ScrollArea`/`ScrollBar`、`SearchableSelectField`、`Select*`/`SelectField`、`Separator`、`Sheet*`、`Skeleton`、`Switch`、`Table*`、`Tabs*`、`Textarea`、`Tooltip*` |
| 表单控件（D29） | `variant="ghost"`（`Input`、`Textarea`、`SelectTrigger` / `SelectField`、`SearchableSelectField`、`DateField`、`DateTimeField`，类型 `ControlVariant`）；日期纯函数 `parseDateValue`、`parseDateTimeValue`、`formatDateValue`、`formatDateTimeValue`、`calendarMonth`、`addDays`、`addMonths` |
| 空状态与标识（D28、D31） | `EmptyState`（`illustration`、`action`）、`EmptyIllustration`、`EMPTY_ILLUSTRATIONS`、`InlineCode`（`tone`：`subtle` / `plain`） |
| 图标（D30） | `CONSOLE_ICON_STROKE_WIDTH`（1.75）、`CONSOLE_ICON_SIZE`（控件 16、导航 18） |
| 品牌 | `BrandMark`（`size`：`sm` / `md` / `lg` / 像素值，`withText` 显示「Zhin Console」）、`CONSOLE_PRODUCT_NAME` |
| 柔光卡片（D39–D41） | `Tile`、`Chip`、`Segmented`、`Stepper`、`StatusDot` / `statusTone`、`Banner`、`Toast` / `Toaster` / `useToast` / `createToastStore` / `TOAST_DURATION_MS`、`HeroCard`、`ListGroup` / `ListRow` / `ListCaption` / `ChangedDot`、`NavPill` / `NavIcon` / `IconButton`、`TabBar` / `TabBarItem`、`Aurora`、`ActionBar` |
| 页面与通用组件 | `PageShell`（`width`：`reading` / `data` / `full`）、`PageHeader`（`menuActions` / `moreActions`）、`Section`、`Grid`、`ListDetail`、`StatusBadge`/`isAttentionStatus`、`MoreMenu`、`RowActions`、`PageActions`、`ConfirmDialog`/`useConfirm`、`StatCard`/`StatGrid`/`MiniRingGauge`/`isZeroValue`、`EmptyState`、`ErrorAlert`、`InfoHint`、`RefreshControl` |
| 内容区块（P2） | `ContentStack`、`FormField`、`KeyValueList`、`ProgressMeter`、`Sparkline`、`Timeline`、`Disclosure`、`CodeText`、`JsonBlock`、`MediaPreview`、`RecordCard`（`Card` + `KeyValueList`）、`LoadingBlock`；分区、网格、统计卡片与表格卡片直接用上面的 `Section`、`Grid`、`StatGrid` / `StatCard`、`Table` |
| 容器宽度 | `useContainerAtLeast`、`CONSOLE_BREAKPOINTS_REM`、`syncTableCellLabels` |
| 页面外壳接口 | `usePageChrome({ title, description, actions, refresh, menuActions, moreActions })`、`PageChromeProvider`、`createPageChromeStore`、`usePageChromeState`、`PageChromeActions` |
| 语言 | `ConsoleUiI18nProvider`、`useConsoleUiI18n`、`createConsoleUiI18n`、`ConsoleUiText`、`CONSOLE_UI_MESSAGES`、`CONSOLE_UI_LOCALES` |
| 纯函数 | `cn`、`groupSelectOptions`、`navigableValues`、`optionMatches`、`optionSearchText`、`canSubmitConfirm`、`confirmTextMatches`、`confirmErrorMessage`、`formatRefreshTime`、`refreshIntervalOptions`、`DEFAULT_REFRESH_INTERVALS` |
| 共享模块 | `CONSOLE_UI_VERSION`、`CONSOLE_UI_MODULE_ID`、`registerConsoleUiSharedModule`、`CONSOLE_SHARED_MODULE_VERSIONS_KEY`、`CONSOLE_SHARED_MODULE_ISSUES_KEY`、`CONSOLE_SHARED_MODULE_ISSUE_EVENT` |

组件的属性与 Console 原来的同名组件一致。`Button` 的变体（柔光卡片 D39，旧名全部保留）：

| 变体 | 外观与用途 |
| --- | --- |
| `primary` | 黑 / 白实心胶囊。**每屏最多一个**：保存、发送、安装这类「下一步」；`PageAction` 的 `tone: 'primary'` 和非危险的 `ConfirmDialog` 确认按钮也用它 |
| `secondary`、`soft`（默认） | sunken 底、ink 字，日常按钮 |
| `white` | 白底 + shadow-sm，放在浅彩、主卡、sunken 背景上 |
| `text`、`link` | 无底、ink 字加下划线（取消、还原默认） |
| `ghost` | 无底，悬停叠 4% |
| `outline` | 白底 + 一圈 primary-line 细线（保留，优先用 `secondary` / `white`） |
| `danger-text`、`destructive` | 无底红字：页面上的危险操作入口 |
| `destructive-outline` | 细线 + 红字（ADR 0063 决策 5） |
| `destructive-solid`、`danger` | 实心 danger-solid + 白字。**只用于确认对话框的确认按钮** |

尺寸 `default` / `lg` 48、`sm` 36、`icon` 48、`icon-sm` 36；`loading` 显示转圈、宽度不变、`aria-busy`。

## 柔光卡片（ADR 0063 D34–D41）

```tsx
import { Banner, Button, HeroCard, ListCaption, ListGroup, ListRow, Segmented, StatusDot, Stepper, Tile, Toaster, useToast } from '@zhin.js/console-ui';

<HeroCard title="运行中" description="下次 19:00"><Button variant="white" size="sm">重启</Button></HeroCard>
<Banner tone="warn" action={<Button variant="white" size="sm">去登录</Button>}>QQ 主号待登录</Banner>
<Segmented aria-label="时间范围" value={range} onValueChange={setRange} options={[{ value: 'today', label: '今天' }, { value: '7d', label: '7 天' }]} />
<ListCaption>账号</ListCaption>
<ListGroup>
  <ListRow href="#tg" icon={<Tile tone={2} text>T</Tile>} title="Telegram" description="在线 3 天" end={<StatusDot tone="ok">在线</StatusDot>} />
  <ListRow plain changed title="每人每天上限" description="默认 0" end={<Stepper label="每人每天上限" value={20} unit="次" onValueChange={set} />} />
</ListGroup>
// 外层放一次 <Toaster>，之后 useToast().toast('已保存', { onUndo })
// 没有 <Toaster> 时不显示、返回 -1（开发模式告警一次）；带「撤销」的至少 5 秒，悬停或聚焦时暂停计时
```

- 五条原则：主色只有黑和白；彩色只给内容而且要浅（`Tile` / `Badge` / `Chip` 的 `tone` 1–5，图标色只画图形不写字）；不用蓝紫色；组件自己说清作用（名字、单位、状态词，不加解释小字）；文案要短。插件页面的类别色固定用第 2 组。
- 无障碍：`Chip` 用 `aria-pressed`，`Segmented` 是 `role="tablist"`（方向键切换；纯筛选可写 `role="radiogroup"`），`Stepper` 是两个带名字的按钮加 `<output>`（到上下限时 `aria-disabled`，焦点不丢），单独的 `Toast` 是 `role="status"`（放在 `Toaster` 里时由 `Toaster` 这一个 polite live region 播报），`ListRow` 选中时链接行 `aria-current`、按钮行 `aria-pressed`，`disabled` 的链接行不再跳转，菜单项与下拉选项的键盘焦点有 2px 焦点环（指针悬停只有填充），`Banner` 的 danger 是 `role="alert"`，`NavIcon` / `IconButton` 必须有名字，`Tile` / `Aurora` 是装饰（`aria-hidden`）。所有动画在 `prefers-reduced-motion: reduce` 下只保留淡入。

## 空状态、ghost 控件、日期选择与代码标识（ADR 0063 D28–D31）

```tsx
import { DateTimeField, EmptyState, InlineCode, SelectField } from '@zhin.js/console-ui';

<EmptyState illustration="tasks" action={{ label: '新建定时任务', variant: 'primary', onSelect: create }} />
<EmptyState illustration="table" compact />            // 「在左侧选择一个数据表」
<SelectField variant="ghost" aria-label="备用模型" value={fallback} onValueChange={setFallback} options={models} />
<DateTimeField aria-label="开始时间" value={since} onValueChange={setSince} />  // '2026-11-16T09:30'，清空为 ''
<p>插件 <InlineCode>@zhin.js/plugin-rss</InlineCode> 的 RPC <InlineCode>rss.status</InlineCode></p>
```

- **`EmptyState`**：64px 线稿插画 + 一句说明 + 至多一个操作。`illustration` 取 `messages`（无消息）、`tasks`（无任务）、`logs`（无日志）、`table`（未选中数据表）、`record`（未选中记录）、`not-found`（找不到页面）、`generic`（通用空）；插画是 muted 单色、1.5px 描边（1.3 起，D41）。不给说明时用插画的默认说明，不再单独显示「暂无数据」。`action` 是 `{ label, onSelect?, href?, variant?: 'soft' | 'primary', icon? }`（默认 `soft`）或一个元素。原有的 `icon` / `title` / `description` / `compact` 不变；没传 `illustration` 时图标放在 48 的 sunken 圆形图标块里（1.3 起）；`presets` 放一键套用的胶囊。
- **ghost 控件**：`variant="ghost"` 平时无边框，悬停、聚焦或展开时才出现边框，用于次要字段。
- **`DateField` / `DateTimeField`**：替代原生 `date` / `datetime-local` 输入框，值为本地时间的 ISO 字符串（`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`），空值 `''`；`min`、`max`、`clearable`（默认开）、`weekStartsOn`、`placeholder`、`variant`。键盘：触发器上 Enter / ↓ 打开、Delete / Backspace 清空；月历里方向键按天 / 周、Home / End、PageUp / PageDown 按月（Shift 按年）、Enter 选中、Esc 关闭。
- **`InlineCode`**（或 `console-code` 类）：包名、RPC 名、ID 这类短标识；等宽字体，极浅底色（`tone="plain"` 无底色），不加边框。`CodeText` 外观相同。
- **图标**：组件里的 lucide 图标统一 `strokeWidth 1.75`，控件里 16px、导航 18px；列表、⌘K、工具栏的图标不放在浅色方块里。宿主可用 `<LucideProvider strokeWidth={CONSOLE_ICON_STROKE_WIDTH}>` 让自己的图标一致。
- **焦点环**：只在 `:focus-visible` 时出现，鼠标点开再关闭对话框、菜单、下拉和日期选择后不留焦点环。所有动画只在 `prefers-reduced-motion: no-preference` 下运行。

`StatCard` 的 `tone`（`danger` / `warning`）只给异常值着色：数值用信号文字色、图标用信号填充色，`danger` 卡片另有红色描边；数值为 0 时不着色（稳态，`isZeroValue`）。

## 令牌（ADR 0063 D16、D17）

令牌只在 `tokens/tokens.mjs` 定义一次（颜色在 `tokens/colors.css`），`node tokens/generate.mjs` 生成 `client/styles/generated/` 下的 `tokens.css`、`theme.css`、`custom-media.css`、`scale.json`；生成物不得手改（`--check` 和单元测试会核对），构建时复制到 `dist/`。

| 层 | 内容 |
| --- | --- |
| 第一层：基础尺度 | `--console-text-xs/sm/md/lg/xl/2xl/title/display`（12 / 13 / 14 / 15 / 17 / 22 / 26 / 32px，各有 `--console-leading-*`），旧名 `label` / `body` / `section` 是 `sm` / `md` / `xl` 的别名；`--console-weight-regular/medium/strong`；`--console-space-1`…`-8`（4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px）加 `-4-5`（20）、`-6-5`（40）；`--console-radius-0`…`-7`（0 / 6 / 10 / 14 / 18 / 20 / 24 / 28px）与 `-full`；`--console-border-hairline/check/focus`（1 / 1.5 / 2px）；`--console-elevation-0`…`-3`（none / shadow-sm / md / lg，深色为内描边）；`--console-size-control-sm/md/lg`（36 / 40 / 48）、`-icon-button` 44、`-switch-width/height` 46 / 28、`-tile-sm/md/lg` 32 / 40 / 48、`-icon` 20；`--console-bp-sm/md/lg/xl`（40 / 48 / 64 / 90rem）；`--console-content-reading/data`（60 / 80rem） |
| 第二层：语义令牌（组件只用这一层） | `--console-page-padding-inline`、`--console-page-padding-block`、`--console-section-gap`、`--console-stack-gap`、`--console-inline-gap`、`--console-heading-gap`、`--console-card-padding(-wide)`、`--console-card-radius`、`--console-card-edge-radius`、`--console-card-border`、`--console-card-elevation`、`--console-card-hover-elevation`、`--console-grid-gap`、`--console-list-row-padding(-inline)`、`--console-control-height(-compact)`、`--console-control-radius`、`--console-control-padding-inline`、`--console-control-gap`、`--console-control-border`、`--console-check-radius`、`--console-segment-radius`、`--console-touch-min`、`--console-badge-height/radius/padding-inline`、`--console-popover-radius/item-radius/padding/elevation`、`--console-dialog-radius/padding/elevation/close-clearance`、`--console-sheet-radius`、`--console-focus-ring(-width/-offset)`、`--console-content-max` |
| 第三层：按尺寸取值 | 小于 40rem / 40–64rem / 64rem 及以上三档，取值见 `tokens.mjs` 的 `semantic`（即 D16 的「按尺寸取值」表）。页面级令牌和浮层令牌按视口取值；其余令牌按所在 `.console-cq` 容器（`PageShell`、`PageHeader`、`Table`、`StatGrid` 等）的宽度取值 |

**柔光卡片颜色（D34）**在 `tokens.mjs` 的 `palette` / `paint` 中定义（十六进制，与设计包 `tokens.json` 相同），生成为 HSL 三元组 `--console-<名>`：`bg`、`surface`、`sunken`、`raised`、`line`、`control`、`ink`、`muted`、`faint`、`primary`（浅色黑、深色白）、`on-primary`、`primary-hover`、`primary-soft`、`primary-line`、`focus`、`tint-1`…`5`、`accent-1`…`5`、`ok` / `warn` / `danger`（各有 `-bg`）、`danger-solid`、`on-danger-solid`、`progress`、`inverse`、`on-inverse`，以及 `scrim`、`gradient-hero(-2)`、`hero-overlay`、`aurora-1`…`4`、`aurora-opacity`。Tailwind 主题提供 `bg-surface`、`text-ink`、`bg-tint-2`、`text-accent-2`、`bg-ok-bg` 等类。`tokens/colors.css` 把 shadcn 式名字映射过去：`--background`→`bg`、`--foreground`→`ink`、`--card`→`surface`、`--popover`→`raised`、`--primary`→`primary`、`--secondary` / `--muted` / `--primary-action`→`sunken`、`--muted-foreground`→`muted`、`--accent` / `--selected`→`primary-soft`、`--border`→`line`、`--input`→`control`、`--ring`→`focus`、`--destructive`→`danger`、`--success`→`ok`、`--warning`→`warn`。

下面的颜色角色（ADR 0063 D23）保留名字，取值已改到柔光卡片调色板（品牌色只用于品牌标；信号色即 `ok` / `warn` / `danger`，`info` 是进行中：progress 点 + ink 字；图表色不含蓝紫）。原表保留作记录：

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--console-brand` | `#76EEC6` | `#7FFFD4` | 品牌标、`primary` 按钮底色（所有者 2026-11-16 决定） |
| `--console-brand-foreground` | `160 80% 10%` | `160 80% 10%` | 品牌底上的文字 |
| `--console-brand-text` | `160 84% 25%` | `#7FFFD4` | 链接、焦点环、选中态（品牌色当文字或细线用） |
| `--console-brand-tint` | `160 60% 94%` | `160 40% 14%` | 选中行等安静的品牌底 |
| `--console-signal-{danger,warning,success,info}-fill` | 明亮 | 明亮 | 圆点、进度条、图标、徽标底色；不当文字 |
| `--console-signal-{danger,warning,success,info}-text` | ≥ 4.5:1 | ≥ 4.5:1 | 状态文字；与 fill 同色相、同饱和度，深浅主题只调亮度 |
| `--console-chart-1`…`-8`、`--console-chart-other` | 分类色 | 分类色 | 一切数据可视化；相邻两色 ΔE2000 ≥ 20 |

稳态（运行中、成功、失败数为 0）不用信号色；「失败」「已拒绝」比「成功」醒目。1.3 起 `--destructive`、`--success`、`--warning`、`--info` 指向 `danger`、`ok`、`warn`、`ink`，`--ring` 指向 `focus`（ink），`--chart-*` 仍指向 `--console-chart-*`。具体取值与实测对比度见 ADR 0063 D34 与 `tests/contrast.test.ts`。

字体（D33）：`--console-font-sans`（Inter 优先）与 `--console-font-mono`（JetBrains Mono 优先）只定义字体栈，之后回退到系统字体。**本包不打包字体，宿主负责加载字体**（例如 Console 用 `@font-face` 自托管 Inter 与 JetBrains Mono 的拉丁 + 数字子集，`font-display: swap`）；没有加载时按字体栈回退。

动效（D26、D37）：`--console-motion-fast` 120ms（`--console-ease-fast`）、`--console-motion-base` 200ms 与 `--console-motion-slow` 280ms（`--console-ease-out` = `cubic-bezier(0.2, 0, 0, 1)`）、`--console-motion-exit` 180ms（`--console-ease-exit`）、`--console-motion-pulse` 1.6s；Tailwind 的 `transition-*` 默认用 fast。`styles.css` 在根上设置 `font-variant-numeric: tabular-nums`，数字等宽。

旧名在 1.1 弃用、在 ADR 0063 P4（1.2.0）删除，样式里读到它们时 stylelint 规则 `console/no-deprecated-tokens` 会给出新名：

| 已删除 | 改用 |
| --- | --- |
| `--console-radius-sm` / `-md` / `-lg` / `-xl` / `-2xl` | `--console-radius-1` / `-2` / `-3` / `-4` / `-4`（组件里优先用语义令牌，如 `--console-control-radius`、`--console-card-radius`） |
| `--console-shadow-xs` / `-button` | `--console-elevation-0` |
| `--console-shadow-sm` / `-panel` | `--console-card-elevation` |
| `--console-shadow-md` | `--console-elevation-2` |
| `--console-shadow-lg` / `-xl` | `--console-elevation-3` |
| `--console-shadow-hover` | `--console-card-hover-elevation` |
| `--console-shadow-ring` | 无对应令牌：用 `--console-border-hairline` 描边或语义阴影 |
| `--console-space-page-x` / `-page-y` | `--console-page-padding-inline` / `-block` |
| `--console-space-section` / `-stack` | `--console-section-gap` / `--console-stack-gap` |
| `--console-space-card` / `-card-sm` | `--console-card-padding` |
| `--console-control-height-sm` / `-lg` | `--console-control-height-compact` / `--console-control-height` |
| `--console-border-width` / `--console-focus-width` | `--console-border-hairline` / `--console-border-focus` |
| `--console-duration-fast` / `-page` | `--console-motion-fast` / `--console-motion-base` |
| `--console-text-caption` / `-code` / `-body-sm` | `--console-text-label` |
| `--console-text-section-sm` / `-title-compact` | `--console-text-section` / `--console-text-title` |
| `--radius` | `--console-control-radius` |

`Button` 的 `variant="default"`（1.1 改名为 `soft` 后保留的弃用别名）同样在 P4 删除，改写 `variant="soft"`，或不写 `variant`（默认就是 `soft`）。

Tailwind 主题（`theme.css`）：`p-*` / `m-*` / `gap-*` / `space-*` 只有 `0`、`px`、`1`、`2`、`3`、`4`、`5`、`6`、`8`、`10`、`12`、`16`（4px 网格；`space-5` 对应 `p-6`）；尺寸类（`w` / `h` / `size` / `inset` / `min-*` / `max-*` / `translate` / `basis`）保留 Tailwind 的数字键，另有 `control`、`control-medium`、`control-compact`、`tile`、`tile-sm`、`tile-lg`、`icon-button`、`touch`、`touch-min`、`badge`；`text-*` 有 8 个字号和 3 个别名，`font-*` 只有三个字重，`rounded-*` 为 `0`–`7`、`full` 和语义键（`control`、`pill`、`card`、`sub`、`hero`、`badge`、`popover`、`dialog` 等），`shadow-*` 为 `e1`–`e3`、语义键（`card`、`popover`、`dialog`、`float`）和 `hairline`、`selected`、`field-focus`，断点 `sm` / `md` / `lg` / `xl`，颜色只有主题色和柔光卡片颜色。`dark:` 变体认 `.dark`、`[data-theme="dark"]`，以及系统为深色时的 `[data-theme="system"]`，在 `.light` / `[data-theme="light"]` 岛内不生效。`Tabs` 默认按文字宽度排列，`<Tabs fill>` 才占满等宽。

## 约束工具（ADR 0063 D20，可在 zhinjs/console 复用）

```js
// stylelint.config.mjs —— 只允许令牌与尺度内取值；@media 只在外壳文件
import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint';
export default createConsoleStylelintConfig({ shellFiles: ['src/shell\\.css$'] });

// eslint.config.mjs —— 禁任意值类、尺度外类名、原生 <button>/<input>/<select>/<textarea>/<table>/<dialog>
import consoleUi from '@zhin.js/console-ui/eslint';
export default [{ files: ['**/*.tsx'], ...consoleUi.configs.recommended }];
```

- `console/scale-values`、`console/no-unknown-tokens`、`console/no-deprecated-tokens`、`console/media-queries`、`console/motion-tokens`（stylelint 插件 `@zhin.js/console-ui/stylelint-plugin`；`motion-tokens` 禁止 `transition` / `animation` 写死时长或缓动，迁移期间可用 `createConsoleStylelintConfig({ motionTokens: 'warning' })` 降级）；
- `console-ui/no-arbitrary-values`、`console-ui/no-off-scale-classes`、`console-ui/no-native-controls`（ESLint）；判定逻辑在 `@zhin.js/console-ui/tailwind-classes` 的 `classifyClass()`，`zhin plugin check` 可直接复用。

本包自己：`pnpm --filter @zhin.js/console-ui lint:css`（stylelint + 生成物核对，根命令 `pnpm check:console-ui-styles`）；ESLint 规则在根 `eslint.config.mjs` 中对 `packages/console/ui/**` 生效（`components/ui/**` 的基础组件本身包装原生元素，不查 `no-native-controls`）。

## 布局审计（ADR 0063 D20 第 3 条）

`@zhin.js/console-ui/audit`（Node 侧，需要可选 peer `@playwright/test` 与 `esbuild`）：

- `auditPage(page, options)`：对 Playwright 当前页面逐个元素读取计算样式，返回 `{ violations, exemptions }`；
- `runLayoutAudit(page, { open })`：在 375 / 768 / 1280 / 1920 × 亮 / 暗下运行；
- `auditPluginPages({ repoRoot, widths, themes, plugins })`：把插件的 `pages/<名>/index.tsx` 和本包的外壳（`PageShell` + `PageHeader`）一起打包，用 Chromium 打开并审计（`pnpm check:plugin-ui-audit` 使用它）。手写 React 页面直接挂载；声明式蓝图、适配器页和评论审批页由 Console 渲染器渲染，需要在请求里传 `mountModule`（导出 `mountPluginPage(context)` 的模块，见 `audit/mount-page.jsx`），否则返回 `mounted: false` 与 `skipped` 原因、不出违规。
- `formatAuditReport(report)`：文字摘要。

检查项 id：`type-scale`、`spacing`、`radius`、`border`、`shadow`（柔光卡片的复合阴影只能用在各自的组件上，见 `AUDIT_RING_SLOTS`）、`consistency`（按 `data-slot` 分组，同一宽度只有一种圆角 / 边框 / 阴影；只有本包的 `button`、`badge`、`icon-button`、`tile`、`hero` 再按已知变体细分，见 `AUDIT_VARIANT_SLOTS`；「选中」只认 `aria-current` 不为 `"false"` 等真正选中的状态）、`overflow`、`touch-target`、`edge-card`、`static-card`、`bottom-drawer`、`content-width`、`duplicate-text`、`focus-visible`、`contrast`、`shell-overlap`，以及 `auditPluginPages` 的 `mount`（页面构建或渲染失败）。豁免：在元素上写 `data-zhin-ui-ignore="<检查项>[,<检查项>…]: <理由>"`，对该元素及子元素生效，结果的 `exemptions` 列出每一条。

本包的组件示例页是门禁：`pnpm --filter @zhin.js/console-ui test:audit`（根命令 `pnpm check:console-ui-audit`，在 Full validation 中运行），四个宽度 × 两种主题全项通过，并在 375px 打开下拉、「更多」菜单和对话框检查底部抽屉；Console 和插件页面先只出报告。

## 语言

组件不读任何宿主的 i18n。没有 Provider 时使用 zh-CN 默认文案；宿主注入当前语言和可选的覆盖文案：

```tsx
import { ConsoleUiI18nProvider } from '@zhin.js/console-ui';

<ConsoleUiI18nProvider locale={locale} messages={{ 'error.retry': '再试一次' }}>
  {children}
</ConsoleUiI18nProvider>
```

`locale` 接受任意 BCP 47 标签（`zh*` → zh-CN，`en*` → en，其余 → zh-CN）；`messages` 的键见 `CONSOLE_UI_MESSAGES`。

## 刷新控件与页头操作

`RefreshControl`：「更新于 hh:mm:ss」+ 自动刷新间隔（Radix 下拉：手动 / 5s / 15s / 30s）+ 刷新按钮。`onRefresh` 返回 Promise 时，按钮在完成前保持忙碌；自动刷新在标签页隐藏或上一次刷新未结束时跳过。

手写页面不画自己的页头，而是把操作交给外壳：

```tsx
import { Button, usePageChrome } from '@zhin.js/console-ui';

export default function Feeds() {
  const hosted = usePageChrome({
    actions: <Button variant="destructive-outline">移除订阅</Button>,
    refresh: { onRefresh: reload, updatedAt },
  });
  // hosted === false：外层没有外壳（例如旧版 Console），页面可以自己画这些控件
  return <FeedTable />;
}
```

外壳为每个页面槽创建一个 `createPageChromeStore()`，用 `<PageChromeProvider store>` 包住页面，并在 `PageHeader` 的 `actions` 里放 `<PageChromeActions store />`。`usePageChrome` 还接受 `menuActions`（有文字的操作：页头够宽时是按钮，窄于 40rem 时收进「更多」）和 `moreActions`（始终在「更多」里）。`usePageChromeState(store)` 还能读到页面上报的 `title` / `description`（声明式页面的标题与说明），外壳已有自己的标题区时可以只用作页签名。`RefreshControl` 的 `onAutoRefresh` 用于自动刷新与手动「刷新」做的事不同的页面（例如手动刷新才解除「请先刷新」的锁定）。

## 内容区块

外壳负责页头，页面只放内容。内容区块补充 P1b 的布局组件而不重复它们：分区用 `Section`，网格用 `Grid`（统计卡片用 `StatGrid` + `StatCard`，`StatCard` 可带 `unit`、`badge`、`footer`），表格用 `Table`（自身宽度小于 40rem 时每行变卡片）。区块按**所在 `.console-cq` 容器**的宽度切换布局（`@container console`，不看视口），只用语义令牌：`KeyValueList` 在窄容器里一列；`RecordCard` 是 `Card` + 一列 `KeyValueList`，用于账号、连接这类记录卡片；`Disclosure` 默认收起，用于原始 ID、JSON 这类默认不显示的内容（D15、D18）；`LoadingBlock` 是带 `role="status"` 的骨架行。

## 共享模块版本

Console 入口在加载插件入口前登记本包：

```ts
import * as ConsoleUi from '@zhin.js/console-ui';
ConsoleUi.registerConsoleUiSharedModule(ConsoleUi, sharedModules); // sharedModules: globalThis.__ZHIN_CONSOLE_SHARED_MODULES__
```

它把模块放进 `sharedModules`，并把 `CONSOLE_UI_VERSION` 写进 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__`（`Map<模块名, 版本>`）。`@zhin.js/pagemanager` 生成的代理模块拿它和插件 `peerDependencies` 中的范围比对：主版本不兼容时页面导入失败并给出原因；版本偏低时在控制台告警，并把记录追加到 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__`、派发 `zhin:console-shared-module-issue` 事件（`detail` 为 `ConsoleSharedModuleIssue`），Console 可以据此在页面上提示；插件用到而 Console 这份没有的具名导出会按名字报出，调用时抛错。

## 开发

```bash
pnpm --filter @zhin.js/console-ui build          # 生成令牌 + tsc + Tailwind 编译 dist/styles.css、tokens.css、theme.css、scale.json、exports.json
pnpm vitest run packages/console/ui              # 单元测试（含令牌、lint 规则、颜色对比度与图表色 ΔE）
pnpm --filter @zhin.js/console-ui lint:css       # stylelint + 生成物核对
pnpm --filter @zhin.js/console-ui test:visual    # Playwright 视觉回归（亮 / 暗，1280 与 375，先 build）
pnpm --filter @zhin.js/console-ui test:audit     # 布局审计门禁（先 build）
```

视觉回归打开 `visual/demo.tsx` 的组件示例页（引入 `dist/styles.css`，示例页自己的布局类用 `dist/theme.css` 编译），对页面外壳、按钮、输入框、下拉框、表格和对话框截图比对，并在 375px 检查「更多」菜单、表格变卡片和底部抽屉。基线依赖本机字体；本机已装其它版本的 Chromium 时，用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指过去。改了外观要用 `--update-snapshots` 更新基线并逐张评审。
