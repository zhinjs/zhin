---
sidebar: false
---

# ADR 0063：Console 与插件页面 UI 统一——一套组件库、一个页面外壳

状态：提议（Proposed，2026-11-14）。所有者的长期指示是「需要拍板的按推荐处理」，所以文末「决定」表中的 D1–D10 **默认按推荐执行**，D11（`zk-` 在 minor 中删除）是所有者已经给出的决定；所有者在本 ADR 的 PR 上没有提出异议，就视为接受，届时只需把状态改为「已接受（Accepted）」。被否决的替代选项保留在同一张表里作为记录。

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

这些数值来自 console.zhin.dev 当时部署的版本。当前 zhinjs/console `main` 中内容列的令牌是 `--console-content-max: 90rem`（`console-ui/src/design-system.css:56`）。**本 ADR 不规定具体宽度，只规定插件页与 Console 使用同一个令牌。**

### 2. 代码核实：两套组件库，只共享了一层变量

| 一侧 | 位置 | 内容 |
| --- | --- | --- |
| Console | zhinjs/console `console-ui/src/components/ui/*`（23 个 shadcn 风格组件，基于 `radix-ui`、`class-variance-authority`、Tailwind 4）；`PageShell.tsx`、`PageHeader.tsx`、`confirm-dialog.tsx`、`StatCard.tsx`、`empty-state.tsx` 等；样式在 `design-system.css`（3265 行）、`shell.css`（911 行）、`theme-tokens.css`（222 行） | Console 自带页面全部用它 |
| zhin | `packages/console/client/client/ui/components.tsx`（2048 行）、`styles.ts`（606 行），以 `@zhin.js/client/ui` 导出（约 50 个组件：`PluginPage`、`PageHeader`、`Button`、`Select`、`Modal` 等），类名前缀 `zk-`，不依赖 Tailwind | 声明式页面渲染器、适配器页、评论审批页、Sandbox 页 |

`styles.ts` 中的 `--zk-*` 变量取自 Console 的 `--primary`、`--console-radius-*`、`--console-control-height` 等变量，所以颜色和圆角大体一致；**但组件结构、布局和交互都是另外实现的**。核实到的具体差异：

- **宽度**：`.zk-page { max-width: 1180px; margin: 0 auto; display: grid; … }`（`styles.ts:100`）是写死的数值，和 Console 的 `--console-content-max` 是两套规则；实测宽度随内容变化，说明插件页的实际宽度由内容决定，不由外壳决定。
- **页头**：`DeclarativePageView` 自己渲染 `PageHeader`，左侧是标题首字母方块（`defaultMark = spec.mark ?? resolvedTitle.trim().slice(0, 1)`，`declarative-page.tsx:1448`），右侧是「更新于 hh:mm:ss」、原生 `<select className="zk-refresh-select">`（手动 / 5s / 15s / 30s 自动，`declarative-page.tsx:1521`）和「刷新」按钮。Console 的页头是 `PageHeader`（标题 + 说明 + 操作区），由 `PageShell` 包起来。
- **下拉框**：`zk` 的 `Select` 就是原生 `<select>`（`components.tsx:744`）。Console 用 Radix 的 `select.tsx` 和 `dropdown-menu.tsx`；Console 自己目前只在 `pages/introspection/GalleryPreview.tsx` 里还有两个原生 `<select>`。
- **危险操作**：Console 页面中，入口按钮用 `variant="outline"` 加 `text-destructive`（例如 `pages/plugin-detail.tsx:439`、`pages/ops/instance.tsx:167`），实心 `destructive` 只出现在确认步骤里（`ActionReceipt.tsx:216`、`ApplyFeedback.tsx:171`）。`zk` 的 `ConfirmButton` 和蓝图里 `variant: 'danger'` 的按钮都是实心红色。
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

- 插件页面通过 `app.addRoute` 注册成普通路由，`navigation-taxonomy.ts` 的 `placePluginRoute` 在页面没有声明 section 时把它放进「功能」（`DEFAULT_SECTION_ID = 'features'`，依据 ADR 0052）。所以 13 个插件或适配器页面和 Console 自己的功能页挤在同一个「功能」菜单里。
- 命令面板（`ConsoleCommandCenter.tsx`）索引的是 `app.getRoutes()` 里所有通过 `isCommandRoute` 的路由，**插件路由本来就在里面**，issue 中「插件页本来就没有进命令面板的索引」这一点和当前 `main` 的代码不符（可能是线上版本较旧，需在 P3 用测试确认）。真正的缺口是：插件页只能按标题和路径匹配；内置页有 `ROUTE_SEARCH_HINTS` 提供描述和同义词，插件页没有。`definePage()` 的元数据（`packages/console/page/src/definition.ts`）也没有 `keywords` 字段，所以插件没办法声明「抽奖」是「彩票推荐」的别名。另外 `isCommandRoute` 会排除带 `:param` 的路径，插件页改挂到 `/plugins/:name` 下面以后，必须注册具体路径才能被搜到。
- 插件详情页 `/plugins/:name`（`pages/plugin-detail.tsx`）目前没有页签，ADR 0062 第 24 项要求的「挂成页签」还没有落地。

## 决策

### 1. 只保留一套组件库：`@zhin.js/console-ui`，放在 zhinjs/zhin

把 Console 现有的组件（`components/ui/*` 和 `PageShell`、`PageHeader`、确认对话框、状态卡、空状态、错误提示等通用组件）抽成一个发布到 npm 的包 **`@zhin.js/console-ui`**，放在 **zhinjs/zhin 的 `packages/console/ui/`**。Console、`@zhin.js/client` 的渲染器、插件手写页面都从这个包取组件。`zk-` 套件在新包发布时弃用，官方页面迁移完成后，在之后的一个 minor 中删除（所有者决定不必等 major，见 D11）。

**为什么放在 zhinjs/zhin，而不是 zhinjs/console**：

- 组件的第一批使用者是 `@zhin.js/client` 里的 3 个渲染器，它们在 zhinjs/zhin；包放在同一个仓库，渲染器和组件可以在一个 PR 里一起改、一起测。
- zhinjs/console 是 `"private": true` 的静态站点，没有 npm 发布流程；zhinjs/zhin 已有 Changesets、`publish.yml` 和版本策略。
- Console 已经从 npm 依赖 `@zhin.js/client`、`@zhin.js/console-protocol`、`@zhin.js/contract`，`cn()` 也来自 `@zhin.js/client`。再多依赖一个包，方向和现在一致，不会出现循环依赖。
- 插件作者只需要认一个来源；`zhin plugin check`（`basic/cli/src/plugin-check/`）也在 zhinjs/zhin，规则可以直接引用组件清单。

代价是 Console 改组件要先在 zhinjs/zhin 发版。缓解办法：Console 开发时用 pnpm `link` 或 `overrides` 指向本地 checkout；只属于 Console 业务页面的组件（例如数据库页的可调宽度分栏、终端）留在 Console，不进公共包。

**包的约束**：

1. **自带编译好的 CSS，不依赖使用方的 Tailwind 扫描。** 包内部可以继续用 Tailwind 4 和 `cva` 写，但发布产物包含一份完整的 `@zhin.js/console-ui/styles.css`（令牌 + 组件样式），以及只含令牌的 `tokens.css`。Console 引入 `styles.css`，插件页面不需要任何构建配置。这样 `remote-entry-style-contract.ts` 就没有存在的理由了。
2. **令牌只有一份。** `theme-tokens.css` 和 `design-system.css` 中的令牌部分（颜色、圆角、控件高度、间距、阴影、`--console-content-max`）移到包里；Console 只保留自己业务页面的样式。弃用期内 `--zk-*` 作为别名指向同一组令牌，删除 `zk-` 时一起删除。
3. **由 Console 提供单例。** 把 `@zhin.js/console-ui` 加入 pagemanager 的 `HOST_PROXIED_MODULES` 和浏览器 import map，手写 `.tsx` 插件页拿到的就是 Console 已加载的那份组件和 CSS，不会因为插件打包的版本不同而长得不同。插件在 `package.json` 中把它声明为 `peerDependencies`；版本不兼容时沿用现有的能力握手提示，不静默降级。
4. **只给浏览器用。** 依赖（`radix-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`）只出现在这个包和 Console 里，不进 `zhin.js` 的依赖树，不影响 ADR 0019 的安装体积门禁。纯 `.ts` 蓝图插件仍然只依赖 `@zhin.js/console-contract`，不需要 React，也不需要这个包。
5. **深浅色都要验收。** 包内带一组视觉回归用例（亮 / 暗主题各一张），覆盖按钮、输入框、下拉框、表格、对话框和页面外壳。

### 2. 插件页面必须使用统一的页面外壳

插件页面不再自己写页头和容器。**页面外壳由 Console 渲染**：标题、说明、操作区、刷新控件和内容宽度都由外壳决定，宽度用 `--console-content-max`，和 Console 自带页面完全一致。插件只提供内容区块（`Section`、表格、表单、统计卡片等）。

- **声明式页面自动获得外壳。** `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 改成只渲染内容区块，页头由外壳根据蓝图的 `title`、`description`、无表单的 `actions` 和刷新设置生成。首字母方块（`mark`）删除；蓝图中的 `mark` 字段在弃用期内忽略并告警。
- **手写 `.tsx` 页面**的默认导出只渲染内容。需要页头操作或刷新控件时，调用 `@zhin.js/console-ui` 提供的 `usePageChrome({ actions, refresh })`，由外壳负责摆放。插件自己写的 `<h1>` 或页头组件属于违规（见决策 4）。
- **刷新控件统一。** 一个 `RefreshControl` 组件：「更新于 hh:mm:ss」+ 自动刷新间隔（Radix 下拉，选项手动 / 5s / 15s / 30s）+ 刷新按钮。Console 自带页面需要刷新时用同一个组件。
- **宽度例外只有一个**：工作区类页面（目前只有 Sandbox 聊天）可以用已有的 `definePage({ fullWidth: true })` 占满内容区，但仍然使用外壳的页头。
- 和 ADR 0062 第 24 项配合：插件页面挂到插件详情下以后，外壳的标题区就是插件详情的标题区（插件名、说明、状态），插件页面是其中一个页签的内容；页面自己的 `title` 变成页签名。

### 3. 导航与命令面板

1. **插件页面按 ADR 0062 第 24 项挂到插件详情下**，路径为 `/plugins/<插件名>/<页面名>`，在插件详情页里显示为页签；适配器页面挂在对应的适配器对象页下（同样按第 24 项，界面由 Console 统一渲染）。
2. **顶栏「功能」菜单只列 Console 自己的功能页。** 修订 ADR 0052：插件页面不再按 `metadata.section` 落到侧栏分区；`placePluginRoute` 不再默认放进「功能」。原来写了 `section` 的插件，弃用期内按插件详情页签处理并告警。
3. **命令面板按插件名、页面标题和别名搜索插件页面。** `definePage()` 增加 `keywords`（别名，可分语言）；插件页的命令面板条目包含插件名、包名、页面标题、插件说明和 `keywords`，分组为「插件」。插件页面必须注册具体路径，不能用 `:param` 路径，否则会被 `isCommandRoute` 排除。
4. 为避免旧书签失效，旧的顶层路径（例如 `/rss`）至少保留一个 minor 周期（和 `zk-` 一起删除），用重定向跳到新路径，并进入 `LEGACY_ROUTE_REDIRECTS`（命令面板因此不会重复显示）。

### 4. 约束手段

- **`zhin plugin check`** 新增三条检查，对插件的 `pages/**` 给出警告（不是错误）：
  1. 使用原生 `<select>`（JSX 中的 `<select`，或 `React.createElement('select')`）；
  2. 自定义页头：页面中出现 `<h1>`，或从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage`；
  3. 固定宽度：在页面根容器上写 `max-width` / `width` 的固定像素值，或在 `definePage` 之外自己设置内容宽度。
  P4 之后，第 2 条中「从 `@zhin.js/client/ui` 引入」会因为子路径被删除而直接构建失败；其余仍保持为警告，避免误伤第三方插件里的合理用法。官方插件在 CI 中把这些警告当作错误（`pnpm check:plugin`）。
- **文档只示范统一组件。** `docs/authoring/console-pages.md` 的「页面 UI 套件」一节改为介绍 `@zhin.js/console-ui` 和页面外壳；删除 `zk-` 写法的示例；新增「页面外壳负责什么、插件负责什么」一节，并按 ADR 0062 第 24 项增加「什么时候不该写插件页面」。`@zhin.js/client` README 中的 UI 套件清单改为指向新包。

### 5. 危险操作的样式

和 Console 一致：**页面上的危险操作按钮用描边样式**（`outline` 加 `text-destructive`），点击后弹出确认对话框；**实心红色按钮只出现在确认对话框的确认按钮上**。不可撤销的操作（删除数据、清空记录）沿用 Console 的 `confirmText`：要求输入对象名后才能确认。

- `@zhin.js/console-ui` 的 `Button` 增加 `variant="destructive-outline"`（等价于 Console 现在的 `outline` + `text-destructive`），Console 自带页面同步替换为这个变体。
- 蓝图中 `variant: 'danger'` 的动作一律渲染为描边按钮；若蓝图没有写 `confirm`，渲染器自动补一个默认确认文案（「确认<动作名>？」）。所以 RSS「移除订阅」这类按钮不需要修改插件就会改变样式。

### 6. 不在本 ADR 范围

- 插件页自身的信息设计（进程监控重复列数值、群管套件显示原始会话键、RSS 手填推送目标等）。这些由 #1262 和 ADR 0062 第 24 项的实施 PR 处理；本 ADR 只保证这些修复用统一组件来做。
- Console 业务页面自己的布局（例如数据库页、终端、Agent 工作台），只要它们用同一套组件和令牌即可。
- 新的设计语言或视觉改版。本 ADR 以 Console 当前的视觉为准（zhinjs/console#95 之后的版本），只做收敛。

## 备选方案

- **A. 反过来，Console 也改用 `zk-` 套件，作为唯一的组件库**（issue 中的方向 b）。不采用：Console 的组件更完整（基于 Radix 的下拉、对话框、弹出层、焦点管理和无障碍支持），也是用户看得最多的部分；`zk-` 的 `Select` 是原生控件，要补齐就等于重写一遍 Radix。
- **B. 两套并存，只再加一层共享令牌，把宽度、页头样式对齐。** 不采用：现在已经共享了颜色和圆角变量，问题出在组件结构和交互；只对齐变量，下拉框、对话框、危险按钮还是两套，`remote-entry-style-contract.ts` 这类补丁也会继续增加。
- **C. 包放在 zhinjs/console，由 Console 发布。** 不采用：Console 仓库没有发布流程；渲染器和插件检查都在 zhinjs/zhin，放在 Console 会让每次渲染器改动都跨仓库发版。
- **D. 插件页面用 iframe 隔离，各自带样式。** 不采用：样式和交互会更不统一，深浅色切换、权限和路由都要另外通信。
- **E. 只做页面外壳，组件库以后再说。** 不采用：外壳只能解决宽度和页头；下拉框、按钮高度和危险按钮样式这些验收项都依赖组件统一。

## 分阶段计划

版本级别按 `.changeset/version-policy.json`：默认是 patch，minor 及以上需要所有者批准。新包首发为 minor（`0.1.0` 起，进入正式发布时转为 `1.0.0`）。删除 `@zhin.js/client/ui` 子路径和 `zk-` 类名虽然对第三方手写页面是破坏性的，但所有者决定**走 minor，不等 major**（D11）：P2 发布时弃用并告警，至少经过一个 minor 的弃用期（与 ADR 0062 Q0b「至少告警一个 minor」的节奏一致），在之后的 minor（P4）中删除。`@zhin.js/client/ui` 不在 `public-api-surface` 的 `stable` 清单中，所以不受「`stable` 入口到 major 才删除」的限制。

| 阶段 | 内容 | 涉及的包 | 版本 | 验收 |
| --- | --- | --- | --- | --- |
| P0 ADR | 本 ADR；索引登记 | `docs/adr` | — | 所有者确认 D1–D10（D11 已定） |
| P1 组件包与外壳 | 新建 `packages/console/ui`（`@zhin.js/console-ui`）：从 Console 迁入 `components/ui/*`、`PageShell`、`PageHeader`、确认对话框、状态卡、空状态、错误提示、`RefreshControl`、`usePageChrome`、`destructive-outline` 变体；令牌移入 `tokens.css`，产出 `styles.css`；视觉回归用例。Console 改为从包中引入，`--zk-*` 改为别名；pagemanager 把包加入 `HOST_PROXIED_MODULES`；`definePage` 增加 `keywords` | `@zhin.js/console-ui`（新）、`@zhin.js/pagemanager`、`@zhin.js/page`、`@zhin.js/console-contract`、zhinjs/console | 新包 minor；pagemanager / page / contract minor；Console minor | Console 自带页面外观不变（视觉回归无差异）；Console 构建不再依赖 `remote-entry-style-contract.ts` 中的类名 |
| P2 迁移官方页面 | `DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 改用新组件，只渲染内容区块，页头交给外壳；`variant: 'danger'` 改为描边加确认；删除首字母方块；Sandbox 页改用新组件并删除 `remote-entry-style-contract.ts`；`@zhin.js/client/ui` 和 `zk-` 类名标记弃用（首次使用时控制台告警一次） | `@zhin.js/client`、`@zhin.js/adapter-sandbox`、zhinjs/console | minor（client、Console）；sandbox patch | 任意插件页和 Console 自带页并排打开，深浅色下内容宽度、页头结构、下拉框、按钮样式一致；插件页中没有原生 `<select>`；`remote-entry-style-contract.ts` 已删除 |
| P3 导航与命令面板 | 插件详情页加页签，插件页面挂到 `/plugins/<插件名>/<页面名>`，适配器页挂到适配器对象页；顶栏「功能」只保留 Console 功能页；旧顶层路径重定向；命令面板按插件名、包名、页面标题、`keywords` 索引插件页；官方插件补 `keywords`（例如彩票推荐补「抽奖」） | zhinjs/console、`@zhin.js/client`（路由注册）、官方插件 | Console minor；官方插件 patch | 命令面板能搜到所有插件页面（含别名，有测试）；顶栏「功能」菜单里没有插件页面 |
| P4 检查与删除 | `zhin plugin check` 三条警告；官方插件 CI 中视为错误；文档只示范统一组件；在 P2 之后至少一个 minor 的弃用期结束后，删除 `@zhin.js/client/ui`、`zk-` 类名、`--zk-*` 别名、蓝图 `mark` 字段和旧顶层路径重定向 | `@zhin.js/cli`、`@zhin.js/client`、`docs/authoring/console-pages.md` | 检查与文档：`@zhin.js/cli` minor；删除：`@zhin.js/client` minor（弃用期 ≥ 1 个 minor） | 新写的插件页不使用 `zk-`；`check:plugin` 对官方插件零警告 |

P1 和 P2 可以在同一个 release 中发布，但必须分开 PR：P1 只改 Console 的引入方式，外观不变，便于用视觉回归确认没有退化。P3 依赖 ADR 0062 第 24 项的插件详情页签，可以和第 24 项的实施 PR 合并。

## 风险

- **第三方插件的手写页面**：它们可能直接用了 `@zhin.js/client/ui` 或 `zk-` 类名。缓解办法：弃用期至少一个 minor，首次使用时告警；`zhin plugin check` 给出替换建议；升级文档列出 `zk-` 组件到新组件的对照表。
- **Console 与插件版本错位**：插件页面按新外壳写，但用户的 Console 还是旧版本。缓解办法：沿用能力握手，Console 版本不支持外壳时，渲染器退回到在内容区内自己画页头（只在弃用期内保留这条路径）。
- **跨仓库发版节奏**：Console 修改公共组件要先在 zhinjs/zhin 发版。缓解办法：公共包只收通用组件；Console 业务组件留在 Console；开发时用本地 link。
- **视觉回归噪声**：抽包时 CSS 层级（`@layer`）顺序变化，可能让 Console 页面出现细微差异。缓解办法：P1 只迁移、不改样式，用视觉回归逐页比对。
- **ADR 之间的依赖**：P3 依赖 ADR 0062 第 24 项；导航修订会改变 ADR 0052 中插件页面的放置规则。

## 决定

所有者的长期指示是「需要拍板的按推荐处理」，下表的「决定」一列即为推荐，默认生效；D11 是所有者在起草过程中直接给出的决定，覆盖了原来「`zk-` 在 major 删除」的推荐。

| # | 项 | 决定（推荐，默认生效） | 被否决的替代选项 | 影响 |
| --- | --- | --- | --- | --- |
| D1 | 组件库 | 只保留一套：把 Console 的组件抽成 `@zhin.js/console-ui`，插件页和适配器页改用它，`zk-` 在新包发布时弃用，官方页面迁移完成、经过至少一个 minor 的弃用期后，在 minor 中删除 | Console 改用 `zk-`（方向 b）；两套并存只共享令牌 | 新增一个包；`@zhin.js/client/ui` 走弃用流程 |
| D2 | 包放在哪 | zhinjs/zhin 的 `packages/console/ui/`，Console 从 npm 依赖它 | 放在 zhinjs/console 发布 | Console 改公共组件要先在 zhinjs/zhin 发版 |
| D3 | 样式交付 | 包自带编译好的 `styles.css` 和 `tokens.css`，由 Console 提供单例（加入 `HOST_PROXIED_MODULES`）；删除 `remote-entry-style-contract.ts` | 插件页继续靠 Console 的 Tailwind 扫描和手写类名清单 | pagemanager 的 import map 增加一项 |
| D4 | 页面外壳 | 插件页必须使用外壳：标题、说明、操作区、刷新控件、宽度由外壳决定，宽度用 `--console-content-max`；插件只提供内容区块；声明式页面自动获得；唯一例外是 `fullWidth` 工作区页 | 外壳可选，只在文档中推荐 | 删除首字母方块和插件自绘页头 |
| D5 | 刷新控件 | 统一的 `RefreshControl`（Radix 下拉），Console 与插件页共用 | 各页保留自己的刷新控件 | 删除原生 `zk-refresh-select` |
| D6 | 导航 | 插件页按 ADR 0062 第 24 项挂成插件详情页签；顶栏「功能」只列 Console 自己的功能页；修订 ADR 0052 的插件页放置规则；旧路径重定向至少保留一个 minor 周期 | 插件页继续进侧栏分区 | 插件的 `metadata.section` 弃用 |
| D7 | 命令面板 | 按插件名、包名、页面标题、插件说明和新增的 `definePage({ keywords })` 别名索引插件页 | 只按页面标题索引 | `definePage` 元数据增加一个字段 |
| D8 | 约束手段 | `zhin plugin check` 对原生 `<select>`、自定义页头、固定宽度给出警告，官方插件在 CI 中视为错误；`console-pages.md` 只示范统一组件 | 只写成文档约定 | 新增三条检查 |
| D9 | 危险操作 | 描边按钮（`destructive-outline`）加确认对话框，实心红色只用于确认按钮；蓝图的 `danger` 动作自动补确认 | 保留实心危险按钮 | RSS 等页面的危险按钮样式改变，无需改插件 |
| D10 | 分阶段与版本 | P0 ADR → P1 抽包与外壳 → P2 迁移官方页面 → P3 导航与命令面板 → P4 检查与删除；新包 minor；删除 `zk-` 也走 minor（见 D11） | 一次性切换 | 见「分阶段计划」 |
| D11 | `zk-` 删除的版本级别 | **所有者决定**（2026-11-14，「zk 不用大版本删除，minor 就可以」）：`zk-` 套件、`@zhin.js/client/ui` 子路径、`--zk-*` 别名和蓝图 `mark` 字段在 minor 中删除；P2 发布时弃用（首次使用告警一次、文档标注），至少经过一个 minor 的弃用期后在 P4 的 minor 中删除 | 等到下一个 major 再删除（原推荐） | 第三方手写页面需在弃用期内迁移；升级文档给出对照表 |

### 与推荐的差异

所有者给出的推荐中，组件包放在 zhinjs/zhin 还是 zhinjs/console 留待调查决定。调查结果支持放在 zhinjs/zhin（D2，理由见决策 1）。`zk-` 的删除原本推荐走 major，所有者改为 minor 即可（D11），分阶段计划和版本说明已按此调整。其余各项和推荐一致，只根据代码补充了三处细节：

1. 迁移范围主要是 3 个渲染器（34 个官方页面中有 33 个是声明式的），不是逐个改插件页面；
2. 命令面板现在已经索引插件路由，缺的是别名和插件名，所以 D7 的工作是补 `keywords` 和索引字段，不是「把插件页加进索引」；
3. 组件包必须由 Console 提供单例并自带编译好的 CSS（D3），否则手写 `.tsx` 页面会各自打包不同版本的组件，`remote-entry-style-contract.ts` 也删不掉。

## 落盘位置（计划）

| 内容 | 位置 |
| --- | --- |
| 组件包 | `packages/console/ui/`（`@zhin.js/console-ui`，新） |
| 渲染器 | `packages/console/client/client/ui/declarative-page.tsx`、`adapter-console/AdapterConsolePage.tsx`、`review-console/CommentReviewPage.tsx` |
| 弃用的 `zk-` 套件 | `packages/console/client/client/ui/components.tsx`、`styles.ts`（P4 删除） |
| 单例与 import map | `packages/console/pagemanager/src/node/esmForBrowser.ts` |
| 页面元数据 `keywords` | `packages/console/page/src/definition.ts`、`@zhin.js/console-contract` |
| 插件检查 | `basic/cli/src/plugin-check/` |
| Console 外壳、导航、命令面板 | zhinjs/console `console-ui/src/components/PageShell.tsx`、`layouts/dashboard.tsx`、`navigation-taxonomy.ts`、`navigation-sections.mjs`、`components/ConsoleCommandCenter.tsx`、`components/command-center-model.mjs`、`pages/plugin-detail.tsx`；删除 `remote-entry-style-contract.ts` |
| 文档 | `docs/authoring/console-pages.md`、`packages/console/client/README.md` |
