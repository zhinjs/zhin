# @zhin.js/console-ui

Zhin Console 与插件页面共用的组件库（[ADR 0063](../../../docs/adr/0063-console-plugin-ui-unification.md)）：基于 Radix 的 React 组件、页面外壳、刷新控件，以及一份设计令牌。样式随包发布、已经编译好，使用方不需要 Tailwind。

> 状态：P1b（三层令牌、单一事实来源、组件规则、lint 与布局审计；外观有意改变，见 ADR 0063 D15–D22）；P2 起 `@zhin.js/client` 的三个声明式渲染器改用本包，并新增「内容区块」（见下文）。`@zhin.js/client/ui` 已弃用，升级对照见 [Console 页面与布局](../../../docs/authoring/console-pages.md#upgrade-client-ui)。

只给浏览器用：本包与 `radix-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 不在 `zhin.js` 的依赖树里。React 是 peerDependency。

## 引入

```ts
import '@zhin.js/console-ui/styles.css'; // 令牌 + 组件样式（含 Tailwind preflight），只需引入一次
import { Button, PageShell, PageHeader, RefreshControl } from '@zhin.js/console-ui';
```

- `@zhin.js/console-ui/styles.css`：完整样式，自带 preflight、主题、组件用到的 Tailwind 工具类、令牌和 `console-*` 组件类。和自己的 Tailwind 一起用时，先引入它，再引入自己的样式，同一层（`@layer base` 等）里后者优先。
- `@zhin.js/console-ui/tokens.css`：只有令牌（颜色与三层尺寸令牌）。深色由祖先上的 `.dark` 切换，配色由 `<html data-palette>` 切换。
- `@zhin.js/console-ui/theme.css`：生成的 Tailwind 4 主题，只暴露尺度内的键（见下文「令牌」）。自己用 Tailwind 的使用方（Console）在 `@import "tailwindcss"` 之后引入它。
- `@zhin.js/console-ui/custom-media.css`：外壳用的 `@custom-media --console-sm` 等（需要 postcss-custom-media）。
- `@zhin.js/console-ui/scale.json`、`@zhin.js/console-ui/scale`：允许值清单（JSON / ESM），供 lint、`zhin plugin check` 与审计使用。
- `@zhin.js/console-ui/cn`：只有 `cn()`（`@zhin.js/client` 由此再导出 `cn`）。

插件的手写 `.tsx` 页面把本包声明为 `peerDependencies`（例如 `"@zhin.js/console-ui": "^1.0.0"`）：`@zhin.js/pagemanager` 不会把它打进插件，页面拿到的是 Console 已加载的那份组件和 CSS；版本不兼容时会明确报错，见下文「共享模块版本」。

## 导出

| 类别 | 导出 |
| --- | --- |
| 基础组件（`components/ui/*`） | `Accordion*`、`Alert`/`AlertTitle`/`AlertDescription`、`Badge`/`badgeVariants`、`Button`/`buttonVariants`、`Card*`、`Checkbox`、`Dialog*`、`DropdownMenu*`、`Input`、`ListItemButton`、`Popover`/`PopoverTrigger`/`PopoverAnchor`/`PopoverContent`、`RadioGroup`/`RadioGroupItem`、`ScrollArea`/`ScrollBar`、`SearchableSelectField`、`Select*`/`SelectField`、`Separator`、`Sheet*`、`Skeleton`、`Switch`、`Table*`、`Tabs*`、`Textarea`、`Tooltip*` |
| 页面与通用组件 | `PageShell`（`width`：`reading` / `data` / `full`）、`PageHeader`（`menuActions` / `moreActions`）、`Section`、`Grid`、`ListDetail`、`StatusBadge`/`isAttentionStatus`、`MoreMenu`、`RowActions`、`PageActions`、`ConfirmDialog`/`useConfirm`、`StatCard`/`StatGrid`/`MiniRingGauge`、`EmptyState`、`ErrorAlert`、`InfoHint`、`RefreshControl` |
| 内容区块（P2） | `ContentStack`、`FormField`、`KeyValueList`、`ProgressMeter`、`Sparkline`、`Timeline`、`Disclosure`、`CodeText`、`JsonBlock`、`MediaPreview`、`RecordCard`（`Card` + `KeyValueList`）、`LoadingBlock`；分区、网格、统计卡片与表格卡片直接用上面的 `Section`、`Grid`、`StatGrid` / `StatCard`、`Table` |
| 容器宽度 | `useContainerAtLeast`、`CONSOLE_BREAKPOINTS_REM`、`syncTableCellLabels` |
| 页面外壳接口 | `usePageChrome({ title, description, actions, refresh, menuActions, moreActions })`、`PageChromeProvider`、`createPageChromeStore`、`usePageChromeState`、`PageChromeActions` |
| 语言 | `ConsoleUiI18nProvider`、`useConsoleUiI18n`、`createConsoleUiI18n`、`ConsoleUiText`、`CONSOLE_UI_MESSAGES`、`CONSOLE_UI_LOCALES` |
| 纯函数 | `cn`、`groupSelectOptions`、`navigableValues`、`optionMatches`、`optionSearchText`、`canSubmitConfirm`、`confirmTextMatches`、`confirmErrorMessage`、`formatRefreshTime`、`refreshIntervalOptions`、`DEFAULT_REFRESH_INTERVALS` |
| 共享模块 | `CONSOLE_UI_VERSION`、`CONSOLE_UI_MODULE_ID`、`registerConsoleUiSharedModule`、`CONSOLE_SHARED_MODULE_VERSIONS_KEY`、`CONSOLE_SHARED_MODULE_ISSUES_KEY`、`CONSOLE_SHARED_MODULE_ISSUE_EVENT` |

组件的属性与 Console 原来的同名组件一致。新增：`Button` 的 `variant="destructive-outline"`（页面上的危险操作入口，等价于 `variant="outline"` 加 `text-destructive`；实心 `destructive` 只用于确认对话框里的确认按钮）。

## 令牌（ADR 0063 D16、D17）

令牌只在 `tokens/tokens.mjs` 定义一次（颜色在 `tokens/colors.css`），`node tokens/generate.mjs` 生成 `client/styles/generated/` 下的 `tokens.css`、`theme.css`、`custom-media.css`、`scale.json`；生成物不得手改（`--check` 和单元测试会核对），构建时复制到 `dist/`。

| 层 | 内容 |
| --- | --- |
| 第一层：基础尺度 | `--console-text-label/body/section/title/display`（13 / 14 / 16 / 22 / 28px）、`--console-weight-regular/medium/strong`、`--console-space-1`…`-8`（0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4rem）、`--console-radius-0`…`-4`（0 / 6 / 10 / 14 / 18px）与 `-full`、`--console-border-hairline/focus`、`--console-elevation-0`…`-3`、`--console-bp-sm/md/lg/xl`（40 / 48 / 64 / 90rem）、`--console-content-reading/data`（60 / 120rem） |
| 第二层：语义令牌（组件只用这一层） | `--console-page-padding-inline`、`--console-page-padding-block`、`--console-section-gap`、`--console-stack-gap`、`--console-inline-gap`、`--console-heading-gap`、`--console-card-padding(-wide)`、`--console-card-radius`、`--console-card-edge-radius`、`--console-card-border`、`--console-card-elevation`、`--console-card-hover-elevation`、`--console-grid-gap`、`--console-list-row-padding(-inline)`、`--console-control-height(-compact)`、`--console-control-radius`、`--console-control-padding-inline`、`--console-control-gap`、`--console-control-border`、`--console-check-radius`、`--console-segment-radius`、`--console-touch-min`、`--console-badge-height/radius/padding-inline`、`--console-popover-radius/item-radius/padding/elevation`、`--console-dialog-radius/padding/elevation/close-clearance`、`--console-sheet-radius`、`--console-focus-ring(-width/-offset)`、`--console-content-max` |
| 第三层：按尺寸取值 | 小于 40rem / 40–64rem / 64rem 及以上三档，取值见 `tokens.mjs` 的 `semantic`（即 D16 的「按尺寸取值」表）。页面级令牌和浮层令牌按视口取值；其余令牌按所在 `.console-cq` 容器（`PageShell`、`PageHeader`、`Table`、`StatGrid` 等）的宽度取值 |

旧名（`--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-*`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card(-sm)`、`--console-control-height-sm/-lg`、`--console-border-width`、`--console-focus-width`、`--console-text-caption/-code/-body-sm/-section-sm/-title-compact`、`--radius`）在 P4 之前作为别名保留。

Tailwind 主题（`theme.css`）：`p-*` / `m-*` / `gap-*` / `space-*` 只有 `0`、`px`、`1`、`2`、`3`、`4`、`6`、`8`、`12`、`16`（`space-5` 对应 `p-6`）；尺寸类（`w` / `h` / `size` / `inset` / `min-*` / `max-*` / `translate` / `basis`）保留 Tailwind 的数字键，另有 `control`、`control-compact`、`touch`、`touch-min`、`badge`；`text-*` 只有五个字号，`font-*` 只有三个字重，`rounded-*` 为 `0`–`4`、`full` 和语义键（`control`、`card`、`badge`、`popover`、`dialog` 等），`shadow-*` 为 `e1`–`e3` 和语义键，断点 `sm` / `md` / `lg` / `xl`，颜色只有主题色。

## 约束工具（ADR 0063 D20，可在 zhinjs/console 复用）

```js
// stylelint.config.mjs —— 只允许令牌与尺度内取值；@media 只在外壳文件
import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint';
export default createConsoleStylelintConfig({ shellFiles: ['src/shell\\.css$'] });

// eslint.config.mjs —— 禁任意值类、尺度外类名、原生 <button>/<input>/<select>/<textarea>/<table>/<dialog>
import consoleUi from '@zhin.js/console-ui/eslint';
export default [{ files: ['**/*.tsx'], ...consoleUi.configs.recommended }];
```

- `console/scale-values`、`console/no-unknown-tokens`、`console/no-deprecated-tokens`、`console/media-queries`（stylelint 插件 `@zhin.js/console-ui/stylelint-plugin`）；
- `console-ui/no-arbitrary-values`、`console-ui/no-off-scale-classes`、`console-ui/no-native-controls`（ESLint）；判定逻辑在 `@zhin.js/console-ui/tailwind-classes` 的 `classifyClass()`，`zhin plugin check` 可直接复用。

本包自己：`pnpm --filter @zhin.js/console-ui lint:css`（stylelint + 生成物核对，根命令 `pnpm check:console-ui-styles`）；ESLint 规则在根 `eslint.config.mjs` 中对 `packages/console/ui/**` 生效（`components/ui/**` 的基础组件本身包装原生元素，不查 `no-native-controls`）。

## 布局审计（ADR 0063 D20 第 3 条）

`@zhin.js/console-ui/audit`（Node 侧，需要可选 peer `@playwright/test` 与 `esbuild`）：

- `auditPage(page, options)`：对 Playwright 当前页面逐个元素读取计算样式，返回 `{ violations, exemptions }`；
- `runLayoutAudit(page, { open })`：在 375 / 768 / 1280 / 1920 × 亮 / 暗下运行；
- `auditPluginPages({ repoRoot, widths, themes, plugins })`：把插件的 `pages/<名>/index.tsx` 和本包的外壳（`PageShell` + `PageHeader`）一起打包，用 Chromium 打开并审计（`pnpm check:plugin-ui-audit` 使用它）。手写 React 页面直接挂载；声明式蓝图、适配器页和评论审批页由 Console 渲染器渲染，需要在请求里传 `mountModule`（导出 `mountPluginPage(context)` 的模块，见 `audit/mount-page.jsx`），否则返回 `mounted: false` 与 `skipped` 原因、不出违规。
- `formatAuditReport(report)`：文字摘要。

检查项 id：`type-scale`、`spacing`、`radius`、`border`、`shadow`、`consistency`（按 `data-slot` 分组，同一宽度只有一种圆角 / 边框 / 阴影）、`overflow`、`touch-target`、`edge-card`、`static-card`、`bottom-drawer`、`content-width`、`duplicate-text`、`focus-visible`、`contrast`、`shell-overlap`，以及 `auditPluginPages` 的 `mount`（页面构建或渲染失败）。豁免：在元素上写 `data-zhin-ui-ignore="<检查项>[,<检查项>…]: <理由>"`，对该元素及子元素生效，结果的 `exemptions` 列出每一条。

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
pnpm vitest run packages/console/ui              # 单元测试（含令牌、lint 规则）
pnpm --filter @zhin.js/console-ui lint:css       # stylelint + 生成物核对
pnpm --filter @zhin.js/console-ui test:visual    # Playwright 视觉回归（亮 / 暗，1280 与 375，先 build）
pnpm --filter @zhin.js/console-ui test:audit     # 布局审计门禁（先 build）
```

视觉回归打开 `visual/demo.tsx` 的组件示例页（引入 `dist/styles.css`，示例页自己的布局类用 `dist/theme.css` 编译），对页面外壳、按钮、输入框、下拉框、表格和对话框截图比对，并在 375px 检查「更多」菜单、表格变卡片和底部抽屉。基线依赖本机字体；本机已装其它版本的 Chromium 时，用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指过去。改了外观要用 `--update-snapshots` 更新基线并逐张评审。
