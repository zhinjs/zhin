# @zhin.js/console-ui

Zhin Console 与插件页面共用的组件库（[ADR 0063](../../../docs/adr/0063-console-plugin-ui-unification.md)）：基于 Radix 的 React 组件、页面外壳、刷新控件，以及一份设计令牌。样式随包发布、已经编译好，使用方不需要 Tailwind。

> 状态：P1a（从 Console 迁入，外观不变）；P2 起 `@zhin.js/client` 的三个声明式渲染器改用本包，并新增「内容区块」（见下文）。`@zhin.js/client/ui` 已弃用，升级对照见 [Console 页面与布局](../../../docs/authoring/console-pages.md#upgrade-client-ui)。

只给浏览器用：本包与 `radix-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 不在 `zhin.js` 的依赖树里。React 是 peerDependency。

## 引入

```ts
import '@zhin.js/console-ui/styles.css'; // 令牌 + 组件样式（含 Tailwind preflight），只需引入一次
import { Button, PageShell, PageHeader, RefreshControl } from '@zhin.js/console-ui';
```

- `@zhin.js/console-ui/styles.css`：完整样式，自带 preflight、主题、组件用到的 Tailwind 工具类、令牌和 `console-*` 组件类。和自己的 Tailwind 一起用时，先引入它，再引入自己的样式，同一层（`@layer base` 等）里后者优先。
- `@zhin.js/console-ui/tokens.css`：只有令牌（颜色、圆角、控件高度、间距、阴影、`--console-content-max`）。深色由祖先上的 `.dark` 切换，配色由 `<html data-palette>` 切换。
- `@zhin.js/console-ui/cn`：只有 `cn()`（`@zhin.js/client` 由此再导出 `cn`）。

插件的手写 `.tsx` 页面把本包声明为 `peerDependencies`（例如 `"@zhin.js/console-ui": "^0.1.0"`）：`@zhin.js/pagemanager` 不会把它打进插件，页面拿到的是 Console 已加载的那份组件和 CSS；版本不兼容时会明确报错，见下文「共享模块版本」。

## 导出

| 类别 | 导出 |
| --- | --- |
| 基础组件（`components/ui/*`） | `Accordion*`、`Alert`/`AlertTitle`/`AlertDescription`、`Badge`/`badgeVariants`、`Button`/`buttonVariants`、`Card*`、`Checkbox`、`Dialog*`、`DropdownMenu*`、`Input`、`ListItemButton`、`Popover`/`PopoverTrigger`/`PopoverAnchor`/`PopoverContent`、`RadioGroup`/`RadioGroupItem`、`ScrollArea`/`ScrollBar`、`SearchableSelectField`、`Select*`/`SelectField`、`Separator`、`Sheet*`、`Skeleton`、`Switch`、`Table*`、`Tabs*`、`Textarea`、`Tooltip*` |
| 页面与通用组件 | `PageShell`、`PageHeader`、`ConfirmDialog`/`useConfirm`、`StatCard`/`StatGrid`/`MiniRingGauge`、`EmptyState`、`ErrorAlert`、`InfoHint`、`RefreshControl` |
| 内容区块（P2） | `ContentSection`、`ContentStack`、`ContentGrid`（`auto-fit` 弹性网格，`min="stat"` 在窄容器里两列）、`MetricCard`、`FormField`、`KeyValueList`、`ProgressMeter`、`Sparkline`、`Timeline`、`Disclosure`、`CodeText`、`JsonBlock`、`MediaPreview`、`ResponsiveTable`（容器窄于 40rem 时显示卡片）、`RecordCard` |
| 页面外壳接口 | `usePageChrome({ title, description, actions, refresh })`、`PageChromeProvider`、`createPageChromeStore`、`usePageChromeState`、`PageChromeActions` |
| 语言 | `ConsoleUiI18nProvider`、`useConsoleUiI18n`、`createConsoleUiI18n`、`ConsoleUiText`、`CONSOLE_UI_MESSAGES`、`CONSOLE_UI_LOCALES` |
| 纯函数 | `cn`、`groupSelectOptions`、`navigableValues`、`optionMatches`、`optionSearchText`、`canSubmitConfirm`、`confirmTextMatches`、`confirmErrorMessage`、`formatRefreshTime`、`refreshIntervalOptions`、`DEFAULT_REFRESH_INTERVALS` |
| 共享模块 | `CONSOLE_UI_VERSION`、`CONSOLE_UI_MODULE_ID`、`registerConsoleUiSharedModule`、`CONSOLE_SHARED_MODULE_VERSIONS_KEY`、`CONSOLE_SHARED_MODULE_ISSUES_KEY`、`CONSOLE_SHARED_MODULE_ISSUE_EVENT` |

组件的属性与 Console 原来的同名组件一致。新增：`Button` 的 `variant="destructive-outline"`（页面上的危险操作入口，等价于 `variant="outline"` 加 `text-destructive`；实心 `destructive` 只用于确认对话框里的确认按钮）。

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

外壳为每个页面槽创建一个 `createPageChromeStore()`，用 `<PageChromeProvider store>` 包住页面，并在 `PageHeader` 的 `actions` 里放 `<PageChromeActions store />`；`usePageChromeState(store)` 还能读到页面上报的 `title` / `description`（声明式页面的标题与说明），外壳已有自己的标题区时可以只用作页签名。`RefreshControl` 的 `onAutoRefresh` 用于自动刷新与手动「刷新」做的事不同的页面（例如手动刷新才解除「请先刷新」的锁定）。

## 内容区块

外壳负责页头，页面只放内容区块。区块按**自己所在容器**的宽度切换布局（`@container`，不看视口）：`ContentGrid` 用 `repeat(auto-fit, minmax(…, 1fr))`，统计卡片在窄容器里两列；`KeyValueList` 在窄容器里一列；`ResponsiveTable` 同时放表格和每行一张 `RecordCard`，容器窄于 40rem 时只显示卡片；`Disclosure` 默认收起，用于原始 ID、JSON 这类默认不显示的内容（D15、D18）。

## 共享模块版本

Console 入口在加载插件入口前登记本包：

```ts
import * as ConsoleUi from '@zhin.js/console-ui';
ConsoleUi.registerConsoleUiSharedModule(ConsoleUi, sharedModules); // sharedModules: globalThis.__ZHIN_CONSOLE_SHARED_MODULES__
```

它把模块放进 `sharedModules`，并把 `CONSOLE_UI_VERSION` 写进 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__`（`Map<模块名, 版本>`）。`@zhin.js/pagemanager` 生成的代理模块拿它和插件 `peerDependencies` 中的范围比对：主版本不兼容时页面导入失败并给出原因；版本偏低时在控制台告警，并把记录追加到 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__`、派发 `zhin:console-shared-module-issue` 事件（`detail` 为 `ConsoleSharedModuleIssue`），Console 可以据此在页面上提示；插件用到而 Console 这份没有的具名导出会按名字报出，调用时抛错。

## 开发

```bash
pnpm --filter @zhin.js/console-ui build          # tsc + Tailwind 编译 dist/styles.css、dist/tokens.css、dist/exports.json
pnpm vitest run packages/console/ui              # 单元测试
pnpm --filter @zhin.js/console-ui test:visual    # Playwright 视觉回归（亮 / 暗，先 build）
```

视觉回归打开 `visual/demo.tsx` 的组件示例页（只引入 `dist/styles.css`），对页面外壳、按钮、输入框、下拉框、表格和对话框截图比对。基线依赖本机字体；本机已装其它版本的 Chromium 时，用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指过去。改了外观要用 `--update-snapshots` 更新基线并逐张评审。
