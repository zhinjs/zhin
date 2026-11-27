---
sidebar: false
---

# ADR 0063：Console 与插件页面 UI 统一——一套组件库、一个页面外壳

状态：已接受（Accepted，2026-11-15）；2026-11-27 增补「柔光卡片设计规范」（D34–D41，`@zhin.js/console-ui` 1.3.0，所有者已批准 minor）。所有者已明确要求按 P1a→P4 实施；实施进度：P1（P1a 组件包与共享模块、P1b 三层令牌与组件规则）与 P2（三个渲染器迁到 `@zhin.js/console-ui`、Sandbox 两步迁移、`zhin plugin check` 第 1–6 条与 Playwright 审计门禁，全部官方插件进入门禁名单）已实施；P3（插件页面挂成插件详情页签、顶栏「功能」只列 Console 页面、旧顶层路径重定向，zhinjs/console#115）已实施；P4（删除弃用满一个 minor 的接口，所有者 2026-11-17 同意开始）已实施，见「分阶段计划」中的「P4 实施记录」；以下为提议时的说明，保留作记录：提议（Proposed，2026-11-14）。所有者的长期指示是「需要拍板的按推荐处理」，所以文末「决定」表中的 D1–D10 与 D12–D14 **默认按推荐执行**，D11（`zk-` 在 minor 中删除）是所有者已经给出的决定；2026-11-14 依据 zhinjs/console#111 增补的 D15–D22（设计规则，见「增补：设计规则（console#111）」）同样默认按推荐执行，其中「对 Console 强制、对插件页面推荐、插件只有一组很小的硬性底线」的分寸是所有者给出的决定，「本仓库的官方插件完整遵守全部规则」也是所有者给出的决定（2026-11-14：「官方插件肯定要遵守规则的，我们都不遵守，还怎么推荐给开发者呢」，见 D19）；所有者在本 ADR 的 PR 上没有提出异议，就视为接受，届时只需把状态改为「已接受（Accepted）」。被否决的替代选项保留在同一张表里作为记录。

关联：
- [ADR 0062](./0062-one-path-per-task.md) 第 24 项 / Q24（插件页面只放插件自己的领域视图，挂成插件详情下的页签）。本 ADR 是它的补充：第 24 项定了「挂在哪」，本 ADR 定「长成什么样」。
- [ADR 0052](./0052-console-information-architecture.md)（Console 信息架构）。其中「插件贡献的页面按 `metadata.section` 落到对应区；未声明的落到『功能』」一条由本 ADR 的 D6 修订。
- [ADR 0049](./0049-console-rbac.md)（Console 访问控制）：插件页面的 `requiredPermissions` 不变。
- ADR 0019（安装体积分层，摘要见 [ADR 索引](./index.md)）：新组件包只给浏览器端用，不进 IM 默认安装。

来源：issue zhinjs/zhin#1263（在 console.zhin.dev 上的实测，2026-11-14）。相关条目：#1250 的 `console-adapter-page-duplication`、`plugin-page-raw-conversation-key`、`plugin-page-manual-target`、`process-monitor-cumulative-counters`、`calendar-page-inputs`、`lottery-page-disabled-schedule`；zhinjs/console#64 的 `nav-ia`、`nav-ia-features-split`、`content-width-consistency`、`command-palette-coverage`；#1262（`AdapterAccountsProvider`：数据由插件提供、界面由 Console 渲染）。

涉及两个仓库：插件页面、页面渲染器和 `zk-` 组件在 zhinjs/zhin；Console 外壳和它自己的组件在 zhinjs/console。

## 背景

在 Console 里来回切换 Console 自带页面和插件页面时，宽度、页头、控件、按钮都会变。用户看到的是两套产品拼在一起。

### 1. issue 中的实测

1920px 宽的浏览器、深色主题下：Console 自带页面（AI 与模型、定时任务、插件）的内容宽度都是 1080px，页面里没有原生 `<select>`；9 个插件或适配器页面的宽度各不相同，从 415px 到 1044px，除 ICQQ 外每页都有 1–2 个原生 `<select>`。

这些数值来自 console.zhin.dev 当时部署的版本。当前 zhinjs/console `main` 中内容列的令牌是 `--console-content-max: 90rem`（`console-ui/src/design-system.css:56`）。**本 ADR 原文不规定具体宽度，只规定插件页与 Console 使用同一个令牌。** 增补 D16 规定了两种内容宽度（`reading` 60rem、`data` 120rem），`--console-content-max` 由外壳按页面类型解析为其中之一，取代现在的 90rem（见 D22）。

### 2. 代码核实：两套组件库，只共享了一层变量

| 一侧 | 位置 | 内容 |
| --- | --- | --- |
| Console | zhinjs/console `console-ui/src/components/ui/*`（22 个 shadcn 风格组件，基于 `radix-ui`、`class-variance-authority`、Tailwind 4）；`PageShell.tsx`、`PageHeader.tsx`、`confirm-dialog.tsx`、`StatCard.tsx`、`empty-state.tsx` 等；样式在 `design-system.css`（3265 行）、`shell.css`（911 行）、`theme-tokens.css`（222 行） | Console 自带页面全部用它 |
| zhin | `packages/console/client/client/ui/components.tsx`（2048 行）、`styles.ts`（606 行），以 `@zhin.js/client/ui` 导出（约 50 个组件：`PluginPage`、`PageHeader`、`Button`、`Select`、`Modal` 等），类名前缀 `zk-`，不依赖 Tailwind | 声明式页面渲染器、适配器页、评论审批页、Sandbox 页 |

`styles.ts` 中的 `--zk-*` 变量取自 Console 的 `--primary`、`--console-radius-*`、`--console-control-height` 等变量，所以颜色和圆角大体一致；**但组件结构、布局和交互都是另外实现的**。核实到的具体差异：

- **宽度**：`.zk-page { max-width: 1180px; margin: 0 auto; display: grid; … }`（`styles.ts:100`）是写死的数值，和 Console 的 `--console-content-max` 是两套规则；实测宽度随内容变化，说明插件页的实际宽度由内容决定，不由外壳决定。
- **页头**：`DeclarativePageView` 自己渲染 `PageHeader`，左侧是标题首字母方块（`defaultMark = spec.mark ?? resolvedTitle.trim().slice(0, 1)`，`declarative-page.tsx:1448`），右侧是「更新于 hh:mm:ss」、原生 `<select className="zk-refresh-select">`（手动 / 5s / 15s / 30s 自动，`declarative-page.tsx:1521`）和「刷新」按钮。Console 的页头是 `PageHeader`（标题 + 说明 + 操作区），由 `PageShell` 包起来。
- **下拉框**：`zk` 的 `Select` 就是原生 `<select>`（`components.tsx:744`）；`AdapterConsolePage` 还直接写了两处原生 `<select>`（`adapter-console/AdapterConsolePage.tsx:122`、`:1469`）。Console 用 Radix 的 `select.tsx` 和 `dropdown-menu.tsx`；Console 自己目前只在 `pages/introspection/GalleryPreview.tsx` 里还有两个原生 `<select>`。
- **危险操作**：Console 页面中，入口按钮用 `variant="outline"` 加 `text-destructive`（例如 `pages/plugin-detail.tsx:439`、`pages/ops/instance.tsx:167`），实心 `destructive` 只出现在确认步骤里（`ActionReceipt.tsx:216`、`ApplyFeedback.tsx:171`）。`zk` 的 `ConfirmButton` 和蓝图里 `variant: 'danger'` 的按钮都是实心红色。
- **`zk-` 样式不止一处**：除 `ui/styles.ts` 外，`adapter-console/styles.ts`（597 行）和 `review-console/styles.ts`（15 行）也是 `zk-` 体系的样式。
- **补丁式耦合**：`console-ui/src/remote-entry-style-contract.ts`（90 行）把几十个 `agent-playground-*` / `sandbox-*` 类名逐个写死，原因是 zhin 远程页面的 JSX 不在 Console 的 Tailwind 扫描范围内，生产构建会把对应 CSS 删掉。两套系统继续分开演进，这类补丁只会越来越多。

### 3. 代码核实：官方插件页面几乎全是声明式的

这一点 issue 没有提到，但它决定了迁移成本：

| 页面类型 | 数量 | 写法 | 谁来渲染 |
| --- | --- | --- | --- |
| 插件领域页（RSS、日历、提醒、群管套件、彩票、二维码、记账、短链、内容审核、进程监控、游戏大厅） | 11 | 纯 `.ts` 的 `definePageBlueprint()` | `DeclarativePageView`（`@zhin.js/client`，`ui/declarative-page.tsx`，3056 行） |
| 适配器页 | 20 | `createAdapterConsolePage()` / `defineAdapterPage()` | `AdapterConsolePage`（`@zhin.js/client`，`adapter-console/`） |
| 评论审批页（Bilibili、掘金） | 2 | `defineCommentReviewPage()` | `CommentReviewPage`（`review-console/`） |
| Sandbox 聊天 | 1 | 手写 `.tsx` | 插件自己（`plugins/adapters/sandbox/pages/index/*`） |

声明式页面以数据形式交给 Console：`@zhin.js/pagemanager` 把蓝图编译成调用 `globalThis.__ZHIN_RENDER_BLUEPRINT__` / `__ZHIN_RENDER_ADAPTER_PAGE__` 的入口（`client-build/typescript-builder.ts:154`、`:165`），Console 在 `bootstrap/loadConsoleEntries.ts` 里把这两个全局函数接到 `@zhin.js/client` 的 `DeclarativePageView` 和 `AdapterConsolePage` 上。**所以只要换掉 3 个渲染器，34 个官方页面中的 33 个就会一起切换到新组件**，不需要逐个改插件。手写 `.tsx` 页面由 pagemanager 用 esbuild 打包；目前只有 React 和 React Router 由 Console 提供单例（`node/esmForBrowser.ts` 的 `HOST_PROXIED_MODULES`），`@zhin.js/client` 会被打进每个插件的包里。

### 4. 代码核实：导航与命令面板

- 插件页面通过 `app.addRoute` 注册成普通路由，`navigation-taxonomy.ts` 的 `placePluginRoute` 在页面没有声明 section 时把它放进 `NAV_GROUPS.FEATURES`（「功能」）；`routeSectionId` 使用的 `DEFAULT_SECTION_ID = 'features'` 在 `navigation-sections.mjs:26`（都依据 ADR 0052）。唯一例外是 `PLUGIN_PAGE_PLACEMENT` 把 `/sandbox` 放进 `NAV_GROUPS.WORK`（「会话」）。Console 的导航是顶栏下拉菜单（`layouts/dashboard.tsx` 的 `console-topnav-*`），不是侧栏。所以 13 个插件或适配器页面和 Console 自己的功能页挤在同一个「功能」菜单里。
- 命令面板（`ConsoleCommandCenter.tsx`）索引的是 `app.getRoutes()` 里所有通过 `isCommandRoute` 的路由，**插件路由本来就在里面**，issue 中「插件页本来就没有进命令面板的索引」这一点和当前 `main` 的代码不符（可能是线上版本较旧，需在 P3 用测试确认）。真正的缺口是：插件页只能按标题和路径匹配；内置页有 `ROUTE_SEARCH_HINTS` 提供描述和同义词，插件页没有。插件作者用的 `definePage()` 来自 `@zhin.js/console-contract`（`packages/console/plugin-contract/src/page.ts:96`，`section`、`fullWidth` 都在这里），`@zhin.js/page` 的 `packages/console/page/src/definition.ts` 是在它之上的另一份包装；两处都没有 `keywords` 字段，所以插件没办法声明「抽奖」是「彩票推荐」的别名。另外 `isCommandRoute` 会排除带 `:param` 的路径，插件页改挂到 `/plugins/:name` 下面以后，必须注册具体路径才能被搜到。
- 插件详情页 `/plugins/:name`（`pages/plugin-detail.tsx`）目前没有页签，ADR 0062 第 24 项要求的「挂成页签」还没有落地。

## 决策

### 1. 只保留一套组件库：`@zhin.js/console-ui`，放在 zhinjs/zhin

把 Console 现有的组件（`components/ui/*` 和 `PageShell`、`PageHeader`、确认对话框、状态卡、空状态、错误提示等通用组件）抽成一个发布到 npm 的包 **`@zhin.js/console-ui`**，放在 **zhinjs/zhin 的 `packages/console/ui/`**。Console、`@zhin.js/client` 的渲染器、插件手写页面都从这个包取组件。`zk-` 套件在新包发布时弃用，官方页面迁移完成后，在之后的一个 minor 中删除（所有者决定不必等 major，见 D11）。

**为什么放在 zhinjs/zhin，而不是 zhinjs/console**：

- 组件的第一批使用者是 `@zhin.js/client` 里的 3 个渲染器，它们在 zhinjs/zhin；包放在同一个仓库，渲染器和组件可以在一个 PR 里一起改、一起测。
- zhinjs/console 是 `"private": true` 的静态站点，没有 npm 发布流程；zhinjs/zhin 已有 Changesets、`publish.yml` 和版本策略。
- Console 已经从 npm 依赖 `@zhin.js/client`、`@zhin.js/console-protocol`、`@zhin.js/contract`，再多依赖一个包，方向和现在一致。
- **避免循环依赖**：Console 的 `ui/*`、`PageShell`、`PageHeader` 现在从 `@zhin.js/client` 引入 `cn()`（`client/console-utils/cn.ts`），而 `@zhin.js/client` 的渲染器以后要依赖 `@zhin.js/console-ui`。所以 `cn()` 移到 `@zhin.js/console-ui`，`@zhin.js/client` 改为从它再导出 `cn`（保持现有导入可用）。依赖方向固定为 `@zhin.js/console-ui` ← `@zhin.js/client` ← Console，`@zhin.js/console-ui` 不依赖 `@zhin.js/client`。
- 插件作者只需要认一个来源；`zhin plugin check`（`basic/cli/src/plugin-check/`）也在 zhinjs/zhin，规则可以直接引用组件清单。

代价是 Console 改组件要先在 zhinjs/zhin 发版。缓解办法：Console 开发时用 pnpm `link` 或 `overrides` 指向本地 checkout；只属于 Console 业务页面的组件（例如数据库页的可调宽度分栏、终端）留在 Console，不进公共包。

**包的约束**：

1. **自带编译好的 CSS，不依赖使用方的 Tailwind 扫描。** 包内部可以继续用 Tailwind 4 和 `cva` 写，但发布产物包含一份完整的 `@zhin.js/console-ui/styles.css`（令牌 + 组件样式），以及只含令牌的 `tokens.css`。Console 引入 `styles.css`，插件页面不需要任何构建配置。这样 `remote-entry-style-contract.ts` 就没有存在的理由了。
2. **令牌只有一份。** `theme-tokens.css` 和 `design-system.css` 中的令牌部分（颜色、圆角、控件高度、间距、阴影、`--console-content-max`）移到包里；Console 只保留自己业务页面的样式。弃用期内 `--zk-*` 作为别名指向同一组令牌，删除 `zk-` 时一起删除。
3. **由 Console 提供单例，并显式核对版本。** 需要改三处：pagemanager 的 `ALLOWED_ESM_CANONICAL`（即 `typescript-builder.ts` 的 `BROWSER_EXTERNALS`，决定打包时不把它打进插件）和 `HOST_PROXIED_MODULES`（`node/esmForBrowser.ts`，生成代理模块），以及 zhinjs/console `client/main.tsx` 中的 `sharedModules.set(...)`（现在只注册了 React 和 React Router）。这样手写 `.tsx` 插件页拿到的就是 Console 已加载的那份组件和 CSS。插件在 `package.json` 中把它声明为 `peerDependencies`。
   **目前没有共享模块的版本握手**：`GET /console/capabilities` 只说明 RPC 能力；`buildHostProxyModule`（`esmForBrowser.ts:338-358`）对缺失的具名导出静默给出 `undefined`，模块未注册时退回插件自己的本地副本。所以本 ADR 新增一个机制：Console 在共享模块表中同时登记 `@zhin.js/console-ui` 的版本；代理模块拿它和插件 `peerDependencies` 中的版本范围比对，不满足时明确报错（主版本不兼容）或在控制台告警并在页面上提示（次版本偏低），缺少具名导出时报出导出名，不再静默降级。
4. **只给浏览器用。** 依赖（`radix-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`）只出现在这个包和 Console 里，不进 `zhin.js` 的依赖树，不影响 ADR 0019 的安装体积门禁。纯 `.ts` 蓝图插件仍然只依赖 `@zhin.js/console-contract`，不需要 React，也不需要这个包。
5. **文案与语言不依赖宿主。** Console 的 `confirm-dialog.tsx`、`empty-state.tsx`、`ui/dialog.tsx`、`ui/sheet.tsx` 用的是 Console 自己的 `useI18n`，`zk-` 用的是 `@zhin.js/client` 的 `useLocale`。`@zhin.js/console-ui` 自带一个语言与文案的 Provider（内置 zh-CN / en 默认文案，宿主可注入当前语言和覆盖文案）；Console 用自己的 i18n 接上它，组件内部不再直接引用任何宿主的 i18n。
6. **深浅色都要验收。** 包内带一组视觉回归用例（亮 / 暗主题各一张），覆盖按钮、输入框、下拉框、表格、对话框和页面外壳。

### 2. 插件页面必须使用统一的页面外壳

插件页面不再自己写页头和容器。**页面外壳由 Console 渲染**：标题、说明、操作区、刷新控件和内容宽度都由外壳决定，宽度用 `--console-content-max`，和 Console 自带页面完全一致。插件只提供内容区块（`Section`、表格、表单、统计卡片等）。

- **声明式页面自动获得外壳。** `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 改成只渲染内容区块，页头由外壳根据蓝图的 `title`、`description`、无表单的 `actions` 和刷新设置生成。首字母方块（`mark`）删除；蓝图中的 `mark` 字段在弃用期内忽略并告警。
- **已有先例**：Console 的 `pages/scope/adapter-page.tsx:70` 已经以 `<AdapterConsolePage adapterKey embedded refreshKey toolbar>` 嵌入适配器页，页头和宽度由 Console 负责（嵌入时用 `.zk-page--embedded`，`ui/styles.ts:102`，去掉自己的宽度和内边距）；`AdapterConsolePage` 用 `ADAPTER_CONSOLE_PAGE_CAPABILITIES = { embedded, toolbar, refreshKey }`（`AdapterConsolePage.tsx:216`、`:247`）声明支持这种嵌入。本 ADR 的外壳就是把这个做法推广到所有插件页面。
- **手写 `.tsx` 页面**的默认导出只渲染内容。需要页头操作或刷新控件时，调用 `@zhin.js/console-ui` 提供的 `usePageChrome({ actions, refresh })`，由外壳负责摆放（相当于把 `embedded` / `toolbar` / `refreshKey` 这组能力推广成通用接口）。插件自己写的 `<h1>` 或页头组件属于违规（见决策 4）。
- **刷新控件统一。** 一个 `RefreshControl` 组件：「更新于 hh:mm:ss」+ 自动刷新间隔（Radix 下拉，选项手动 / 5s / 15s / 30s）+ 刷新按钮。Console 自带页面需要刷新时用同一个组件。
- **宽度例外只有一个**：工作区类页面（目前只有 Sandbox 聊天）可以用已有的 `definePage({ fullWidth: true })` 占满内容区，但仍然使用外壳的页头。
- 和 ADR 0062 第 24 项配合：插件页面挂到插件详情下以后，外壳的标题区就是插件详情的标题区（插件名、说明、状态），插件页面是其中一个页签的内容；页面自己的 `title` 变成页签名。

### 3. 导航与命令面板

1. **插件页面按 ADR 0062 第 24 项挂到插件详情下**，路径为 `/plugins/<插件名>/<页面名>`，在插件详情页里显示为页签；适配器页面挂在对应的适配器对象页下（同样按第 24 项，界面由 Console 统一渲染）。
2. **顶栏「功能」菜单只列 Console 自己的功能页。** 修订 ADR 0052：插件页面不再按 `metadata.section` 落到顶栏分区；`placePluginRoute` 不再默认放进「功能」。ADR 0062 第 24 项已经写明插件页面「不在侧栏单独再开入口」，D6 只是把这一条落实到 ADR 0052 的放置规则上（ADR 0052 的状态行已注明被本 ADR 修订）。原来写了 `section` 的插件，弃用期内按插件详情页签处理并告警。
3. **命令面板按插件名、页面标题和别名搜索插件页面。** `definePage()` 增加 `keywords`（别名，可分语言），加在 `@zhin.js/console-contract` 的 `PageMetadata`（`packages/console/plugin-contract/src/page.ts`，和 `section`、`fullWidth` 放在一起），`@zhin.js/page` 的包装原样透传；插件页的命令面板条目包含插件名、包名、页面标题、插件说明和 `keywords`，分组为「插件」。插件页面必须注册具体路径，不能用 `:param` 路径，否则会被 `isCommandRoute` 排除。
4. **Sandbox 是唯一例外**：它是对话入口，继续通过 `navigation-taxonomy.ts` 的 `PLUGIN_PAGE_PLACEMENT` 留在顶栏「会话」分区（代码中为 `NAV_GROUPS.WORK`），不挂到插件详情下；其余插件页面都挂成插件详情页签。
5. 为避免旧书签失效，旧的顶层路径（例如 `/rss`）至少保留一个 minor 周期（和 `zk-` 一起删除），用重定向跳到新路径，并进入 `LEGACY_ROUTE_REDIRECTS`（命令面板因此不会重复显示）。

### 4. 约束手段

- **`zhin plugin check`** 新增三条检查，对插件的 `pages/**` 给出警告（不是错误）：
  1. 使用原生 `<select>`（JSX 中的 `<select`，或 `React.createElement('select')`）；
  2. 自定义页头：页面中出现 `<h1>`，或从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage`；
  3. 固定宽度：在页面根容器上写 `max-width` / `width` 的固定像素值，或在 `definePage` 之外自己设置内容宽度。
  P4 之后，第 2 条中「从 `@zhin.js/client/ui` 引入」会因为子路径被删除而直接构建失败；其余仍保持为警告，避免误伤第三方插件里的合理用法。这三条和 D20 的第 4–6 条一起在 P2 上线，对第三方插件始终只是警告。本仓库的官方插件在 CI 中把它们当作错误（`pnpm check:plugin`）：P2 之前只出报告，从 P2 起按插件逐个生效（见 D19「本仓库的官方插件」）。
- **文档只示范统一组件。** `docs/authoring/console-pages.md` 的「页面 UI 套件」一节改为介绍 `@zhin.js/console-ui` 和页面外壳；删除 `zk-` 写法的示例；新增「页面外壳负责什么、插件负责什么」一节，并按 ADR 0062 第 24 项增加「什么时候不该写插件页面」。`@zhin.js/client` README 中的 UI 套件清单改为指向新包。

### 5. 危险操作的样式

和 Console 一致：**页面上的危险操作按钮用描边样式**（`outline` 加 `text-destructive`），点击后弹出确认对话框；**实心红色按钮只出现在确认对话框的确认按钮上**。不可撤销的操作（删除数据、清空记录）沿用 Console 的 `confirmText`：要求输入对象名后才能确认。

- `@zhin.js/console-ui` 的 `Button` 增加 `variant="destructive-outline"`（等价于 Console 现在的 `outline` + `text-destructive`），Console 自带页面同步替换为这个变体。
- 蓝图中 `variant: 'danger'` 的动作一律渲染为描边按钮；若蓝图没有写 `confirm`，渲染器自动补一个默认确认文案（「确认<动作名>？」）。所以 RSS「移除订阅」这类按钮不需要修改插件就会改变样式。

### 6. 不在本 ADR 范围

- 插件页自身的信息设计（进程监控重复列数值、群管套件显示原始会话键、RSS 手填推送目标等）。这些由 #1262 和 ADR 0062 第 24 项的实施 PR 处理；本 ADR 只保证这些修复用统一组件来做。
- Console 业务页面自己的布局（例如数据库页、终端、Agent 工作台），只要它们用同一套组件和令牌即可。
- 新的设计语言或视觉改版。本 ADR 以 Console 当前的视觉为准（zhinjs/console#95 之后的版本），只做收敛。（增补修订：字号、间距、圆角、边框、阴影收敛到尺度属于范围内，见 D22。）

## 增补：设计规则（console#111）

增补日期：2026-11-14。来源：zhinjs/console#111（正文与两条补充评论：信息密度与视觉层级；响应式、弹性布局与间距；组件级的间距、边框、圆角、阴影）。所有者的指示是：这套规则覆盖整个 Console，**对 Console 自身是强制的**；插件页面**推荐**使用 Console 自己的、符合规则的组件，组合 `@zhin.js/console-ui` 的组件、继承它的令牌，这样自动符合类型尺度、间距、响应式和深浅色。插件可以超出组件库自己设计界面，但应当尽量遵守这些规则，只有一组很小的硬性底线（D19）必须遵守。以上分寸只针对第三方插件：**本仓库的官方插件必须完整遵守这些规则**，作为给开发者的参考实现（所有者决定，见 D19「本仓库的官方插件」）。

本增补新增 D15–D22，和前面的决策一样默认按推荐执行。实测数据、根因和各项取值的依据见 console#111，这里不再重复，只写规则本身；下文的「按尺寸取值」表是规范的一部分，所以保留。D15–D18 对 Console 自带页面、页面外壳和 `@zhin.js/console-ui` 是「必须」；对插件页面是「应当」（本仓库的官方插件是「必须」，见 D19）：使用组件库和页面外壳的插件页面（包括所有声明式页面）自动继承，不需要插件自己实现。

### 7. 信息呈现规则（D15）

适用于 Console 自带页面、页面外壳和 `@zhin.js/console-ui` 组件的默认行为：

1. **只在有话可说时才显示。** 空值、默认值和正常状态不显示或弱化显示（中性色文字，不用彩色徽标）；**彩色徽标只用于异常和需要处理的状态**。`@zhin.js/console-ui` 的状态徽标必须把「正常」渲染为弱化样式，页面不得用彩色徽标标记正常状态。
2. **说明文字只说一次。** 说明放在区块标题下或 `ⓘ` 提示里；同一段说明在一个页面里不得出现超过一次，不得在列表中逐行重复。
3. **列表默认用紧凑表格**，一行一个对象。
4. **只有图标的按钮必须有可见文字，或者收进「更多」菜单。** 页面操作和行内操作不得只放图标；一行有多个操作时，主操作带文字，其余收进「更多」。只有公认的、带 `aria-label` 的控件（对话框关闭、展开 / 折叠）可以只用图标。
5. **系统对象默认隐藏。** 插件的内部维护任务、系统心跳这类对象默认不显示，提供「显示系统对象」开关；**「全部」必须真的包含全部**，它的数量必须等于各页签数量之和。

### 8. 令牌三层与规范名（D16）

令牌分三层。**`@zhin.js/console-ui` 的组件只能使用第二层**，Console 自带页面只能使用组件和第二层；插件页面推荐同样做（D19）：

**第一层：基础尺度（全局只有这些值）**

| 类别 | 档位（规范名） | CSS 变量 |
| --- | --- | --- |
| 字号 | `label`、`body`、`section`、`title`、`display`，最多 5 级 | `--console-text-<档位>` |
| 字重 | `regular`、`medium`、`strong`，最多 3 种 | `--console-weight-<档位>` |
| 间距 | `space-1` … `space-8`（4px 基准，0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4rem） | `--console-space-1` … `--console-space-8` |
| 圆角 | `r-0`、`r-1`、`r-2`、`r-3`、`r-4`、`r-full` | `--console-radius-0` … `--console-radius-4`、`--console-radius-full` |
| 边框 | `hairline`（1px，所有分隔线和描边）、`focus`（2px，只用于焦点环） | `--console-border-hairline`、`--console-border-focus` |
| 层级（阴影） | `e-0` 无、`e-1` 悬停、`e-2` 下拉 / 弹出层、`e-3` 对话框 / 抽屉 | `--console-elevation-0` … `--console-elevation-3` |
| 断点 | `sm` 40rem、`md` 48rem、`lg` 64rem、`xl` 90rem | `--console-bp-<档位>`（媒体查询用生成的 `@custom-media --console-<档位>`） |
| 内容宽度 | `reading` 60rem（设置、表单、说明）、`data` 120rem（列表、表格、首页） | `--console-content-reading`、`--console-content-data` |

具体取值以 console#111 为准；字号和字重的取值在 P1 中从 Console 现有的 4 个字号令牌（label / body / section / title）出发确定，`display` 只给统计数值和页面主标题用。圆角不得再用「减 px」的 `calc` 写法。

**第二层：组件语义令牌（组件只能用这一层）**

`--console-page-padding-inline`、`--console-section-gap`、`--console-stack-gap`、`--console-card-padding`、`--console-card-radius`、`--console-card-elevation`、`--console-list-row-padding`、`--console-control-height`、`--console-control-radius`、`--console-badge-height`、`--console-badge-radius`、`--console-popover-radius`、`--console-popover-elevation`、`--console-dialog-radius`、`--console-dialog-elevation`、`--console-focus-ring`。新增组件需要新的语义令牌时，加在 `@zhin.js/console-ui` 里，不得在组件里直接写第一层的值，更不得写数字。

**第三层：按尺寸给第二层取值（规范）**

页面级令牌（页面边距、区块间隔）按视口取值；其余令牌由组件按**自己所在容器的宽度**取值（见 D18）。

| 语义令牌 | 小于 40rem | 40–64rem | 64rem 及以上 | 原则 |
| --- | --- | --- | --- | --- |
| `--console-page-padding-inline` | space-3 | space-4 | `clamp(space-4, 2.5vw, space-6)` | 小屏留出可用宽度，大屏连续增长 |
| `--console-section-gap` | space-4 | space-5 | space-6 | 屏越大，层级间留白越大 |
| `--console-stack-gap` | space-2 | space-3 | space-3 | 组内保持紧凑 |
| `--console-card-padding` | space-3 | space-4 | space-4（宽卡片 space-5） | 不超过区块间隔，保证「组内 < 组间」 |
| `--console-card-radius` | r-0（贴边铺满时）/ r-2 | r-3 | r-3 | 贴边卡片不要圆角 |
| `--console-card-elevation` | e-0，用 hairline 描边 | e-0 | e-0，悬停 e-1 | 静态卡片不用阴影 |
| `--console-list-row-padding`（上下） | space-3 | space-2 | space-2 | 手机加大行高，方便点击 |
| `--console-control-height` / `--console-control-radius` | 2.75rem / r-2 | 2.25rem / r-2 | 2.25rem（紧凑表格内 2rem）/ r-2 | 触控尺寸优先，圆角不随尺寸变 |
| `--console-badge-height` / `--console-badge-radius` | 1.25rem / r-full，hairline | 同左 | 同左 | 只此一种实现 |
| `--console-popover-radius` / `--console-popover-elevation` | 底部抽屉：上方 r-4、下方 r-0，e-3 | r-3，e-2 | r-3，e-2 | 手机上浮层贴底 |
| `--console-dialog-radius` / `--console-dialog-elevation` | 全屏或底部抽屉，r-4（仅上方） | 居中，r-4，e-3 | 居中，r-4，e-3 | |
| `--console-focus-ring` | focus 2px + 2px 外偏移 | 同左 | 同左 | 任何尺寸都必须看得见 |

**配套规则**（都是「必须」）：

- **嵌套圆角**：内层圆角 = 外层圆角 − 外层内边距，不小于 0。组件嵌套时由组件自己算，页面不得手写。
- **同一层级只用一种手段区分**：要么边框，要么阴影，不得叠加。深色主题统一用边框和背景明度；浅色主题的静态内容也优先用边框，阴影只给浮层。
- **同一类组件在同一宽度下只有一种取值**（卡片、按钮、输入框、徽标、弹层的圆角、边框、阴影）。
- **现有令牌改为别名。** `--console-radius-sm/md/lg`、`--console-shadow-*`（xs–xl、panel、hover、button）、`--console-space-page-*` / `--console-space-section` / `--console-space-stack` / `--console-space-card` 在弃用期内作为别名指向上面的新名字，和 `--zk-*` 一起在 P4 删除。`--console-content-max` 保留，作为外壳按页面类型解析出的当前内容宽度（`reading` 或 `data`），D4「宽度用 `--console-content-max`」不变。

### 9. 单一事实来源（D17）

1. **令牌只在 `@zhin.js/console-ui` 里定义一次。** 包里放一份令牌定义（格式在 P1 的实施 PR 中确定），由它**生成**：`tokens.css`（三层 CSS 变量和按尺寸取值的规则）、Tailwind 4 的主题文件（`@theme`）、断点的 `@custom-media`、stylelint 的允许值清单、`zhin plugin check` 的允许值清单，以及 Playwright 布局审计用的尺度清单。生成物不得手改。
2. **Console 也消费同一份令牌。** zhinjs/console 引入 `@zhin.js/console-ui` 的 `tokens.css` 和生成的 Tailwind 主题，自己不得再定义第一层或第二层令牌（D1 约束 2「令牌只有一份」在此具体化）。Console 业务页面需要的专用令牌只能由第二层派生，并放在 Console 自己的样式里。
3. **生成的 Tailwind 主题只暴露尺度内的值。** 默认的字号、字重、间距、圆角、阴影和断点被清空，只保留上面的档位：圆角 `0`–`4` 与 `full`，阴影 `e1`–`e3`，断点 `sm` / `md` / `lg` / `xl`，字号与字重按规范名。**间距不重新定义 Tailwind 的数字键，也不做类名改写**：8 档间距正好是 Tailwind 默认的 `1`、`2`、`3`、`4`、`6`、`8`、`12`、`16` 这 8 个键，生成的主题让 `padding`、`margin`、`gap`、`space-*` 只接受这 8 个键（取标准值）加 `0` 和 `px`，其他间距键（例如 `5`、`2.5`、`0.5`）不可用；任意值不由主题拦截，由 ESLint 禁止（D20）。尺寸类工具（`w-*`、`h-*`、`size-*`、`inset-*`、`min-*` / `max-*`）不受这一限制（例如 `h-11` 仍可用于 44px 触控尺寸），主题如何把它们和间距分开在 P1 确定。这样插件作者对 Tailwind 的直觉仍然成立，已经落在尺度上的现有类名不需要修改；尺度外的类名（例如 `p-5`、`gap-2.5`）在 Console 中是 lint 错误，在插件中是 `zhin plugin check` 的提示（D20）。对应关系：

   | 规范名 | CSS 变量 | 取值 | Tailwind 键（如 `p-*`、`gap-*`、`m-*`） |
   | --- | --- | --- | --- |
   | `space-1` | `--console-space-1` | 0.25rem | `1` |
   | `space-2` | `--console-space-2` | 0.5rem | `2` |
   | `space-3` | `--console-space-3` | 0.75rem | `3` |
   | `space-4` | `--console-space-4` | 1rem | `4` |
   | `space-5` | `--console-space-5` | 1.5rem | `6` |
   | `space-6` | `--console-space-6` | 2rem | `8` |
   | `space-7` | `--console-space-7` | 3rem | `12` |
   | `space-8` | `--console-space-8` | 4rem | `16` |

   注意规范名和 Tailwind 键从第 5 档起不同号（`space-5` 对应 `p-6`）：CSS 和文档里写规范名或 CSS 变量，Tailwind 类名写 Tailwind 键，生成物同时产出两者，不得手写换算。

### 10. 布局与响应式模型（D18）

1. **组件用容器查询，断点只给全局外壳。** 页头、表格、统计卡片、表单、列表 + 详情等组件用 `@container` 按自己拿到的宽度切换布局和第三层取值，不得看视口；`@media` 断点只用于全局外壳（顶栏折叠成菜单、页面级令牌）。插件页面不应当自己写断点，直接用组件即可获得容器查询。
2. **间距取自第三层。** 页面边距、区块间隔、组内间隔、卡片内边距、列表行内边距等都必须使用第二层语义令牌，取值以 D16 第三层「按尺寸取值」表为准，组件和页面不得另选档位；原则是控件内部 < 组内 < 卡片内边距 ≤ 区块间隔。不在 8 档内的间距在 Console 中不得出现（Tailwind 键见 D17 的对应表）。
3. **弹性优先。** 页面左右边距用 `--console-page-padding-inline`；内容宽度写作 `width: min(100%, var(--console-content-max))`，不得写 px 固定宽度；卡片网格用 `repeat(auto-fit, minmax(…, 1fr))`（由 `@zhin.js/console-ui` 的网格组件提供，手机上统计卡片两列并排）。
4. **两种内容宽度。** 阅读 / 表单页用 `reading`，数据页用 `data`；Console 自带页面在 P1 标注各自类型，所有页面默认 `data`（插件页面同样）。页面声明类型的方式（`definePage` 元数据字段）在 P1 和 `keywords` 一起确定，之前一律按 `data` 处理。
5. **宽屏双栏。** 容器宽度达到 `xl`（90rem）时，列表页改成「列表 + 右侧详情」双栏；由 `@zhin.js/console-ui` 的列表 + 详情组件实现，页面不得自己拼。
6. **窄容器下表格变卡片。** 表格所在容器窄于 `sm`（约 40rem）时，表格必须变成「每行一张卡片」或只显示优先列、其余列收进行展开，不得靠左右滑动；原始 ID、JSON 默认不显示。
7. **手机的硬性要求**：可点控件不小于 44×44px；页头放不下的操作收进「更多」菜单（由 `PageHeader` / `usePageChrome` 负责），任何控件都不得被挤出视口；任何宽度下都不得出现整页横向滚动。

### 11. 插件页面：推荐用组件库，只有一组很小的硬性底线（D19）

**推荐（应当）。** 插件页面（声明式蓝图、适配器页、评论审批页和手写 `.tsx`）应当使用 `@zhin.js/console-ui` 的组件和第二层语义令牌。理由：

- **一致**：和 Console 自带页面并排时，字号、间距、控件和危险操作的样式一样，用户看到的是一个产品；
- **免费获得规则**：组件已经实现了类型尺度、间距、容器查询（窄容器下表格变卡片、网格自适应）、触控尺寸、焦点环和深浅色，插件不需要自己处理，Console 以后调整令牌时插件页面也会跟着变。

偏离推荐的常见写法（`zhin plugin check` 会给出提示，见 D20）：写原始的 `font-size`、`font-weight`、`border-radius`、`box-shadow`、`padding`、`margin`、`gap` 数值；Tailwind 任意值（`p-[…]`、`rounded-[…]` 等）或默认 `shadow-*`；用原生 `<button>`、`<input>`、`<select>`、`<textarea>`、`<table>`、`<dialog>` 代替对应组件；自己写断点。组件库缺少需要的组件时，欢迎向 `@zhin.js/console-ui` 提需求或 PR。

**允许自定义。** 插件可以超出组件库，自己设计界面（例如 Sandbox 这类工作区页面、图表、画布、游戏），但应当尽量遵守 D15–D18，并优先使用语义令牌而不是自己的数值。D13 中 Sandbox 自带的样式属于这种情况，不需要白名单；但 Sandbox 是官方插件，按下文「本仓库的官方插件」，它在 D13 的两步完成后加入 CI 门禁，此后自带样式同样要通过第 1–6 条（工作区页面确需的个别写法只能逐条豁免）。

**硬性底线（必须）。** 无论是否使用组件库，插件页面都必须满足下面几条，因为违反它们会破坏外壳或让用户无法使用：

1. 任何宽度下都不得出现整页横向滚动（页面内部的局部滚动区域可以有）；
2. 内容不得溢出页面容器，不得覆盖 Console 的外壳（顶栏、导航、页头、全局浮层），包括不得使用高于外壳的 `z-index` 或 `position: fixed` 盖住外壳；
3. 可交互元素获得焦点时必须有可见的焦点样式；
4. 手机宽度下可交互控件的触控尺寸不得小于 44×44px；
5. 背景与文字必须使用 Console 主题令牌，在深浅两种主题下都可读；不得写死只适合一种主题的颜色。

外壳负责尽量兜底（插件内容区作为独立的层叠上下文，`isolation: isolate`，并约束内容区宽度），但兜底不能替代插件自己遵守底线。

上面的「推荐 / 允许自定义 / 硬性底线」是对第三方插件的要求。

**本仓库的官方插件：完整遵守全部规则（所有者决定，2026-11-14）。** 所有者的原话是「官方插件肯定要遵守规则的，我们都不遵守，还怎么推荐给开发者呢」。所以 `plugins/**` 下的官方插件页面是给开发者的参考实现，D15–D19 对它们和对 Console 自身一样是「必须」，不是「应当」：

1. **CI 中为错误的检查**：D8 的第 1–3 条（原生 `<select>`、自定义页头、固定宽度）、D20 的第 4–6 条（原始样式数值、尺度外的 Tailwind 类名、非组件库的基础控件）和 Playwright 的全项审计（D20 第 3 条的全部检查项：D15–D18 的类型尺度、间距尺度、圆角 / 边框 / 阴影取值、响应式各项，以及 D19 的硬性底线），在 zhinjs/zhin CI 中对官方插件都是**错误**，不通过即失败。官方插件页面和 Console 自带页面一样按全项门禁处理。
2. **分阶段**：相关工具上线、官方页面迁移完成之前只出报告。`zhin plugin check` 第 1–6 条和 zhinjs/zhin CI 中的 Playwright 全项审计在 **P2** 上线（插件页面在 P2 迁移到 `@zhin.js/console-ui`）；某个官方插件的页面迁移完成后，它就加入门禁名单，上面这些检查对它由只出报告改为 CI 错误；P2 验收时所有官方插件都在门禁名单中。P4 不改变这个门禁。
3. **例外**：默认没有例外。官方插件只能对某一条具体检查豁免，而且必须写在源码中被豁免的位置，用带说明的忽略注释写明检查项和理由（例如「忽略第 6 条：画布内的原生 `<button>`，焦点和触控尺寸已自行满足底线」），随 PR 一起评审；不接受按插件或按文件整体关闭检查。CI 摘要列出所有豁免。注释的具体写法（以及 Playwright 全项审计的豁免如何标注）在 P2 确定，保持最小。

第三方插件不受这一条影响：第 1–6 条对它们始终只是提示，硬性底线是「必须」，但除提示外没有强制手段。

### 12. 约束手段（D20）

在 D8 的基础上增加三处，规则的允许值都来自 D17 生成的同一份清单：

1. **zhinjs/console 与 `@zhin.js/console-ui`：stylelint 和 Tailwind 主题（Console 中违反即为错误）。** stylelint 禁止 `font-size`、`font-weight`、`border-radius`、`box-shadow`、`border-width`、`padding`、`margin`、`gap` 写字面值（`0` 和 `var(--console-…)` 除外）、禁止不在 `@custom-media` 清单里的媒体查询、只允许外壳文件写 `@media`；生成的 Tailwind 主题把 `padding`、`margin`、`gap`、`space-*` 限制在 8 个间距键加 `0` 和 `px`，并只保留尺度内的圆角、阴影、字号、字重和断点；任意值（`p-[…]` 等）不由主题拦截，由 ESLint 禁止，ESLint 同时禁止 Tailwind 默认 `shadow-*` 和尺度外的间距类名（例如 `p-5`、`gap-2.5`）。尺寸类工具（`w-*`、`h-*`、`size-*`、`inset-*`、`min-*` / `max-*`）不受间距尺度限制，例如 44px 触控尺寸用的 `h-11` 仍然可用；主题如何把它们和间距分开在 P1 确定，但这一要求现在就定下。两个仓库的 CI 都跑。
2. **`zhin plugin check` 新增三条提示（接在 D8 的三条之后）**，检查插件的 `pages/**`。`zhin plugin check` 对这三条**只给提示（警告），永远不会升级为错误**，也不阻止插件的构建和发布（本仓库官方插件的 CI 另行把它们当作错误，见下）；每条提示都说明它的含义和对齐方法：
   4. **原始样式数值**：`style` 属性、CSS 文件或 CSS-in-JS 中，字号、字重、圆角、阴影、内边距、外边距、间隔写了字面值。含义：这个值不跟随 Console 的尺度和按尺寸取值，换设备或 Console 调整令牌时会和周围不一致。对齐：改用对应组件，或改用第二层语义令牌（例如 `var(--console-card-padding)`）。
   5. **尺度外的 Tailwind 类名**：任意值（`p-[…]`、`rounded-[…]`、`text-[…]` 这类）、尺度外的间距键（例如 `p-5`、`gap-2.5`）或 Tailwind 默认的 `shadow-*`。含义同上。对齐：改用生成主题中的档位（间距键 `1`、`2`、`3`、`4`、`6`、`8`、`12`、`16`，见 D17 的对应表；圆角 `0`–`4` / `full`；阴影 `e1`–`e3`），或改用组件。
   6. **非组件库的基础控件**：JSX 中的原生 `<button>`、`<input>`、`<textarea>`、`<table>`、`<dialog>`（`<select>` 已由 D8 第 1 条覆盖）。含义：这些控件没有 Console 的触控尺寸、焦点环、深浅色和窄容器下的布局切换，需要插件自己保证 D19 的底线。对齐：换成 `@zhin.js/console-ui` 的 `Button`、`Input`、`Textarea`、`Table`、`Dialog`；确实要自定义时，第三方插件可以忽略这条提示，但要自己满足底线；官方插件只能用写明检查项和理由的行内忽略注释豁免（见 D19）。
   这三条在 P2 上线（那时 `@zhin.js/console-ui` 已发布、有可替换的组件）。硬性底线（D19）大多只能在运行时判断，静态检查不覆盖，由 zhinjs/zhin CI 中的 Playwright 全项审计检查官方插件页面（见第 3 条）；`zhin plugin check` 只在能静态识别时（例如写死的 `position: fixed` 加大 `z-index`）给出提示。

   **本仓库的官方插件**：D8 的第 1–3 条、这里的第 4–6 条和第 3 条 Playwright 审计的全部检查项（D15–D18 各项与 D19 的硬性底线）在 CI 中都是**错误**，不通过即失败；P2 之前只出报告，从 P2 起官方插件的页面迁移完成一个就加入门禁一个，P2 验收时全部生效；豁免只能是带理由、经评审的行内忽略注释（见 D19「本仓库的官方插件」）。CI 在运行摘要中按插件和规则列出违规与豁免。
3. **Playwright 布局审计，分两处跑。** 都在 375 / 768 / 1280 / 1920 四个宽度、深浅两种主题下逐个元素读取计算样式：
   - **zhinjs/console 的 CI** 审计 Console 自带页面，检查下面全部各项；
   - **zhinjs/zhin 的 CI**（官方插件在这个仓库）审计官方插件的 Console 页面，和 Console 自带页面一样检查下面全部各项并作为全项门禁：P2 之前只出报告，从 P2 起官方插件迁移完成一个就加入门禁一个，不通过即为 CI 错误，P2 验收时全部官方插件都在门禁中（见 D19「本仓库的官方插件」）。

   检查项：
   - 字号不超过 5 种、字重不超过 3 种，且都在尺度内；`padding`、`gap`、`border-radius`、`box-shadow`、`border-width` 的计算值都在基础尺度内；
   - 同一类组件在同一宽度下圆角、边框、阴影只有一种取值；
   - 没有被挤出视口的元素，没有整页横向滚动；375px 下没有小于 44px 的可点控件，贴边卡片没有圆角，静态卡片没有阴影，下拉和对话框以底部抽屉出现；
   - 1920px 下数据页内容宽度占视口 85% 以上，阅读 / 表单页行宽不超过 60rem；
   - 同一段说明文字在一个页面里不超过一次（文本去重统计）。
   审计在 P1 上线：对 `@zhin.js/console-ui` 的组件示例页立即作为门禁，对 Console 页面先只出报告；zhinjs/zhin CI 对官方插件页面的审计在 P2 上线，迁移完成前同样只出报告；Console 页面每完成一页收敛就加入门禁名单，P4 结束时所有 Console 页面都必须通过全部各项；官方插件页面从 P2 起逐个加入全项门禁，P2 验收时都必须通过全部各项（zhinjs/zhin CI 错误）。

### 13. 与分阶段计划的对应（D21）

令牌工作并入 P1，和抽包一起做，但**分成两个 PR**，保住 P1a「外观不变」的验收：

- **P1a 抽包**：即原 P1，只迁移、不改样式，视觉回归无差异。
- **P1b 令牌与组件规则**：在 `@zhin.js/console-ui` 中建立三层令牌和单一事实来源（D16、D17），生成 Tailwind 主题（间距只保留与 8 档对应的 8 个 Tailwind 键，不做类名改写，尺度外的现有类名由 lint 报出后逐个改正）；组件实现容器查询、按尺寸取值、表格变卡片、底部抽屉、44px 触控尺寸、弱化的正常状态徽标、「更多」菜单、网格和列表 + 详情组件（D15、D18）；zhinjs/console 与 `@zhin.js/console-ui` 的 stylelint / ESLint 上线；Playwright 审计上线（组件示例页为门禁，页面只出报告）。这一步**有意改变外观**：视觉回归的基线逐页评审后更新，不得整体一键接受。它同时修好所有「只因为没用令牌」的问题：类型尺度、间距、圆角、阴影、页面边距、内容宽度、页头被挤出视口。

页面收敛按阶段分配：

| 阶段 | 页面收敛 |
| --- | --- |
| P1b | 所有页面的全局项：类型尺度、间距、圆角、边框、阴影、页面边距、两种内容宽度（Console 页面标注 `reading` / `data`）、触控尺寸、页头「更多」菜单 |
| P2 | 插件页面（随渲染器迁移自动获得）：统计卡片弹性网格、窄容器下表格变卡片、原始 ID 和 JSON 默认隐藏（群管套件等，信息设计本身仍按 #1262）、Sandbox 页头不被挤出屏幕；`zhin plugin check` 第 1–6 条上线（对第三方插件只提示）；官方插件页面迁移完成后逐个加入门禁，第 1–6 条和 zhinjs/zhin CI 中的 Playwright 全项审计对它们由只出报告改为 CI 错误，P2 验收时全部官方插件在门禁中。Console 页面：AI 与模型（模型页改表格、未被引用的模型合并成可折叠分组、用途页先显示在用的用途、未设置的决策槽收进「高级」、宽屏列表 + 详情双栏） |
| P3 | 定时任务（用户任务与系统任务分开、系统任务默认折叠、类型如实显示、「全部」包含助手任务）；插件页（与插件详情页签一起，按 `console-plugins-page-layout` 执行）；首页（按 `console-dashboard-feed` 执行） |
| P4 | 删除旧令牌别名（与 `--zk-*` 一起）；zhinjs/console CI 的审计对所有 Console 页面作为全项门禁；官方插件的门禁（第 1–6 条与 Playwright 全项审计，自 P2 起，zhinjs/zhin CI）不变；`zhin plugin check` 对第三方插件仍然只是提示 |

### 14. 对前文的修订（D22）

- **决策 6「不在本 ADR 范围」**：「新的设计语言或视觉改版」仍不在范围内——颜色和组件外形以 Console 当前视觉为准；但字号、字重、间距、圆角、边框、阴影的**收敛到尺度**属于本增补的范围。「Console 业务页面自己的布局」仍由 Console 决定，但必须遵守 D15–D19。「插件页自身的信息设计」仍由 #1262 和 ADR 0062 第 24 项处理，修复应当遵守 D15。
- **D8**：D8 第 1–3 条的检查内容不变，对第三方插件仍是警告。官方插件完整遵守全部规则（所有者决定，见 D19「本仓库的官方插件」）：D8 第 1–3 条、D20 第 4–6 条和 Playwright 全项审计（D15–D18 各项与 D19 底线）对官方插件都是 CI 错误；它们和第 4–6 条一起在 P2 上线（原计划 D8 的三条检查在 P4 上线），P2 之前只出报告；豁免只能是带理由、经评审的行内忽略注释，默认没有。
- **D4 与 D19 的关系**：页面外壳仍是插件页面的必选项（D4 不变）；D19 放宽的是外壳内部内容区的样式。
- **背景第 1 节「本 ADR 不规定具体宽度」**：改为由 D16 规定两种内容宽度（`reading` 60rem、`data` 120rem）；`--console-content-max` 不再是固定的 90rem，而是外壳按页面类型解析出的值；D20 的审计按这两个宽度检查（1920px 下数据页占视口 85% 以上）。
- **分阶段计划**：P1 拆成 P1a / P1b（D21）；P1 的验收「Console 自带页面外观不变」只适用于 P1a。

## 增补：色板角色与信号色（console#125）

增补日期：2026-11-16。来源：zhinjs/console#125（Console 视觉方向与质感）。所有者定下的方向：**安静的中性底色 + 一种品牌色 + 明亮但少用的信号色，数字是主角**。本节只写组件库（`@zhin.js/console-ui`）一侧的规则：色板角色、信号色、主按钮、动效和数字；空状态、字体加载、表面层级、导航宽度等由 zhinjs/console 按 #125 的后续阶段处理。本节修订决策 6 与 D22「颜色以 Console 当前视觉为准」：颜色角色从此由本节规定。

### 15. 色板角色（D23）

每个角色一个令牌，组件只读角色，不写色值。品牌、信号与图表令牌在 `tokens/tokens.mjs` 的 `color` 中定义（深浅两套，与配色无关），生成到 `tokens.css` 的 `--console-*`（HSL 三元组，`hsl(var(--console-brand) / 0.1)` 可带透明度），Tailwind 主题同名提供 `bg-brand`、`text-brand-text`、`bg-signal-danger-fill` 等类。

| 角色 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `neutral`（`--background`、`--card`、`--border`、`--foreground` 等） | 底、面板、分隔线、正文、次要文字 | 保留现有灰阶，色相随配色轻微偏移 | 同左 |
| `brand` | 品牌标、每个视图唯一的实心主按钮的底色 | `#76EEC6`（`160 78% 69.8%`） | `#7FFFD4`（`159.8 100% 74.9%`） |
| `brand-foreground` | 品牌底上的文字与品牌标的 Z | `160 80% 10%`（深青绿，10.46:1） | `160 80% 10%`（12.11:1） |
| `brand-text` | 品牌色当文字或细线用：链接、焦点环、选中态（复选、单选、开关、下拉勾选、输入框焦点边框）、浅色下主按钮的描边 | `160 84% 25%`（在所有浅色表面上 ≥ 5.09:1） | 与 `brand` 相同，`#7FFFD4` |
| `brand-tint` | 安静的品牌底（选中行、按下的筛选卡片） | `160 60% 94%` | `160 40% 14%` |
| `signal-{danger,warning,success,info}-fill` | 只用于状态：圆点、进度条、仪表、图标、徽标底色；不当文字 | 见下表 | 见下表 |
| `signal-{danger,warning,success,info}-text` | 状态文字（≥ 4.5:1） | 见下表 | 见下表 |
| `chart-1…8`、`chart-other` | 一切数据可视化；与配色无关 | 见下表 | 见下表 |

品牌色是所有者 2026-11-16 的决定（原定 `#237A57` / `#4FBF8B`，因太暗改为 `#76EEC6` / `#7FFFD4`）。品牌值**与配色无关**，8 种配色下都一样，只随深浅主题变化；品牌标在任何配色下不变色。这两个颜色很亮，不能直接当文字或细线放在白底和浅底上，所以另设 `brand-text`；也不能配白字，主按钮和品牌标上的文字用 `brand-foreground`。

信号色（HSL）：

| 信号 | 浅色 fill | 浅色 text | 深色 fill | 深色 text |
| --- | --- | --- | --- | --- |
| danger | `0 76% 54%` | `0 76% 40%` | `0 76% 58%` | `0 76% 70%` |
| warning | `38 92% 50%` | `38 92% 26%` | `38 92% 52%` | `38 92% 62%` |
| success | `145 60% 40%` | `145 60% 25%` | `145 60% 44%` | `145 60% 58%` |
| info | `217 84% 56%` | `217 84% 42%` | `217 84% 62%` | `217 84% 72%` |

图表色（HSL）：

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 浅色 | `217 74% 50%` | `32 94% 42%` | `164 72% 32%` | `330 66% 48%` | `262 56% 56%` | `48 92% 32%` | `192 80% 38%` | `8 66% 46%` | `220 6% 58%` |
| 深色 | `217 80% 66%` | `32 92% 58%` | `164 60% 48%` | `330 72% 62%` | `262 70% 74%` | `48 86% 56%` | `192 70% 52%` | `8 72% 64%` | `220 6% 50%` |

旧名保留并指向新角色：`--destructive`、`--success`、`--warning`、`--info` 等于对应的 `signal-*-text`，`--chart-*` 等于 `--console-chart-*`，`--ring` 等于 `brand-text`；`--primary`、`--primary-action` 仍跟随配色（`soft` 按钮、链接以外的强调）。

### 16. 信号色规则（D24）

1. 信号色只用于状态。每个信号分 `fill`（明亮，用于填充、图形、徽标底色）和 `text`（文字）两个值；**一值不再两用**。
2. 同一信号在深浅主题下**色相与饱和度相同，只调亮度**；`text` 压到对比度 ≥ 4.5:1（浅色下在卡片、页面底、浮层和它自己的徽标底色上都满足）。警告填充为琥珀 `hsl(38 92% 50%)`，浅色下亮度 ≥ 45%，不再是发褐的 `32 80% 30%`。
3. **稳态不用信号色**：运行中、已连接、成功、已完成、失败数为 0。`StatusBadge` 的 `ok` / `neutral` 与 `Badge variant="success"` 是弱化文字；`StatCard` 的数值为 0（`0`、`'0'`、`'0.0'`、`'0%'`）时忽略 `tone`。
4. **「失败」「已拒绝」比「成功」醒目**：danger 徽标描边更深、字重为 `strong`；`StatCard tone="danger"` 的卡片另有 danger 描边。
5. 图表一律用 `chart-*`：与配色无关，相邻两色在深浅主题下 CIEDE2000 ΔE ≥ 20；两组数据永远是两种色相（首页「收到 / 发出」= `chart-1` / `chart-2`）。

### 17. 主按钮与危险按钮（D25）

- `Button variant="primary"`：`brand` 底 + `brand-foreground` 字（浅色 10.46:1、深色 12.11:1）。**每个视图最多一个** `primary`（登录、保存、发送、筛选这类「下一步」）；`PageAction` 的 `tone: 'primary'` 渲染为它，非危险的 `ConfirmDialog` 确认按钮也用它。
- 与其他按钮底色的亮度差：深色主题 ≥ 30（CIE L*，实测最小 68.9）。浅色主题做不到：`#76EEC6` 本身很亮（L* 86.6），与白色的 `outline` 只差 13.5（相对亮度差 30.9%），与配色浅色调的 `soft` 只差 7.3（15.7%）。因此浅色下主按钮加一圈 `brand-text` 70% 的描边（在卡片上 3.16:1，满足非文字 3:1），靠「实心彩色 + 深色描边」与其他按钮区分。
- 原来的 `default`（配色浅色调）改名 `soft`；`default` 作为弃用别名保留到 P4，外观与 `soft` 相同，仍是默认变体。
- `destructive` 平时是**幽灵样式**（红字、无底，悬停时淡红底）；`destructive-outline` 保留（描边 + 红字，决策 5）；**实心红色 `destructive-solid` 只用于确认对话框的确认按钮**，`ConfirmDialog variant="destructive"` 使用它。确认对话框以外不出现实心红色按钮。
- 焦点环是 `brand-text`（2px，偏移 2px），与配色无关。

### 18. 动效与数字（D26）

- 时长只有三档：`--console-motion-fast` 120ms（悬停、按下、颜色变化）、`--console-motion-base` 200ms（展开、弹层、toast）、`--console-motion-slow` 280ms（抽屉、页面切换）；缓动统一用 `--console-ease-out`（`cubic-bezier(0.25, 1, 0.5, 1)`）。Tailwind 的 `transition-*` 默认时长与缓动也指向这两个令牌。`--console-duration-fast`（原 150ms）、`--console-duration-page` 改为 `motion-fast` / `motion-base` 的弃用别名，保留到 P4。
- stylelint 新规则 `console/motion-tokens`：`transition`、`animation` 及其 `-duration` / `-delay` / `-timing-function` 不得写死时长（`150ms`、`0.2s`）或缓动（`ease`、`cubic-bezier(…)`）；`prefers-reduced-motion: reduce` 下的重置除外。`createConsoleStylelintConfig({ motionTokens })` 可在迁移期间降为 `'warning'`。
- `styles.css` 的基础层在根上设置 `font-variant-numeric: tabular-nums`：统计数字、版本号、时间戳上下对齐，不再逐处添加。

### 19. 品牌标（D27）

`BrandMark` 是 Console favicon 的形状（圆角方块、Z、圆点），颜色固定为 `brand` / `brand-foreground`，与配色无关；可带产品名「Zhin Console」（`CONSOLE_PRODUCT_NAME`），尺寸 `sm` 20px / `md` 28px / `lg` 40px 或像素值。Console 的顶栏、登录页、设置向导改用它（zhinjs/console 的实施 PR）。

### 20. 校验

`packages/console/ui/tests/contrast.test.ts` 在 8 种配色 × 深浅主题下检查：主按钮文字对比度 ≥ 4.5:1 与底色亮度差（见 D25）、浅色主按钮描边 ≥ 3:1、`brand-text` 在所有表面 ≥ 4.5:1、信号文字在表面与徽标底色上 ≥ 4.5:1、`destructive-solid` ≥ 4.5:1、信号色深浅同色相同饱和度、图表色相邻 ΔE ≥ 20（实测浅色最小 23.6、深色最小 21.8，任意两色最小 16.7 / 18.7）且在卡片上 ≥ 3:1。

## 增补：空状态、表单控件、图标与焦点（console#125 第三阶段）

增补日期：2026-11-16。来源：zhinjs/console#125 第三阶段（第 7–12 条）。本节只写组件库一侧：组件库提供空状态、ghost 控件、日期选择、代码标识和图标规则；字体文件的加载、表面层级、找不到页面的整页、⌘K 和 toast 由 zhinjs/console 实施。Console 要等 `@zhin.js/console-ui` 下次发版后才能用上本节的组件。

### 21. 空状态（D28）

1. `EmptyState` 的结构固定为：**一张 64px 线稿插画（或图标）+ 一句说明 + 至多一个操作**。插画统一 1.5px 描边（任意尺寸下都保持 1.5px）、不填充、单色 `brand-text`（`currentColor`），是 SVG 组件 `EmptyIllustration`。
2. 插画用 `illustration` 选择，首批 7 张：`messages`（无消息）、`tasks`（无任务）、`logs`（无日志）、`table`（未选中数据表）、`record`（未选中记录）、`not-found`（找不到页面）、`generic`（通用空）；清单是 `EMPTY_ILLUSTRATIONS`。紧凑模式（`compact`）下为 48px。
3. 只给插画、不给 `title` / `description` 时，用该插画的默认说明（如「还没有任务」「在左侧选择一个数据表」「找不到这个页面」）；**不再单独显示「暂无数据」**：只给了 `title` 时只显示标题，什么都不给时显示「这里还没有内容」（`empty.noData` 的新文案）。
4. `action` 渲染为一个 `Button`，默认 `soft`，可选 `primary`（仍受「每个视图最多一个 `primary`」约束，D25）；给 `href` 时渲染为链接；也可以直接传一个元素。
5. 向后兼容：原有属性（`icon`、`title`、`description`、`compact`、`className`）不变。没传 `illustration` 时仍用原来的图标，但不再是 `opacity 0.3` 的灰图标，而是与插画相同的 `brand-text`、1.5px 描边。
6. Console 的 `StatusState kind="empty"` 与找不到页面的整页（标题「找不到这个页面」、访问的地址、「返回首页」与「打开 ⌘K 搜索」）由 zhinjs/console 改用本组件实现。

### 22. ghost 控件与日期选择（D29）

1. `Input`、`Textarea`、`SelectTrigger` / `SelectField`、`SearchableSelectField`、`DateField`、`DateTimeField` 接受 `variant="ghost"`：平时无边框、无底色，悬停、聚焦或展开时才出现边框（聚焦为 `brand-text`）。用于次要字段（备用模型、未设置的决策槽），让长表单不再是一面「框墙」；主字段仍用默认样式。类型 `ControlVariant`。
2. 新增 `DateField`（值 `YYYY-MM-DD`）与 `DateTimeField`（值 `YYYY-MM-DDTHH:mm`），替代浏览器原生的 `date` / `datetime-local` 输入框。值是本地时间的 ISO 8601 字符串（与原生输入框的值格式相同，迁移时不用改数据），空值为 `''`；带时区的值（`Z`、`+08:00`）按本地时间显示，改动后输出不带时区的本地值。
3. 实现基于 `Popover` + 一个简单的月历（grid 模式），不引入日期库。键盘：触发器上 Enter / Space / ↓ 打开，Delete / Backspace 清空；月历里 ← → ↑ ↓ 按天 / 周移动，Home / End 到本周首尾，PageUp / PageDown 按月（加 Shift 按年），Enter / Space 选中，Esc 关闭；`DateTimeField` 的时、分输入框支持 ↑ ↓ 调整。`clearable`（默认开）显示清除按钮；`min` / `max` 之外的日期不可选；`weekStartsOn` 默认 zh-CN 周一、en 周日。纯函数（`parseDateValue`、`parseDateTimeValue`、`formatDateValue`、`formatDateTimeValue`、`calendarMonth`、`addDays`、`addMonths`）一并导出。

### 23. 图标（D30）

1. 组件库内只用 lucide 图标，统一 `strokeWidth 1.75`（`CONSOLE_ICON_STROKE_WIDTH`）；尺寸：控件里 16px，导航 18px（`CONSOLE_ICON_SIZE`）。组件库渲染使用方传入的图标（`StatCard`、`PageAction`、`EmptyState` 的 `icon`）时也按此描边；空状态的插画与图标例外，为 1.5px（D28）。宿主可以用 lucide 的 `LucideProvider strokeWidth={1.75}` 让自己的图标一致。
2. **列表、⌘K、工具栏不把图标放在浅色方块里**，图标直接放在表面上；只有导航可以带底。确认对话框的信号图标保留浅色底（它不是列表、⌘K 或工具栏）。

### 24. 代码标识（D31）

包名、RPC 名、ID、cron 表达式这类行内短标识用 `InlineCode`（或 `console-code` 类）：`--console-font-mono` 等宽字体，默认极浅底色（前景色 5%），`tone="plain"` 无底色，**不加边框**。`CodeText` 与它外观相同。

### 25. 焦点环与动效（D32）

1. 组件库里所有组件的焦点环只在 `:focus-visible` 时出现（`brand-text`，D25）。鼠标点开再关闭 `Dialog`、`DropdownMenu`、`Select`、`DateField` 后，焦点回到触发器但不出现焦点环；键盘操作仍然有焦点环。文本输入框聚焦时总有焦点环（浏览器规则，这是预期）。视觉回归用例 `mouse interaction leaves no focus ring` 检查这一点。
2. 组件库的所有动画（抽屉滑入、手机宽度下的底部抽屉、骨架屏闪光）只在 `prefers-reduced-motion: no-preference` 下运行；`reduce` 下的重置同时停止过渡。
3. 组件库没有 toast 和 Command（⌘K）组件：toast 的进出场动画（从右下滑入 8px + 淡入 `motion-base`，退出淡出 `motion-fast`，包在 `no-preference` 里）与 ⌘K 输入框去掉内层边框由 zhinjs/console 实施，规则同本条。

### 26. 字体（D33）

组件库**不打包字体**。令牌定义字体栈：`--console-font-sans` 以 Inter 优先、`--console-font-mono` 以 JetBrains Mono 优先，之后回退到系统字体（中文用系统字体）。宿主负责用 `@font-face` 加载 Inter 与 JetBrains Mono（Console 自托管拉丁 + 数字子集，`font-display: swap`）；没有加载时，组件按字体栈回退，布局不依赖具体字体。

## 增补：柔光卡片设计规范（@zhin.js/console-ui 1.3.0）

增补日期：2026-11-27。来源：「柔光卡片」设计包（`README.md` 规范全文、`tokens.json` 唯一数值来源、`components.css` 的 `sc-` 组件）与 Console 组件设计稿（`CFoundations`、`CButtons`、`CForms`、`CLists`、`CFeedback`、`CLayout`、`CPluginPage` 等）。所有者已批准 `@zhin.js/console-ui` 发 minor（1.2.x → 1.3.0）。本节**修订** D16（字号上限）、D23–D25（品牌色当主按钮、信号色规则）、D28（空状态外观）、D32（焦点环颜色）的相应条款，修订处见第 36 条；其余规则（三层令牌、单一事实来源、容器查询、硬性底线、lint 与审计的门禁方式）不变。

五条原则（设计包第一节）：**主色只有黑和白**；**彩色只给内容，而且要浅**；**不用蓝紫色**；**组件自己说清作用**（名字、单位、当前值、状态词，不在组件下加解释小字）；**文案要短**。

### 27. 颜色（D34）

1. 设计包 `tokens.json` 的颜色并进 `tokens/tokens.mjs`：`palette`（浅色、深色各一套：`bg`、`surface`、`sunken`、`raised`、`line`、`control`、`ink`、`muted`、`faint`、`primary`、`on-primary`、`primary-hover`、`primary-soft`、`primary-line`、`focus`、`tint-1`…`tint-5`、`accent-1`…`accent-5`、`ok`、`ok-bg`、`warn`、`warn-bg`、`danger`、`danger-bg`、`danger-solid`、`on-danger-solid`、`progress`、`inverse`、`on-inverse`）与 `paint`（`scrim`、`gradient-hero`、`gradient-hero-2`、`hero-overlay`、`aurora-1`…`4`、`aurora-opacity`）。源里写十六进制（和设计包逐字相同），生成器写成 HSL 三元组 `--console-<名>`，所以 `hsl(var(--console-ink) / 0.04)` 可以带透明度；Tailwind 主题提供 `bg-surface`、`bg-sunken`、`text-ink`、`bg-tint-2`、`text-accent-2`、`bg-ok-bg`、`bg-danger-solid`、`bg-primary-soft` 等类（`bg`、`muted`、`primary` 三个名字 shadcn 已经占用，见第 2 条）。
2. **已有名字映射到新颜色，但要等 Console 删掉自己的覆盖才生效**：`tokens/colors.css` 只剩一张映射表，把 Console 和插件已在用的 shadcn 式名字指向新颜色——`--background`→`bg`、`--foreground`→`ink`、`--card`→`surface`、`--popover`→`raised`、`--primary`→`primary`（黑 / 白）、`--primary-foreground`→`on-primary`、`--secondary` / `--muted` / `--primary-action`→`sunken`、`--muted-foreground` / `--tab-inactive`→`muted`、`--accent` / `--selected`→`primary-soft`、`--border`→`line`、`--border-strong`→`primary-line`、`--input`→`control`、`--ring`→`focus`、`--destructive`→`danger`、`--success`→`ok`、`--warning`→`warn`、`--info`→`ink`、`--sidebar*` 与 `--im-*` 同理（完整表见 `colors.css`）。仍是 HSL 三元组。**这不等于「Console 和插件页面不改代码就换外观」**：Console 自己的 `theme-tokens.css` 与 `design-system.css` 在 `@zhin.js/console-ui` 之后加载，同名变量（调色板、`--console-*` 尺寸令牌）以 Console 的为准。Console 按第 37 条删掉这些覆盖之后，Console 页面和只读这些名字、不自带颜色的插件页面才会换上新外观；在那之前，Console 里看到的仍是旧调色板，只有直接读 Console 没有覆盖的 `--console-<色板名>`（如 `console-tile` 的 `--console-tint-*` / `--console-accent-*`）的部分是新颜色。
3. `data-palette`（D23 的 8 种配色）**不再改变任何颜色**：柔光卡片的配色是固定的暖灰 + 黑白，没有蓝紫。属性留着无害，Console 的配色选择器应当移除（第 37 条）。
4. 品牌色 `brand` / `brand-foreground`（所有者 2026-11-16 定的 `#76EEC6` / `#7FFFD4`）只用于 `BrandMark`，**不再是主按钮的底色**；`brand-text`、`brand-tint` 保留取值供已有样式读取，组件不再使用。
5. 信号色令牌保留名字，取值改为调色板的状态色：`signal-danger-*`→`danger`，`signal-warning-*`→`warn`，`signal-success-*`→`ok`（点和字同色，所以 fill 与 text 相同）；`signal-info-fill`→`progress`、`signal-info-text`→`ink`（「进行中」：字是 ink、点是 progress）。
6. 类别色的用法：图标块 = 浅彩底 + 图标色；**图标色只画图形，不写字**（浅色主题下只有 3.1–4.2:1）；一行里最多一种图标色；同一个东西在所有页面颜色一样。插件页面固定用第 2 组（`tint-2` / `accent-2`，见 `docs/authoring/console-pages.md`）。
7. 图表色 `chart-1`…`chart-8` 重排：五个图标色（`chart-1`、`-3`、`-4`、`-6`、`-8`）与三种补充色交错，不含蓝紫：`chart-2` 孔雀青（浅 `#23575C` / 深 `#53A3AC`，色相约 186°，与 `ok` 绿相差 ≥ 30°、ΔE2000 ≥ 20，不会和「正常」混淆）、`chart-5` 棕、`chart-7` 赭（浅 `#93461F` / 深 `#C76523`，暖色，取代原来深而高饱和的紫红 `#761951`）。和图标色一样，浅色主题取较深的图标色，深色主题取较浅的一档。相邻 ΔE2000 ≥ 20（实测相邻最小：浅色 23.2、深色 31.1）、任意两色 ≥ 12（实测最小 17.8 / 15.9）、在卡片（surface）上 ≥ 3:1（实测最小 3.57 / 4.42）。`chart-other` 是 `control` 灰。

### 28. 字号（D35，修订 D16「最多 5 种字号」）

| 令牌 | 字号 / 行高 | 用在 |
| --- | --- | --- |
| `xs` | 12 / 16 | 组标题、表头、徽标、底部导航文字 |
| `sm` | 13 / 18 | 说明、时间、单位 |
| `md` | 14 / 20 | 网页正文、表格、输入框 |
| `lg` | 15 / 22 | 手机正文、列表标题、按钮 |
| `xl` | 17 / 24 | 卡片标题、弹层与对话框标题 |
| `2xl` | 22 / 30 | 主卡标题 |
| `title` | 26 / 34 | 页面标题 |
| `display` | 32 / 40 | 统计数字（单位跟在后面，14 号 `muted`） |

D16 的旧名保留为别名：`label` = `sm`（13）、`body` = `md`（14）、`section` = `xl`（由 16 变为 17）；`title`（22 → 26）与 `display`（28 → 32）本身就是新尺度的档位。字重仍是 400 / 500 / 600，页面标题、卡片标题、按钮用 500，统计数字用 600。`scale.json` 的 `text` 是这 8 档（`textAliases` 列出别名），Tailwind `text-*` 有 11 个键（8 档 + 3 个别名）；审计的「一页最多几种字号」随尺度变为 8。系统字体优先（`system-ui` 等），宿主加载了 Inter 时仍以 Inter 为首选。

### 29. 间距、圆角、阴影、控件尺寸（D36）

1. **间距**：4 的倍数 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48。第一层的旧名保持原值（插件样式在读，例如 Sandbox）：`space-1`…`space-4` = 4–16，`space-5` = 24，`space-6` = 32，`space-7` = 48，`space-8` = 64（兼容保留）；新增 `space-4-5` = 20（Tailwind `p-5`）与 `space-6-5` = 40（`p-10`）。Tailwind 间距键因此是 `0`、`px`、`1`、`2`、`3`、`4`、`5`、`6`、`8`、`10`、`12`、`16`。
2. **语义取值**（按尺寸）：页边距手机 16、网页 32；卡片之间手机 12、网页 20–24；卡片内边距手机 16、40rem 起 20、64rem 起 24；组标题到卡片 8；列表行高手机 56、网页 52；内容最宽 1280（`data` 由 120rem 改为 80rem；`reading` 仍是 60rem）。
3. **圆角**：`r-2` 10（小色块、骨架）、`r-3` 14（输入框、菜单项）、`r-4` 18（子卡片）、新增 `r-5` 20（菜单）、`r-6` 24（手机卡片、主卡、操作栏、提示条）、`r-7` 28（网页卡片、对话框、抽屉、弹层），`r-full` 用于所有按钮、胶囊、分段、开关、头像、图标块、导航条；`r-1` 6 保留给复选框与已有样式。语义令牌：`card-radius` 24 / 28，`control-radius` 14，新增 `pill-radius`、`sub-radius`、`hero-radius`、`skeleton-radius`，`popover-radius` 20（手机为 28 的底部弹层），`dialog-radius` / `sheet-radius` 28。
4. **阴影**：`e-1` = shadow-sm（白卡、圆形按钮），`e-2` = shadow-md（底部导航、操作栏、Toast），`e-3` = shadow-lg（弹层、菜单、对话框、抽屉）。浅色是带暖色的投影；深色看不见投影，改为 1px 白色 6%–8% 内描边加顶部高光（e-1）或内描边加黑色投影（e-2、e-3）。**卡片无描边**：`card-border` 为 0，静态白卡用 `e-1`（D16 原来是「描边、无阴影」）。另有几个复合阴影令牌：`hairline-ring`（描边徽标、描边按钮）、`selected-bar`（选中行左侧 3px 竖条）、`progress-halo`（进行中的点）、`field-focus-ring` / `field-error-ring`（输入框焦点）、`focus-ring-inset`（菜单项、选项的键盘焦点：画在项内的 2px 焦点环）。
5. **控件尺寸**（`controlSize`，生成 `--console-size-*`）：控件 36 / 40 / 48，圆形图标按钮 44，开关 46 × 28，图标块 32 / 40 / 48，图标 20。语义：`control-height` 48（输入框、按钮），`control-height-medium` 40（分段、步进器、筛选框），`control-height-compact` 36（小号按钮、胶囊；手机宽度下仍是 44），菜单项高 46（`popover-item-height`），复选框与单选的描边 1.5px（新增边框档 `check`）。

### 30. 动效（D37）

| 令牌 | 时长 | 曲线 | 用在 |
| --- | --- | --- | --- |
| `motion-fast` | 120ms | `--console-ease-fast`（`ease-out`） | 悬停、按下、颜色 |
| `motion-base` | 200ms | `--console-ease-out`（`cubic-bezier(0.2, 0, 0, 1)`） | 开关、分段、展开「更多」 |
| `motion-slow`（= enter） | 280ms | `--console-ease-out` | 弹层、对话框、抽屉进入 |
| `motion-exit`（新） | 180ms | `--console-ease-exit`（`cubic-bezier(0.3, 0, 1, 1)`） | 离开 |
| `motion-pulse`（新） | 1.6s | — | 进行中的点呼吸、骨架 |

`--console-ease-out` 的值由 `cubic-bezier(0.25, 1, 0.5, 1)` 改为设计包的标准曲线。对话框从 96% 放大并淡入，网页抽屉从右侧滑入 24px，底部弹层上滑 24px；`prefers-reduced-motion: reduce` 下**只保留透明度变化**（浮层和 Toast 仍淡入，加载转圈改为明暗闪烁，其余动画与过渡停止）。stylelint 的 `console/motion-tokens` 规则不变。

### 31. 主题（D38）

1. 浅色写在 `:root`、`.light`、`[data-theme="light"]`；深色写在 `.dark`、`[data-theme="dark"]`。**什么都不写就是浅色**（和 1.3.0 以前一样）。跟随系统是**可选启用**：在 `<html>`（或子树）上写 `data-theme="system"`，规则是 `@media (prefers-color-scheme: dark) { [data-theme="system"] { …深色… } }`。所有令牌块都声明在每个主题根上（`:root, .light, .dark, [data-theme="light"], [data-theme="dark"], [data-theme="system"]`），所以子树可以单独切换主题。
2. 兼容：Console 现在用 `.dark` 切深色、不写就是浅色，这两条都不变，只切 `.dark` 的宿主不受影响。Tailwind 的 `dark:` 变体认 `.dark`、`[data-theme="dark"]`，以及系统为深色时的 `[data-theme="system"]`；在 `.light` / `[data-theme="light"]` 岛内不生效（`:not(:where(.light *, [data-theme="light"] *))`，不增加选择器权重）。岛只支持一层：浅色岛里再嵌深色岛时，里面的 `dark:` 不生效（令牌本身仍按最近的主题根取值）。
3. 审计的 `setConsoleTheme()` 按 Console 的方式切换（深色加 `.dark`，浅色什么都不写），并去掉 `<html>` 上的 `.light` 与 `data-theme`，所以写了 `data-theme="system"` 的页面也按指定主题审计，结果不受浏览器系统偏好影响；`audit/mount-page.jsx` 与组件示例页同样如此（示例页另有 `?theme=system`）。

### 32. 组件（D39）

API 全部兼容，只改外观和增加变体：

1. **Button**：胶囊；`primary` 黑 / 白实心（悬停 `primary-hover`），`secondary` 与默认的 `soft` 是 sunken 底，新增 `white`（白底 + shadow-sm）、`text`（ink 加下划线，`link` 同此）、`danger-text`、`danger`（`destructive-solid` 的别名）；`outline`、`ghost`、`destructive`（= `danger-text`）、`destructive-outline`（描边 + 红字）保留。尺寸：默认 / `lg` 48，`sm` 36，`icon` 48，新增 `icon-sm` 36。状态：悬停叠 4% ink，按下叠 8% 并缩到 98%，键盘焦点 2px `focus` 外框留 2px 间隔，禁用 40%，新增 `loading`（转圈、`aria-busy`、宽度和可访问名称不变）。按钮渲染 `data-variant` / `data-size`。**一屏只有一个 `primary`**。
2. **Card**：无描边，白底 + shadow-sm，手机圆角 24、网页 28，内边距 16 / 20 / 24；卡片里的卡片是 sunken 子块（圆角 18，无阴影）。
3. **Badge** 是浅底胶囊（12 号 500，无描边）：`default` / `secondary` / 新增 `neutral` 为 sunken + muted，`success` / `warning` / `destructive` 为对应 `-bg` 底与状态色，`info` sunken + ink，`outline` 描边，新增 `solid`（primary 底）；`tone` 1–5 给类别浅彩。**StatusBadge** 改为「点 + 文字」：五种 `ok` / `warn` / `danger` / `neutral` / `progress`，`progress` 的点带光晕并呼吸；旧状态名映射过去（`warning`→`warn`、`error`→`danger`、`info` / `pending`→`progress`），`isAttentionStatus()` 保留；新增同一组件的别名 `StatusDot` 与 `statusTone()`。
4. **表单控件**（`Input`、`Textarea`、`SelectTrigger` / `SelectField`、`SearchableSelectField`、`DateField`、`DateTimeField`）：高 48、圆角 14、1px `control` 边框、surface 底；悬停 `muted` 边框；聚焦 ink 边框加 2px 外环（留 2px surface 间隔）；出错用 `aria-invalid="true"`（danger 边框）；禁用 40%；`variant="ghost"` 不变。外观集中在新的 `console-field` 类里。
5. **Switch** 46 × 28，关闭 `control` 轨道、开启 `primary` 轨道；**Checkbox** 22px、圆角 6、1.5px `control` 描边，选中 primary 底 + on-primary 勾；**Radio** 22px 圆、选中 primary 描边 + 10px primary 圆点（设计稿 CForms）。
6. **Tabs** 改为分段样式（`sc-seg`）：sunken 胶囊底，选中项 primary 实底；Radix 提供 `tablist` / `tab` / `aria-selected`。默认每项按文字宽度排列（保持 Console 原来的密度）；`<Tabs fill>` 时列表占满宽度、各项等宽。
7. **Table**（`sc-table`）：表头 12 号 muted，单元格 12 内边距，每行上方一条 `line`，选中行（`aria-selected` 或 `data-state="selected"`）primary-soft 底加左侧 3px 竖条；窄容器里每行变成 sunken 子卡片（D18 不变）。
8. **Skeleton**：sunken、圆角 10、明暗呼吸，和真内容一样大；**Alert** 改为提示条（状态 -bg 底、圆角 24、一句状态加一个白色小按钮），标题 / 说明插槽保留。
9. **PageHeader / PageShell / StatCard / layout**：页头是标题（26 号 500）加一个主按钮，竖直居中；页面最宽 1280、网页页边距 32；StatCard 无描边白卡，数值 32 号 600、单位 14 号 muted，`danger` 卡改为 danger-bg 底。

### 33. 浮层（D40）

`Dialog` 圆角 28、shadow-lg、raised 底，进入时从 96% 放大；遮罩是 `scrim`（不再模糊）；关闭按钮是 40 的 sunken 圆形按钮；确认对话框标题行是 48 的图标块。`Sheet` 在网页端是右侧 480 宽、四角圆角 28、离边 12 的浮起抽屉，**手机宽度下（< 40rem）是底部弹层**（顶部圆角 28、拖动条、最高 90dvh）。`DropdownMenu` 圆角 20、每项高 46（圆角 14）；指针悬停只用 sunken 填充，键盘焦点是 primary-soft 底加画在项内的 2px 焦点环（`focus-ring-inset`，D32 的焦点必须可见）——Radix 会用脚本把焦点移到指针下的项，浏览器可能把它算作 `:focus-visible`，所以菜单与下拉列表的内容元素记录当前输入方式（`data-input="pointer" | "keyboard"`，打开时取打开它的输入，之后跟随指针移动和按键），只有键盘时才画焦点环；新增 `variant="danger"` 的菜单项（放最后）。`Popover` 与 `Select` 的列表跟随菜单的外观；`Tooltip` 改为 inverse 底、圆角 14、shadow-md。手机宽度下菜单、下拉和对话框仍是底部抽屉（D18 不变）。

### 34. 新组件（D41）

都从包入口导出、带 TS 类型和无障碍属性，样式在 `client/styles/soft.css`：

| 组件 | 规则 |
| --- | --- |
| `Tile` | 圆形图标块 40（`sm` 32、`lg` 48）；`tone` 1–5 = 浅彩底 + 图标色，`neutral` = sunken + ink；块里写字时用 `text`（字是 ink）；默认 `aria-hidden` |
| `Chip` | 36 高胶囊（手机 44）；`pressed` 写 `aria-pressed`，选中 primary；可选 `tone` 浅彩 |
| `Segmented` | `role="tablist"`，子按钮 `role="tab"` + `aria-selected`，方向键 / Home / End 移动（roving tabindex；`value` 不在选项里时第一个可用项可聚焦）；使用方的 `onKeyDown` 先执行、可 `preventDefault()` 保留按键；纯筛选（不切换面板）可写 `role="radiogroup"`（子按钮 `radio` + `aria-checked`），外观和按键相同 |
| `Stepper` | 两个带名字的按钮 + `<output>`，值带单位（「20 次」）；到上下限时按钮 `aria-disabled` 并忽略点击（不用 `disabled`，键盘焦点不会掉到页面上）；`disabled` 关闭整个步进器 |
| `StatusDot` | 即 `StatusBadge`（点 + 文字） |
| `Banner` | `warn` / `danger` / `neutral`；一句状态 + 一个动作（白色小按钮）；danger 为 `role="alert"`，其余 `role="status"` |
| `Toast`、`Toaster`、`useToast`、`createToastStore` | inverse 胶囊，一句话 + 可选「撤销」，2.5 秒消失（`TOAST_DURATION_MS`），带「撤销」时至少 5 秒（`TOAST_UNDO_DURATION_MS`）；指针停在 Toast 上或焦点在其中时暂停计时（`createToastStore().pause()` / `resume()`）。live region 只有一个：`Toaster` 是 polite 的 live region，其中的 Toast 不再带 `role="status"`；单独使用的 `Toast` 仍是 `role="status"`。没有 `Toaster` 时 `useToast().toast()` 不显示、返回 -1，开发模式下告警一次 |
| `HeroCard` | `hero`（杏 → 粉）/ `hero-2`（薄荷 → 奶黄）渐变，ink 字，无阴影；每个一级页面最多一张；主卡上不用彩色状态字（`ok` / `warn` / `danger` 字只保证在 surface 与自己的 `-bg` 上的对比度），状态用 `StatusDot tone="progress"`（ink 字 + 彩色点） |
| `ListGroup`、`ListRow`、`ListCaption`、`ChangedDot` | 行：图标块 → 标题 + 一行说明 → 右边只放一样；`selected`（primary-soft + 竖条；链接行 `aria-current="page"`，按钮行 `aria-pressed`，也可自己传 `aria-current`）、`disabled`（变淡；链接行去掉 `href`、不再跳转）、`plain`（无图标块，分隔线从 16 开始，否则从 68 开始）、`changed`（progress 色小点）；组标题 12 号 muted、缩进 16 |
| `NavPill`、`NavIcon`、`IconButton` | 网页导航：当前页黑色胶囊带名字（`aria-current="page"`），其他是白色圆形图标（必须有名字）；圆形图标按钮 44（`flat`、`soft`） |
| `TabBar`、`TabBarItem` | 手机底部导航：悬浮胶囊 68 高，4–5 项都有图标和文字，当前项 primary-soft |
| `Aurora` | 极光背景（手机 320、网页 420 高，四团径向渐变），只放一级页面顶部，`aria-hidden` |
| `ActionBar` | 底部浮起的操作栏：白底、shadow-md、圆角 24；左边文字按钮、可选次按钮、右边主按钮（手机占满） |

`EmptyState` 改为「图标块（48，sunken）+ 标题 + 一个按钮」，新增 `presets`（下面一行可一键套用的胶囊）；线稿插画（D28）保留，改为 muted 色。

### 35. 护栏与校验

1. **stylelint**：第一层令牌的识别扩到 `space-4-5` / `space-6-5`、`radius-5…7`、`border-check`；新增的语义令牌都在 `scale.json` 的 `semanticTokens` 里；复合阴影只能经令牌使用（字面阴影仍报错）。
2. **ESLint / Tailwind 类名白名单**（`classifyClass`）：间距键加 `5`、`10`；`text-xs` / `sm` / `md` / `lg` / `xl` / `2xl` / `title` / `display` 在尺度内（Tailwind 的 `text-base`、`text-3xl` 等仍是尺度外）；圆角键 `0`–`7`、`full` 与语义键（`pill`、`sub`、`hero`…）；阴影键加 `float`、`hairline`、`selected`、`field-focus`；尺寸键加 `control-medium`、`tile`、`tile-sm`、`tile-lg`、`icon-button`。`zhin plugin check` 第 5 条的间距键同步。
3. **布局审计**（`audit/layout-audit.mjs`）：字号上限随尺度（8）；圆角 `r-0…r-7 / full`；边框 hairline / check / focus；阴影 e-0…e-3 或上面的复合阴影（比较前去掉 Tailwind 叠加的透明零阴影层），其中 `hairline-ring` 只能出现在 `button` / `badge` 上，`selected-bar` 只能在 `list-row` / `stat-card` 与表格单元格上，`field-focus-ring` / `field-error-ring` 只能在 `input` 上，`focus-ring-inset` 只能在菜单项和选项上（`AUDIT_RING_SLOTS`）；静态卡片（含 `list-group`）最多 shadow-sm；一致性按 `data-slot` 分组，只有组件库自己的 `button`、`badge`、`icon-button`、`tile`（按 `data-size`）、`hero` 再按**已知的**变体值细分（`AUDIT_VARIANT_SLOTS`，其它 slot、属性或未知值都和普通组件同组），「选中」只认 `data-selected`、`aria-selected="true"`、`aria-pressed="true"` 与不为 `"false"` 的 `aria-current`；数据页在 1920 下至少占 min(85% 视口, 80rem)；主题切换按 Console 的方式（第 31 条第 3 款）；焦点遍历按元素身份去重（滚动后位置变化不再误判为重复）。
4. **对比度**（`tests/contrast.test.ts`，即设计包第十节的核对表）：浅色、深色下 `ink` / `muted` 在 surface、bg、sunken、raised、primary-soft、五种浅彩、两种主卡渐变与极光上 ≥ 4.5；`faint` 在 surface / bg 上 ≥ 4.5；`on-primary` / `primary`、`on-inverse` / `inverse`、白字 / `danger-solid` ≥ 4.5；`ok` / `warn` / `danger` 在表面和自己的 `-bg` 上 ≥ 4.5；图标色在对应浅彩和 surface 上 ≥ 3；`control`、`focus` 在 surface / bg 上 ≥ 3；不得出现色相 200°–300° 的颜色（品牌标除外）。令牌取值与设计包相同，表中数值全部通过，未作调整。

### 36. 对前文的修订

- **D16**：「最多 5 种字号」改为第 28 条的 8 档；「卡片描边、静态无阴影」改为「无描边、静态 shadow-sm」；内容宽度 `data` 改为 80rem；第三层取值表由第 29 条替换（`tokens.mjs` 的 `semantic`）。
- **D18 第 2 条**（组间距 ≤ 卡片内边距 ≤ 分区间距）：手机宽度下卡片之间 12 小于内边距 16（设计包规定），这一档放宽为「组间距 ≤ 内边距，组间距 ≤ 分区间距」；40rem 起仍是原规则。
- **D20 审计**：见第 35 条第 3 款。
- **D15 第 1 条**（正常状态用弱化样式、不用彩色徽标）：`Badge variant="success"` 与 `StatusBadge` / `StatusDot` 的 `ok` 由「不着色的弱化文字」改为绿色（`ok` 色字，`Badge` 带 `ok-bg` 浅底）——设计包规定「在线 / 已启用」用 ok 绿。D15 第 1 条「只在有话可说时才显示、彩色只用于异常」的其余部分不变：正常状态仍应尽量不显示或少显示；`StatCard` 数值为 0 时仍忽略 `tone`（D24 第 3 条）。
- **D23–D25**：主按钮改为黑 / 白，品牌色只用于品牌标；`data-palette` 不再生效；信号色改为调色板状态色；焦点环由 `brand-text` 改为 `focus`（ink）；链接与文字按钮是 ink 加下划线，不用彩色字表示可点。
- **D28**：空状态图标放进 48 的 sunken 图标块，插画改为 muted 色。
- **D26**：动效令牌见第 30 条。

### 37. Console 需要配合的地方（zhinjs/console）

1. **删除 Console 自己的调色板和尺寸覆盖**——这是新外观在 Console 里生效的前提（第 27 条第 2 款）。Console 的 `theme-tokens.css` 与 `design-system.css` 在 `@zhin.js/console-ui` 的 `styles.css` 之后加载，同名变量以它们为准。要删的是：
   - `theme-tokens.css` 中 `:root` 上的调色板（`--background`、`--foreground`、`--card`、`--popover`、`--primary`、`--primary-foreground`、`--primary-action*`、`--secondary*`、`--muted*`、`--accent*`、`--selected*`、`--tab-inactive`、`--border`、`--border-strong`、`--input`、`--ring`、`--destructive*`、`--success*`、`--warning*`、`--info*`、`--status-*`、`--chart-*`、`--sidebar*`、`--im-*` 等，即 `tokens/colors.css` 映射表里出现的所有名字）；
   - `theme-tokens.css` 中所有 `[data-palette="…"]` 块（配色选择器的 8 套颜色）；
   - `theme-tokens.css` 中 `.dark { … }` 里的颜色（同上这些名字的深色值）；
   - `design-system.css` 中与 `@zhin.js/console-ui` 同名的 `--console-*` 变量（尺寸、圆角、阴影、动效、内容宽度、调色板等；以 `dist/scale.json` 的 `semanticTokens` / 第一层令牌与 `tokens.css` 里声明的名字为准），只保留 Console 业务页面自己的、组件库没有的变量。
   删完以后 Console 页面与不自带颜色的插件页面才换上柔光卡片外观；删之前它们看到的仍是 Console 的旧值。
2. 主题：保持现在的做法即可——深色在 `<html>` 加 `.dark`，浅色什么都不写（显式写 `.light` / `data-theme="light"` 也可以）。要提供「跟随系统」时在 `<html>` 写 `data-theme="system"`（组件库只在这种情况下读 `prefers-color-scheme`）。
3. 移除配色（`data-palette`）选择器，或改为只切主题。
4. 顶栏改用 `NavPill` / `NavIcon`，手机底部导航改用 `TabBar`；一级页面顶部可放 `Aurora` 与一张 `HeroCard`。
5. 自己写死的 90rem / 120rem 内容宽度、`brand` 主按钮、`--console-signal-info-*` 蓝色、`backdrop-filter` 遮罩等自定义样式按本节对齐；在外壳外层放一个 `Toaster`，插件页面的 `useToast()` 才会显示（之前调用不显示任何东西，开发模式下控制台告警一次），Console 自己的 toast 也可改用它。
6. 升级 `@zhin.js/console-ui` 到 1.3.0，完成第 1 条后更新视觉回归基线；插件页面不需要改代码（前提是第 1 条已完成）。

## 备选方案

- **A. 反过来，Console 也改用 `zk-` 套件，作为唯一的组件库**（issue 中的方向 b）。不采用：Console 的组件更完整（基于 Radix 的下拉、对话框、弹出层、焦点管理和无障碍支持），也是用户看得最多的部分；`zk-` 的 `Select` 是原生控件，要补齐就等于重写一遍 Radix。
- **B. 两套并存，只再加一层共享令牌，把宽度、页头样式对齐。** 不采用：现在已经共享了颜色和圆角变量，问题出在组件结构和交互；只对齐变量，下拉框、对话框、危险按钮还是两套，`remote-entry-style-contract.ts` 这类补丁也会继续增加。
- **C. 包放在 zhinjs/console，由 Console 发布。** 不采用：Console 仓库没有发布流程；渲染器和插件检查都在 zhinjs/zhin，放在 Console 会让每次渲染器改动都跨仓库发版。
- **D. 插件页面用 iframe 隔离，各自带样式。** 不采用：样式和交互会更不统一，深浅色切换、权限和路由都要另外通信。
- **E. 只做页面外壳，组件库以后再说。** 不采用：外壳只能解决宽度和页头；下拉框、按钮高度和危险按钮样式这些验收项都依赖组件统一。

## 分阶段计划

版本级别按 `.changeset/version-policy.json`：默认是 patch，minor 及以上需要所有者批准。新包 `@zhin.js/console-ui` **直接以 `1.0.0` 首发**（2026-11-15 所有者决定，原计划从 `0.1.0` 起）：插件以 `peerDependencies`（`workspace:^`）声明它，0.x 下每次 minor 都会超出插件声明的范围，changesets 会把所有声明它的插件连带升为 major；从 1.0.0 起，1.x 内的 minor 都在 `^1` 范围内。`package.json` 记 `1.0.0-0`，由一个 patch changeset 升到 `1.0.0`（默认的 patch 级别，不需要额外批准）。删除 `@zhin.js/client/ui` 子路径和 `zk-` 类名虽然对第三方手写页面是破坏性的，但所有者决定**走 minor，不等 major**（D11）：P2 发布时弃用并告警，至少经过一个 minor 的弃用期（与 ADR 0062 Q0b「至少告警一个 minor」的节奏一致），在之后的 minor（P4）中删除。`@zhin.js/client/ui` 不在 `public-api-surface` 的 `stable` 清单中，所以不受「`stable` 入口到 major 才删除」的限制。

| 阶段 | 内容 | 涉及的包 | 版本 | 验收 |
| --- | --- | --- | --- | --- |
| P0 ADR | 本 ADR；索引登记；设计规则增补（D15–D22） | `docs/adr` | — | 所有者确认 D1–D10、D12–D22（D11 已定） |
| P1 组件包与外壳（P1a；P1b 令牌与组件规则见 D21） | 新建 `packages/console/ui`（`@zhin.js/console-ui`）：从 Console 迁入 `components/ui/*`、`PageShell`、`PageHeader`、确认对话框、状态卡、空状态、错误提示、`RefreshControl`、`usePageChrome`、`destructive-outline` 变体；令牌移入 `tokens.css`，产出 `styles.css`；视觉回归用例。Console 改为从包中引入，`--zk-*` 改为别名；pagemanager 把包加入 `HOST_PROXIED_MODULES`；`definePage` 增加 `keywords` | `@zhin.js/console-ui`（新）、`@zhin.js/pagemanager`、`@zhin.js/page`、`@zhin.js/console-contract`、zhinjs/console | 新包 minor；pagemanager / page / contract minor；Console minor | P1a：Console 自带页面外观不变（视觉回归无差异）；P1b：三层令牌与生成的 Tailwind 主题上线，stylelint / ESLint 与 Playwright 审计上线，视觉回归基线逐页评审后更新；Console 构建不再依赖 `remote-entry-style-contract.ts` 中的类名 |
| P2 迁移官方页面 | `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 改用新组件，只渲染内容区块，页头交给外壳；`variant: 'danger'` 改为描边加确认；删除首字母方块；`AdapterConsolePage.tsx:122`、`:1469` 的原生 `<select>` 换成新下拉；`adapter-console/styles.ts`、`review-console/styles.ts` 随渲染器迁移删除。**Sandbox 分两步**（见 D13）：先把 zhinjs/console 中只服务 Sandbox 的 `agent-playground.css`（1872 行）和 `im-workspace.css`（256 行）移进 Sandbox 插件，由插件页面自己注入样式；然后逐步把 2314 行的 Sandbox `.tsx` 改写到 `@zhin.js/console-ui` 组件上；两步完成后才删除 `remote-entry-style-contract.ts`。非 UI 导出按 D14 迁到 `@zhin.js/client` 根入口；`@zhin.js/client/ui` 保留为弃用的再导出层，`zk-` 类名标记弃用（首次使用时控制台告警一次）；发布升级对照表；`zhin plugin check` 第 1–6 条上线（对第三方插件只提示），官方插件迁移完成后逐个加入 CI 门禁（第 1–6 条与 Playwright 全项审计为错误，见 D19「本仓库的官方插件」） | `@zhin.js/client`、`@zhin.js/adapter-sandbox`、`@zhin.js/cli`、zhinjs/console | minor（client、Console、sandbox、cli） | 任意插件页和 Console 自带页并排打开，深浅色下内容宽度、页头结构、下拉框、按钮样式一致；插件页中没有原生 `<select>`；`remote-entry-style-contract.ts` 已删除（Sandbox 两步完成后）；所有官方插件都在门禁名单中，`check:plugin` 第 1–6 条与 Playwright 全项审计通过（豁免只限带理由的行内注释） |
| P3 导航与命令面板 | 插件详情页加页签，插件页面挂到 `/plugins/<插件名>/<页面名>`，适配器页挂到适配器对象页；顶栏「功能」只保留 Console 功能页；旧顶层路径重定向；命令面板按插件名、包名、页面标题、`keywords` 索引插件页；官方插件补 `keywords`（例如彩票推荐补「抽奖」） | zhinjs/console、`@zhin.js/client`（路由注册）、官方插件 | Console minor；官方插件 patch | 命令面板能搜到所有插件页面（含别名，有测试）；顶栏「功能」菜单里没有插件页面 |
| P4 清理与删除 | 文档只示范统一组件；`zhin plugin check` 第 1–6 条与官方插件门禁自 P2 起已生效，P4 不改变；在 P2 之后至少一个 minor 的弃用期结束后，删除 `@zhin.js/client/ui` 再导出层、`zk-` 组件与样式（`ui/components.tsx`、`ui/styles.ts`、`adapter-console/styles.ts`、`review-console/styles.ts`）、`zk-` 类名、`--zk-*` 别名、蓝图 `mark` 字段和旧顶层路径重定向 | `@zhin.js/client`、`docs/authoring/console-pages.md` | 删除：`@zhin.js/client` minor（弃用期 ≥ 1 个 minor） | 新写的插件页不使用 `zk-`；官方插件仍通过第 1–6 条与 Playwright 全项审计（自 P2 起的 CI 门禁） |

### 升级对照表（`@zhin.js/client/ui` 的去向）

`@zhin.js/client/ui` 不只导出 `zk-` 组件，还导出数据、语言和插件 ID 相关的工具，`docs/authoring/console-pages.md`（「页面 UI 套件」一节）现在教的 `usePluginRpc` 也在里面。删除子路径前，它们按下表迁走；弃用期内 `@zhin.js/client/ui` 原样再导出这些名字并告警一次。

| 原导出（`@zhin.js/client/ui`） | 去向 |
| --- | --- |
| `usePluginRpc`、`usePluginData`、`useRpcResource` 及其类型 | `@zhin.js/client` 根入口 |
| `useLocale`、`detectLocale`、`translate`、`formatClock` 及其类型 | `@zhin.js/client` 根入口（`@zhin.js/console-ui` 的语言 Provider 可由它接入） |
| `resolvePluginId`、`resolveSyncPluginId`、`resolveAdapterConsolePluginId` | `@zhin.js/client` 根入口 |
| `DeclarativePageView`、`createDeclarativePage`、`DataTable` 及声明式类型 | `@zhin.js/client` 根入口（渲染器本身改用 `@zhin.js/console-ui` 组件；`DataTable` 改为基于新表格组件） |
| `Button`、`Badge`、`Select`、`Modal`、`Card`、`Tabs`、`Input` 等 `zk-` 组件 | `@zhin.js/console-ui` 中的同名或对应组件（逐个列出属性差异） |
| `PluginPage`、`PageHeader` | 无对应组件：由页面外壳负责，手写页面改用 `usePageChrome` |
| `pluginUiStyles` | 无：样式由 Console 加载的 `@zhin.js/console-ui/styles.css` 提供 |

### P4 实施记录

所有者 2026-11-17 同意开始 P4。删除前逐项核对了弃用期：每一项都已在一个发布到 npm 的 minor 中标为弃用（CHANGELOG 与类型注释），P4 在下一个 minor 中删除。

| 删除的接口 | 标为弃用 | 删除 |
| --- | --- | --- |
| `@zhin.js/client/ui` 子路径（再导出层）及其 `zk-` 组件（`ui/components.tsx`）与样式（`ui/styles.ts`、`pluginUiStyles`） | `@zhin.js/client` 1.3.0（P2，2026-11-16） | `@zhin.js/client` 1.4.0 |
| `adapterConsoleStyles`、`conversationPickerStyles`（弃用期内为空字符串） | `@zhin.js/client` 1.3.0 | `@zhin.js/client` 1.4.0 |
| `zk-` 类名（含适配器页账号编辑器的 `zk-account-editor-host`，改用 `data-adapter-account-editor`）、`--zk-*` 变量（含 `@zhin.js/pagemanager` 独立页外壳里的 `.zk-root` 覆盖） | `--zk-*`：`@zhin.js/client` 1.2.2 标注；`zk-` 类名：`@zhin.js/client` 1.3.0 | `@zhin.js/client` 1.4.0 |
| 蓝图与评论审批 spec 的 `mark` 字段（及渲染器的告警） | `@zhin.js/client` 1.3.0 的 changeset 同时宣布；`@zhin.js/console-contract` 的类型注释随同一批发布于 1.3.1 | `@zhin.js/console-contract` 1.4.0、`@zhin.js/client` 1.4.0 |
| `@zhin.js/console-ui` 的旧令牌别名（`--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-*`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card(-sm)`、`--console-control-height-sm/-lg`、`--console-border-width`、`--console-focus-width`、`--console-duration-fast/-page`、`--console-text-caption/-code/-body-sm/-section-sm/-title-compact`、`--radius`）和无后继的 `--console-shadow-ring` | `@zhin.js/console-ui` 1.1.0（P1b；`duration-*` 随 console#125） | `@zhin.js/console-ui` 1.2.0 |
| `Button` 的 `variant="default"`（改名 `soft`） | `@zhin.js/console-ui` 1.1.0 | `@zhin.js/console-ui` 1.2.0 |
| 插件页面旧顶层路径的重定向（P3，如 `/rss` → `/plugins/rss/index`） | zhinjs/console#115（2026-11-16，在 `@zhin.js/client` 1.3.0 这一轮发布之前上线） | zhinjs/console 分支 `console/adr0063-p4`，随本仓库 P4 这一轮发布合并。适配器页面的旧路径（`/icqq` → `/scope/icqq`）保留：那条隐藏路由同时是适配器页面在命令面板里的唯一入口并承载权限，要删除需先改命令面板登记适配器页面的方式 |

stylelint 规则 `console/no-deprecated-tokens` 保留，改为报出 P4 删除的旧令牌名并给出新名（`tokens/tokens.mjs` 的 `removedAliases` 只供这条规则读取，不再声明这些变量）；`zhin plugin check` 第 2 条仍识别从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage`，提示中注明子路径已删除。仓库内的使用点（渲染器的 `Button variant="default"`、Sandbox 插件、`scripts/adapter-preview` 的 `zk-` 组件调试台、测试与文档）一并迁移或删除。迁移说明见 `docs/authoring/console-pages.md`「从 @zhin.js/client/ui 升级」与「ADR 0063 P4 删除的其他接口」。

P2、P3、P4 各自的页面收敛项和检查见 D21 的表格。P1 和 P2 可以在同一个 release 中发布，但必须分开 PR：P1a 只改 Console 的引入方式，外观不变，便于用视觉回归确认没有退化（P1b 有意改变外观，见 D21）。P3 依赖 ADR 0062 第 24 项的插件详情页签，可以和第 24 项的实施 PR 合并。

## 风险

- **第三方插件的手写页面**：它们可能直接用了 `@zhin.js/client/ui` 或 `zk-` 类名。已经构建好的第三方插件把自己用的 `@zhin.js/client` 打进了包里（目前只有 React 和 React Router 由 Console 共享），所以 P4 删除不会让它们坏掉：它们保持旧外观，作者升级依赖后才会看到弃用告警或构建错误。处理办法：弃用期至少一个 minor，首次使用时告警；`zhin plugin check` 给出替换建议；升级文档给出上面的对照表；Console 借助 D3 的共享模块版本登记识别仍用旧版 `@zhin.js/client` 构建的页面（能识别时），在页签上标记「旧版 UI」。
- **Console 与插件版本错位**：插件页面按新外壳写，但用户的 Console 还是旧版本。缓解办法：使用 D3 新增的共享模块版本登记（目前没有现成的握手可以沿用：`/console/capabilities` 只描述 RPC，`buildHostProxyModule` 遇到缺失导出会静默返回 `undefined`）。插件的 `peerDependencies` 范围不满足时代理模块明确报错或告警；弃用期内，Console 版本不支持外壳时渲染器退回到在内容区内自己画页头。
- **跨仓库发版节奏**：Console 修改公共组件要先在 zhinjs/zhin 发版。缓解办法：公共包只收通用组件；Console 业务组件留在 Console；开发时用本地 link。
- **组件的文案与语言**：Console 的部分组件直接用 Console 的 `useI18n`，`zk-` 用 `useLocale`；抽包后若仍引用宿主 i18n，插件页面里会出现语言不一致或缺文案。缓解办法：`@zhin.js/console-ui` 自带语言 Provider 和 zh-CN / en 默认文案，宿主只负责注入当前语言（决策 1 第 5 条）。
- **Sandbox 迁移成本**：Sandbox 的 `.tsx` 有 2314 行，依赖 Console 中 1872 行的 `agent-playground.css` 和 `im-workspace.css`。缓解办法：先整体搬样式、不改外观，再逐步换组件（D13）。
- **视觉回归噪声**：抽包时 CSS 层级（`@layer`）顺序变化，可能让 Console 页面出现细微差异。缓解办法：P1a 只迁移、不改样式，用视觉回归逐页比对；P1b 的有意改动逐页评审后更新基线。
- **ADR 之间的依赖**：P3 依赖 ADR 0062 第 24 项；导航修订会改变 ADR 0052 中插件页面的放置规则。

## 决定

所有者的长期指示是「需要拍板的按推荐处理」，下表的「决定」一列即为推荐，默认生效（D12–D14 是评审补充的推荐，同样默认生效）；D11 是所有者在起草过程中直接给出的决定，覆盖了原来「`zk-` 在 major 删除」的推荐。

| # | 项 | 决定（推荐，默认生效） | 被否决的替代选项 | 影响 |
| --- | --- | --- | --- | --- |
| D1 | 组件库 | 只保留一套：把 Console 的组件抽成 `@zhin.js/console-ui`，插件页和适配器页改用它，`zk-` 在新包发布时弃用，官方页面迁移完成、经过至少一个 minor 的弃用期后，在 minor 中删除 | Console 改用 `zk-`（方向 b）；两套并存只共享令牌 | 新增一个包；`@zhin.js/client/ui` 走弃用流程 |
| D2 | 包放在哪 | zhinjs/zhin 的 `packages/console/ui/`，Console 从 npm 依赖它 | 放在 zhinjs/console 发布 | Console 改公共组件要先在 zhinjs/zhin 发版 |
| D3 | 样式交付 | 包自带编译好的 `styles.css` 和 `tokens.css`，由 Console 提供单例（加入 pagemanager 的 `ALLOWED_ESM_CANONICAL` / `BROWSER_EXTERNALS` 与 `HOST_PROXIED_MODULES`，并在 Console `client/main.tsx` 的 `sharedModules` 中注册）；新增共享模块版本登记，代理模块按插件 `peerDependencies` 核对，不满足时明确报错或告警；`cn()` 移入 `@zhin.js/console-ui`，`@zhin.js/client` 再导出；包内自带语言 Provider；删除 `remote-entry-style-contract.ts`（在 Sandbox 迁移之后） | 插件页继续靠 Console 的 Tailwind 扫描和手写类名清单；不做版本核对，缺导出时静默降级 | pagemanager 和 Console 各改一处共享模块表 |
| D4 | 页面外壳 | 插件页必须使用外壳：标题、说明、操作区、刷新控件、宽度由外壳决定，宽度用 `--console-content-max`；插件只提供内容区块；声明式页面自动获得；唯一例外是 `fullWidth` 工作区页 | 外壳可选，只在文档中推荐 | 删除首字母方块和插件自绘页头 |
| D5 | 刷新控件 | 统一的 `RefreshControl`（Radix 下拉），Console 与插件页共用 | 各页保留自己的刷新控件 | 删除原生 `zk-refresh-select` |
| D6 | 导航 | 插件页按 ADR 0062 第 24 项挂成插件详情页签；顶栏「功能」只列 Console 自己的功能页；修订 ADR 0052 的插件页放置规则；旧路径重定向至少保留一个 minor 周期；Sandbox 例外见 D12 | 插件页继续进顶栏分区 | 插件的 `metadata.section` 弃用 |
| D7 | 命令面板 | 按插件名、包名、页面标题、插件说明和新增的 `definePage({ keywords })` 别名索引插件页 | 只按页面标题索引 | `definePage` 元数据增加一个字段 |
| D8 | 约束手段 | `zhin plugin check` 对原生 `<select>`、自定义页头、固定宽度给出警告，官方插件在 CI 中视为错误（P2 上线，之前只出报告，见 D19、D22）；`console-pages.md` 只示范统一组件 | 只写成文档约定 | 新增三条检查 |
| D9 | 危险操作 | 描边按钮（`destructive-outline`）加确认对话框，实心红色只用于确认按钮；蓝图的 `danger` 动作自动补确认 | 保留实心危险按钮 | RSS 等页面的危险按钮样式改变，无需改插件 |
| D10 | 分阶段与版本 | P0 ADR → P1 抽包与外壳 → P2 迁移官方页面 → P3 导航与命令面板 → P4 清理与删除；新包 minor；删除 `zk-` 也走 minor（见 D11） | 一次性切换 | 见「分阶段计划」 |
| D11 | `zk-` 删除的版本级别 | **所有者决定**（2026-11-14，「zk 不用大版本删除，minor 就可以」）：`zk-` 套件、`@zhin.js/client/ui` 子路径、`--zk-*` 别名和蓝图 `mark` 字段在 minor 中删除；P2 发布时弃用（首次使用告警一次、文档标注），至少经过一个 minor 的弃用期后在 P4 的 minor 中删除 | 等到下一个 major 再删除（原推荐） | 第三方手写页面需在弃用期内迁移；升级文档给出对照表 |
| D12 | Sandbox 导航 | Sandbox 作为对话入口保留在顶栏「会话」分区（`PLUGIN_PAGE_PLACEMENT`，`NAV_GROUPS.WORK`），是唯一不挂到插件详情下的插件页面；其余插件页都挂成插件详情页签 | Sandbox 也挂到插件详情下 | 对话入口位置不变 |
| D13 | Sandbox 样式迁移 | 先把 `agent-playground.css`、`im-workspace.css` 从 zhinjs/console 移进 Sandbox 插件，由插件页面自行注入；再逐步改写到 `@zhin.js/console-ui` 组件；完成后删除 `remote-entry-style-contract.ts` | 一次性重写 Sandbox；或继续保留类名清单 | Sandbox 是 P2 中工作量最大的一项 |
| D14 | `@zhin.js/client/ui` 中的非 UI 导出 | 数据、语言、插件 ID 的工具和声明式渲染器移到 `@zhin.js/client` 根入口，UI 组件对应到 `@zhin.js/console-ui`；弃用期内 `@zhin.js/client/ui` 作为再导出层保留；见「升级对照表」 | 随子路径一起删除，不提供去向 | `console-pages.md` 中 `usePluginRpc` 的引入路径要改 |
| D15 | 信息呈现规则 | Console 页面和组件默认：空值、默认值、正常状态弱化，彩色徽标只给异常；说明只说一次；列表默认紧凑表格；只有图标的按钮要有文字或收进「更多」；系统对象默认隐藏，「全部」真的是全部 | 逐页各自处理 | 首页、AI 与模型、插件、定时任务按 D21 收敛 |
| D16 | 令牌三层与规范名 | 基础尺度（字号 ≤ 5 级、字重 ≤ 3 种、`space-1`–`8`、`r-0`–`4` / `full`、`hairline` / `focus`、`e-0`–`3`、断点 `sm` / `md` / `lg` / `xl`、内容宽度 `reading` / `data`）→ 组件语义令牌 → 按尺寸取值；CSS 变量统一 `--console-` 前缀；旧令牌弃用期内为别名 | 继续用现有的 4 种间距令牌和 Tailwind 默认尺度 | Console 与组件库的样式逐步改写 |
| D17 | 单一事实来源 | 令牌只在 `@zhin.js/console-ui` 定义一次，生成 `tokens.css`、Tailwind 主题、`@custom-media`、stylelint / `plugin check` / Playwright 的允许值；Console 也消费它；Tailwind 主题只暴露尺度内的值；间距保留与 8 档同值的 Tailwind 默认键 `1`/`2`/`3`/`4`/`6`/`8`/`12`/`16`，删除其余键，不做类名改写 | Console 与组件库各自维护令牌；保留 Tailwind 默认尺度 | 生成物不得手改 |
| D18 | 响应式模型 | 间距取自第三层「按尺寸取值」表；组件用容器查询，`@media` 断点只给全局外壳；弹性页面边距与两种内容宽度（所有页面默认 `data`）；`auto-fit` 网格；容器 ≥ 90rem 时列表 + 详情双栏；窄于 40rem 时表格变卡片；手机 44px、不挤出视口、无整页横向滚动 | 按视口断点逐页切换 | 组件库提供网格和列表 + 详情组件 |
| D19 | 插件页面的样式 | **所有者决定**：插件页面推荐（应当）使用 `@zhin.js/console-ui` 组件和语义令牌，从而自动符合尺度、响应式和深浅色；允许超出组件库自定义界面；硬性底线（必须）只有：无整页横向滚动、不溢出页面容器也不覆盖外壳、可见焦点、手机触控 ≥ 44px、背景与文字使用 Console 主题令牌、在深浅两种主题下都可读；以上针对第三方插件。**所有者决定**：本仓库的官方插件完整遵守 D15–D19，作为参考实现；D8 第 1–3 条、D20 第 4–6 条和 Playwright 全项审计（D15–D18 各项与底线）对官方插件是 CI 错误，和 Console 自带页面一样，自 P2 起逐个插件生效，之前只出报告；豁免只能是写明检查项和理由、经评审的行内忽略注释，默认没有，写法在 P2 确定 | 插件页面强制只用组件库和语义令牌；官方插件也只推荐 | 第三方插件不会因样式被拒；官方插件页面由静态检查和全项审计在 CI 中拦截 |
| D20 | 约束手段 | Console 与组件库：stylelint、生成的 Tailwind 主题、ESLint 禁任意值；`zhin plugin check` 第 4–6 条（原始样式数值、Tailwind 任意值、非组件库基础控件）**只提示、永不升级为错误**，每条说明含义和对齐方法；Playwright 在 375 / 768 / 1280 / 1920 审计：zhinjs/console CI 审计 Console 页面（全项门禁），zhinjs/zhin CI 审计官方插件页面（全项门禁，与 Console 页面相同；自 P2 起逐个插件为 CI 错误，之前只出报告）；本仓库官方插件的第 1–6 条自 P2 起同样是 CI 错误（见 D19） | 只写成文档约定；对插件页面也强制报错 | 新增三条提示、两个仓库各加 lint、Console 加审计 |
| D21 | 与分阶段计划的对应 | 令牌工作并入 P1，拆成 P1a（只迁移）和 P1b（令牌与组件规则，有意改变外观，基线逐页评审）；页面收敛：P1b 全局项，P2 插件页面与 AI 与模型，P3 定时任务、插件页、首页，P4 删除旧令牌别名并让审计对所有 Console 页面全面门禁（官方插件自 P2 起已门禁） | 令牌工作单独作为新阶段 | P1 验收「外观不变」只适用于 P1a |
| D22 | 对前文的修订 | 决策 6 的范围、D8（第 1–3 条检查内容不变，改为与第 4–6 条一起在 P2 上线；官方插件的第 1–6 条和 Playwright 全项审计都是 CI 错误，自 P2 起）；背景第 1 节的宽度说明、P1 拆分；D4 页面外壳仍是插件页面的必选项 | — | 见「对前文的修订」 |

### 与推荐的差异

所有者给出的推荐中，组件包放在 zhinjs/zhin 还是 zhinjs/console 留待调查决定。调查结果支持放在 zhinjs/zhin（D2，理由见决策 1）。`zk-` 的删除原本推荐走 major，所有者改为 minor 即可（D11），分阶段计划和版本说明已按此调整。其余各项和推荐一致，只根据代码补充了三处细节：

1. 迁移范围主要是 3 个渲染器（34 个官方页面中有 33 个是声明式的），不是逐个改插件页面；
2. 命令面板现在已经索引插件路由，缺的是别名和插件名，所以 D7 的工作是补 `keywords` 和索引字段，不是「把插件页加进索引」；
3. 组件包必须由 Console 提供单例并自带编译好的 CSS（D3），否则手写 `.tsx` 页面会各自打包不同版本的组件，`remote-entry-style-contract.ts` 也删不掉；共享模块目前没有版本握手，需要新建（D3）。
4. 评审后补充：Sandbox 继续留在顶栏「会话」分区（D12），它的样式先搬进插件再改写（D13），`@zhin.js/client/ui` 中的非 UI 导出有明确去向（D14）。
5. 增补（zhinjs/console#111）：console#111 建议「插件不能自己写圆角、阴影、内边距」；所有者改为对插件页面只推荐、不强制，只保留会破坏外壳或用户的硬性底线，`zhin plugin check` 对偏离推荐的写法只提示、永不升级为错误（D19、D20）。对 Console 自身，这些规则仍然是强制的。
6. 增补的后续决定：所有者决定本仓库的官方插件完整遵守全部规则（「官方插件肯定要遵守规则的，我们都不遵守，还怎么推荐给开发者呢」）。D8 第 1–3 条、D20 第 4–6 条和 Playwright 全项审计（D15–D18 各项与 D19 底线）对官方插件都是 CI 错误，自 P2 起生效，之前只出报告；豁免只能是带理由、经评审的行内忽略注释（D19、D20、D22）。第三方插件不变。

## 落盘位置（计划）

| 内容 | 位置 |
| --- | --- |
| 组件包 | `packages/console/ui/`（`@zhin.js/console-ui`，新） |
| 渲染器 | `packages/console/client/client/ui/declarative-page.tsx`、`adapter-console/AdapterConsolePage.tsx`、`review-console/CommentReviewPage.tsx` |
| 弃用的 `zk-` 套件 | `packages/console/client/client/ui/components.tsx`、`ui/styles.ts`、`adapter-console/styles.ts`、`review-console/styles.ts`（P4 删除）；`ui/index.ts` 在弃用期内作为再导出层 |
| 非 UI 导出的新位置 | `packages/console/client/client/index.ts`（根入口） |
| 单例、版本核对与 import map | `packages/console/pagemanager/src/node/esmForBrowser.ts`（`ALLOWED_ESM_CANONICAL`、`HOST_PROXIED_MODULES`、`buildHostProxyModule`）、`packages/console/pagemanager/src/client-build/typescript-builder.ts`（`BROWSER_EXTERNALS`）、zhinjs/console `client/main.tsx`（`sharedModules`） |
| `cn()` | `packages/console/client/client/console-utils/cn.ts` 移入 `@zhin.js/console-ui`，原位置改为再导出 |
| Sandbox 样式 | zhinjs/console `console-ui/src/agent-playground.css`、`im-workspace.css` 移入 `plugins/adapters/sandbox/pages/index/` |
| 页面元数据 `keywords` | `@zhin.js/console-contract` 的 `packages/console/plugin-contract/src/page.ts`（事实来源）；`@zhin.js/page` 的 `packages/console/page/src/definition.ts` 透传 |
| 插件检查 | `basic/cli/src/plugin-check/` |
| Console 外壳、导航、命令面板 | zhinjs/console `console-ui/src/components/PageShell.tsx`、`layouts/dashboard.tsx`、`navigation-taxonomy.ts`、`navigation-sections.mjs`、`components/ConsoleCommandCenter.tsx`、`components/command-center-model.mjs`、`pages/plugin-detail.tsx`；删除 `remote-entry-style-contract.ts` |
| 文档 | `docs/authoring/console-pages.md`、`packages/console/client/README.md` |
