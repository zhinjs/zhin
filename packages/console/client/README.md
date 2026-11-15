# @zhin.js/client

Remote Console **浏览器 SDK**（entries 加载、路由/工具注册、带 Token 的 REST，以及少量可复用页面组件）。完整壳层在独立仓库 [zhin-console](https://github.com/zhinjs/console)。

> **路径约定**：本包位于 `packages/console/client/`（npm `@zhin.js/client`）。源码在 `client/`，构建产物在 `dist/`。

## 安装

```bash
pnpm add @zhin.js/client
```

Peer：`react >= 18`（`createPluginRegisterHostApi` 需要 React 引用）。

## 概览

| 导出 | 用途 |
|------|------|
| `loadConsoleEntries` | 拉 `GET /entries`、动态 import 各 entry、调用 `register(hostApi)` |
| `createConsoleClient` | 创建一个拥有路由、工具、运行时环境与网络连接的 Console 实例 |
| `ConsoleClientProvider` | 将 Console 实例提供给 `useConsoleTransport` 等 React hooks |
| `apiFetch` | 相对 Host API Base 的 `fetch`，自动附加 `Authorization: Bearer` |
| `getApiBase` / `getToken` | 读取登录页写入 `localStorage` 的 API Base 与 Token |
| `createRegistryStore` / `useRegistry` | 可选 registry store |
| `ENDPOINT_RPC` / `INBOX_RPC` / `SIDE_EVENT_RPC` / `SIDE_EVENT_PUSH` | `@zhin.js/console-protocol` 的规范 RPC 与推送名称 |
| `parseConsoleInboxEvent` | 校验并分类 canonical message/request/notice 推送 |
| `ConsoleEndpointSummary` / `EndpointManagementCapability` | Host 与 Remote Console 共享的 Endpoint wire 类型 |
| `fetchConsoleEventHistory` | 按 `(runtimeId, eventId)` 拉取有界事件历史 |
| `ConsoleTransport.onConsoleEvent` | 订阅带 `live/history` 投递来源的强类型事件 |
| `ConsoleTransport.onConsoleEventRecoveryGap` | 观察不可续接游标并触发领域全量重同步 |
| `ConsoleInboxNoticesQuery` / `ConsoleInboxNoticesResult` | 以 `unreadOnly` 从持久 Inbox 重建未读通知 |
| `createAdapterConsolePage` / `AdapterConsolePage` | 平台适配器 Console 页的共享页面（连接、endpoint 增删、登录待办、适配器动作） |
| `DeclarativePageView` / `createDeclarativePage` / `DataTable` | 声明式页面渲染器（基于 `@zhin.js/console-ui`，只渲染内容区块，页头交给页面外壳） |
| `usePluginRpc` / `usePluginData` / `useRpcResource` / `useLocale` / `resolvePluginId` | 插件页的数据、语言与插件 ID 工具（原 `@zhin.js/client/ui`，见下文“插件页：组件与页面外壳”） |
| `@zhin.js/client/ui` | **已弃用**（ADR 0063 P2）：弃用期内原样再导出，首次使用告警一次，后续 minor 删除 |
| `resolveAdapterConsolePluginId` | 从 `/console/api/pages` 解析当前适配器页所属的 PluginId |

类型与 Entry 契约来自 `@zhin.js/contract`。

业务 UI 应使用 SDK 导出的协议常量和 Endpoint 类型，不要复制 RPC 字符串或 `EndpointInfo`。请求使用顶层 camelCase payload，Host 推送使用 `message.receive` / `request.receive` / `notice.receive` 和 canonical `adapter`、`endpointKey`、`channelId` 字段。

## 适配器 Console 页面

平台适配器包用 `createAdapterConsolePage(adapterKey)` 生成页面，服务端用 `@zhin.js/adapter` 的 `createAdapterConsoleRpc` 提供 `plugin.<pluginId>.status` / `endpoint-add` / `endpoint-remove`：

```ts
// plugins/adapters/telegram/pages/index/index.ts
import { definePage } from '@zhin.js/console-contract';
import { createAdapterConsolePage } from '@zhin.js/client';

export const meta = definePage({
  title: 'Telegram',
  icon: 'Send',
  requiredPermissions: ['telegram:read'],
});

export default createAdapterConsolePage('telegram');
```

页面会读取 `endpoint.list` / `endpoint.test` / `login.list`，并调用适配器自己的 `plugin.<pluginId>.*` RPC；凭据永远不会展示，只显示 `${ENV}` 引用或遮蔽值。

宿主页面（例如 Console 的适配器概览）要把它嵌进自己的页面时，用嵌入模式：标题与「刷新」由宿主渲染，SDK 不再画页头，页面动作（文档 / 添加）交给宿主用自己的按钮渲染：

```tsx
import { AdapterConsolePage } from '@zhin.js/client';

<AdapterConsolePage
  adapterKey="telegram"
  embedded
  refreshKey={refreshCount}            // 宿主「刷新」每点一次 +1，SDK 随之重读
  toolbar={({ docsUrl, add }) => add ? (
    <HostButton aria-expanded={add.open} aria-controls={add.controls} disabled={add.disabled} onClick={add.toggle}>
      {add.open ? '取消' : '添加账号'}
    </HostButton>
  ) : null}
/>
```

`embedded` 不传 `toolbar` 时显示 SDK 自带的「文档」「添加」（没有「刷新」）。嵌入模式不向页面外壳上报页头（`usePageChrome`），免得覆盖宿主页的页头；独立页面则把标题、说明、「文档」「添加」和刷新控件交给外壳。需要兼容旧版 SDK 的宿主可读 `AdapterConsolePage.capabilities`（或导出的 `ADAPTER_CONSOLE_PAGE_CAPABILITIES`）判断是否支持；旧版会忽略这些属性。

### 宿主自己画账号行（headless）

宿主要把账号的状态、启停开关和操作并进自己的账号列表时，用 `AdapterAccountsProvider` 包住宿主列表和 SDK 页：两者共用同一份读取、同一套 revision / 迁移确认 / `commit_unknown` 处理。`useAdapterAccounts()` 返回账号行（`rows`：状态、`enabled` 与开关文字 `enabledLabel`「运行中 / 已停止」、`setEnabled` / `start` / `stop` / `edit` / `remove` / `test`、`can`、`busy`、`disabled`）以及 `notice`、`migration`（确认 / 取消）、`migrate`（「立即迁移」）、`blocked`、`add`、`editing`。`AdapterAccountEditor` 只渲染编辑表单（`row.edit()` 打开）。SDK 页传 `hostAccounts` 后不再画账号列表、编辑表单和账号状态提示，只保留添加表单、登录待办与平台操作：

```tsx
import { AdapterAccountEditor, AdapterAccountsProvider, AdapterConsolePage, useAdapterAccounts } from '@zhin.js/client';

<AdapterAccountsProvider adapterKey="telegram" refreshKey={refreshCount}>
  <HostAccountTable />                 {/* useAdapterAccounts().rows → 每行：状态、开关、编辑 / 删除 */}
  <AdapterAccountEditor />
  <AdapterConsolePage adapterKey="telegram" embedded hostAccounts toolbar={hostToolbar} />
</AdapterAccountsProvider>
```

**`hostAccounts` 时宿主必须渲染迁移确认**：SDK 页不再画 `notice`、`blocked` 与迁移确认，账号编辑 / 启停在需要迁移时只会把确认放进 `useAdapterAccounts().migration`（`ids`、`busy`、`confirm()`、`cancel()`）。宿主不渲染它，这类操作就会停在等待确认、看起来没有反应；同样应展示 `notice`（含 `commit_unknown` 提示）与 `blocked`。

```tsx
const { migration } = useAdapterAccounts();
{migration && (
  <ConfirmDialog
    open
    onOpenChange={open => { if (!open) migration.cancel(); }}
    title="确认迁移"
    description={`需要先把 ${migration.ids.join('、')} 迁移到数据库。`}
    confirmLabel="确认迁移"
    onConfirm={migration.confirm}
  />
)}
```

只想换掉 SDK 卡片内容时，传 `renderRow={row => …}`（拿到同样的账号行）。`capabilities` 里的 `renderRow` / `hostAccounts` 标明支持。

## 插件页：组件与页面外壳

插件页面的组件来自 [`@zhin.js/console-ui`](../ui/README.md)（Console 自己用的同一套组件、令牌与编译好的 `styles.css`），页头由 Console 的**页面外壳**负责（[ADR 0063](../../../docs/adr/0063-console-plugin-ui-unification.md) 决策 2）：标题、说明、页头操作和刷新控件由外壳摆放，页面只渲染内容区块。本包提供数据、语言和插件 ID 工具：

```tsx
import { usePluginRpc, useLocale } from '@zhin.js/client';
import { Button, ErrorAlert, Section, Skeleton, usePageChrome } from '@zhin.js/console-ui';

export default function Page() {
  const { t } = useLocale();
  const status = usePluginRpc<{ items: string[] }>('root/my-plugin', 'status');
  // 页头操作与刷新交给外壳；返回 false 表示外层没有外壳（旧版 Console），可以自己画。
  usePageChrome({
    actions: <Button size="sm" onClick={() => void status.refresh()}>{t('重新同步')}</Button>,
    refresh: { onRefresh: status.refresh, updatedAt: status.lastSuccessAt ?? null, refreshing: status.refreshing },
  });
  if (status.state === 'loading') return <Skeleton className="h-4 w-full" />;
  if (status.state === 'error') return <ErrorAlert error={t('读取状态失败，请稍后重试。')} technicalDetail={status.error?.message} onRetry={() => void status.refresh()} />;
  return <Section title={t('账号')}>…</Section>;
}
```

| 导出（`@zhin.js/client` 根入口） | 说明 |
|------|------|
| `usePluginRpc(pluginId, method, params?, { pollMs?, pauseWhenHidden? })` | 返回 `state`（`loading` / `empty` / `ready` / `error` / `stale`）、`data`、`error`、`lastSuccessAt`、`refreshing`、`refresh()`、`mutate()`；失败时保留上次成功数据，并丢弃过期响应 |
| `usePluginData` / `useRpcResource(key, load, options)` | 同一套四态读取的其他形态，可用于 `consoleRpc` 等读取 |
| `useLocale(dictionary?)` / `detectLocale` / `translate` / `formatClock` | 以中文原文为键的页面文案与语言 |
| `resolvePluginId` / `resolveSyncPluginId` / `resolveAdapterConsolePluginId` | 解析页面所属 PluginId |
| `DeclarativePageView` / `createDeclarativePage` | 声明式页面渲染器 |
| `DataTable` | 基于 `@zhin.js/console-ui` 表格的数据表：搜索、排序、分页、多选与批量操作、行操作、可展开行；容器窄于 40rem 时每行变成一张卡片 |

### 渲染器的行为（ADR 0063 P2）

`DeclarativePageView`、`AdapterConsolePage`、`CommentReviewPage` 三个渲染器都改用 `@zhin.js/console-ui`，不再注入任何 `zk-` 样式：

- **只渲染内容区块**：标题、说明、无表单的动作、状态徽标和 `RefreshControl`（更新于 hh:mm:ss、手动 / 5s / 15s / 30s 自动、刷新）通过 `usePageChrome` 交给外壳；外层没有 `PageChromeProvider`（旧版 Console）时，渲染器在内容区顶部自己画 `PageHeader`。`AdapterConsolePage embedded` 仍由宿主负责页头，不上报。
- **首字母方块删除**：蓝图的 `mark` 字段被忽略，使用时控制台告警一次（后续 minor 删除）。
- **危险操作**：`variant: 'danger'` 一律渲染为 `destructive-outline` 描边按钮，点击后弹出确认对话框；蓝图没写 `confirm` 时自动用「确认<动作名>？」；实心红色只出现在对话框的确认按钮上；`confirmText`（输入对象名后才能确认）照常可用。
- **没有原生 `<select>`**：选择字段、自动刷新间隔、适配器页的布尔字段和平台动作选项都用 Radix 下拉。
- **展示规则（D15）**：统计卡片用 `auto-fit` 弹性网格（手机上两列），表格在窄容器里变成卡片，正常状态的徽标弱化、只有异常着色，JSON 与自动卡片里的原始 ID 默认收在「查看 JSON」/「技术详情」里。
- 宿主可读 `DeclarativePageView.capabilities` / `ADAPTER_CONSOLE_PAGE_CAPABILITIES` 的 `pageChrome: true` 判断渲染器是否会上报页头。

### 从 `@zhin.js/client/ui` 升级

`@zhin.js/client/ui` 弃用：弃用期（至少一个 minor）内它原样再导出下面的名字和旧的 `zk-` 组件，首次导入时在浏览器控制台告警一次；`zk-` 类名同样弃用。之后的 minor（ADR 0063 P4）删除该子路径、`zk-` 组件与样式。

| 原导出（`@zhin.js/client/ui`） | 去向 |
| --- | --- |
| `usePluginRpc`、`usePluginData`、`useRpcResource` 及其类型 | `@zhin.js/client` 根入口 |
| `useLocale`、`detectLocale`、`translate`、`formatClock` 及其类型 | `@zhin.js/client` 根入口 |
| `resolvePluginId`、`resolveSyncPluginId`、`resolveAdapterConsolePluginId` | `@zhin.js/client` 根入口 |
| `DeclarativePageView`、`createDeclarativePage`、`DataTable` 及声明式类型 | `@zhin.js/client` 根入口（`DataTable` 改为基于 `@zhin.js/console-ui` 的表格；列的 `fixed` 与 `responsiveStack` 不再起作用：窄容器里自动变卡片） |
| `Button` | `@zhin.js/console-ui` 的 `Button`：`primary` → `variant="default"`，`secondary` → `outline`，`danger` → `destructive-outline`（外加确认对话框）；没有 `busy` / `icon` 属性，把图标放进 children，忙碌时设 `disabled` 与 `aria-busy` |
| `Badge` | `Badge`：`tone` → `variant`（`danger` → `destructive`，`neutral` → `outline`，正常状态用 `secondary`） |
| `Select` | `SelectField`（`options` / `value` / `onValueChange`，Radix 下拉）；长列表用 `SearchableSelectField` |
| `Modal` / `Drawer` | `Dialog` / `Sheet` |
| `ConfirmButton` | `Button variant="destructive-outline"` + `ConfirmDialog`（或 `useConfirm()`） |
| `Card` / `Section` / `Stack` / `Grid` | `Card`、`Section`、`ContentStack`、`Grid` |
| `Tabs` / `Input` / `Textarea` / `Switch` / `Checkbox` / `RadioGroup` | 同名组件（Radix 版本：`onValueChange` / `onCheckedChange`） |
| `Notice` / `ErrorState` / `EmptyState` / `LoadingState` | `Alert`、`ErrorAlert`、`EmptyState`、`LoadingBlock` |
| `StatCard` / `StatGrid` / `ProgressBar` / `Sparkline` / `Timeline` / `DescriptionList` / `JsonView` | `StatCard` / `StatGrid`、`ProgressMeter`、`Sparkline`、`Timeline`、`KeyValueList`、`JsonBlock`（放进 `Disclosure`） |
| `PluginPage`、`PageHeader` | 无对应组件：页头由页面外壳负责，手写页面用 `usePageChrome({ actions, refresh })` |
| `pluginUiStyles`、`adapterConsoleStyles`、`conversationPickerStyles` | 无：样式由 Console 加载的 `@zhin.js/console-ui/styles.css` 提供（`adapterConsoleStyles` / `conversationPickerStyles` 弃用期内是空字符串） |

### 布局审计的挂载模块

`audit/mount-plugin-page.tsx`（仓库内，不随包发布）导出 `mountPluginPage({ element, pageModule, pageName, theme, renderInShell })`，供 `@zhin.js/console-ui/audit` 的 `auditPluginPages` 渲染声明式蓝图页、适配器页和评论审批页：设 `ZHIN_UI_AUDIT_MOUNT_MODULE=packages/console/client/audit/mount-plugin-page.tsx`。它不连 Host：`audit/fixtures.ts` 替换 `window.fetch`，`plugin.<id>.status` 返回夹具数据（蓝图页按蓝图读取的 `dataKey` / 表达式路径 / 表格列类型生成样例，表格三行；适配器页一个在线账号；评论审批页一个账号一条待审草稿），`endpoint.list` / `login.list` / 其他 RPC 返回固定样例或 `{}`，其他 HTTP 接口（Agent Trace、Sandbox 历史、外部资源）返回 404，页面显示「不可用」状态。`pnpm check:plugin-ui-audit` 默认使用这个模块。

## 评论审批页

「AI 起草 → 人工审批 → 发送」类的评论回复适配器（Bilibili、掘金…）用 `createCommentReviewPage(spec)` 生成整页：账号区、登录状态、草稿卡片（修改 / 发送 / 丢弃草稿，丢弃走确认对话框）、可关闭的错误提示、刷新失败时的“数据可能已过期”，组件来自 `@zhin.js/console-ui`，页头交给页面外壳。页面会先解析 PluginId，再读 `plugin.<pluginId>.status` 并调用 `edit` / `send` / `drop` 与你声明的登录动作。

```tsx
import { createCommentReviewPage, ReviewResourceList } from '@zhin.js/client';

export default createCommentReviewPage({
  adapter: 'juejin',                              // 解析 PluginId
  platform: { zh: '掘金', en: 'Juejin' },
  resource: { zh: '文章', en: 'articles' },
  account: endpoint => ({ id: endpoint.login.userId, name: endpoint.login.userName }),
  draftResource: (draft, t) => t('文章 {0}', draft.articleId),
  renderLoginExtras: (endpoint, { t, act, pending }) => /* 如“重新检查登录”按钮：act('login-check') */ null,
  renderResources: (endpoint, { t, noun }) => <ReviewResourceList title={t('管理的{0}', noun)} items={[]} />,
  dictionary: { '文章 {0}': 'Article {0}' },       // 中文原文 → English
  isLoginPending: endpoint => endpoint.qr.state === 'waiting', // 此时轮询由 10 秒加快到 2 秒（pendingPollMs）
});
```

`status` 返回 `{ endpoints: [{ id, sendMode, persistent, circuit, login: { state }, pendingCount, drafts }], updatedAt }`，草稿含 `id / url / message / status / interrupted / createdAt / author? / original?`（见 `ReviewEndpointBase` / `ReviewDraftBase`）。上次发送被中断或结果未知的草稿会显示“结果未确认”警告。

## 启动：加载插件 Console Entry

Remote Console 壳层在登录后调用：

```tsx
import React from "react";
import {
  ConsoleClientProvider,
  createConsoleClient,
  loadConsoleEntries,
} from "@zhin.js/client";

const client = createConsoleClient({
  getRuntimeEnv: () => import.meta.env.DEV ? "development" : "production",
});
const hostApi = client.createPluginRegisterHostApi(React);

await loadConsoleEntries({
  hostApi,
  // Remote Console：Host 监听地址，用于解析 /@dev、/@assets 模块 URL
  assetOrigin: "http://127.0.0.1:8068", // 与 Host 的 http.port 一致（create-zhin 项目为 8068）
  fetchInit: () => ({
    headers: { Authorization: `Bearer ${localStorage.getItem("zhin_api_token")}` },
  }),
  onFetchError: (status) => console.error("entries fetch failed", status),
  onEmpty: () => console.warn("no console entries"),
});

// 壳层根组件必须为 hooks 提供同一个 client 所有者。
export function ConsoleRoot({ children }: { children: React.ReactNode }) {
  React.useEffect(() => () => client.dispose(), []);
  return <ConsoleClientProvider client={client}>{children}</ConsoleClientProvider>;
}
```

`loadConsoleEntries` 内部：`fetchConsoleEntries` → `registerConsolePluginsFromEntries` → 各 entry 模块的 `register` 或 `default.register`。

插件 `client/` 入口示例：

```tsx
import type { PluginRegisterHostApi } from "@zhin.js/contract";

export async function register(hostApi: PluginRegisterHostApi) {
  hostApi.addRoute({
    path: "/my-plugin",
    name: "My Plugin",
    element: hostApi.React.createElement(MyPage),
    icon: "Puzzle",
  });
}
```

## Host API 请求

登录页将 API Base 与 Token 存入 `localStorage`（键 `zhin_api_base`、`zhin_api_token`）。业务请求使用 `apiFetch`：

```ts
import { apiFetch } from "@zhin.js/client";

const res = await apiFetch("/api/console/request", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "system.status", params: {} }),
});
```

401 由 `handleUnauthorized()` 统一处理，`apiFetch` 与 `ConsoleTransport`（RPC、REST、SSE）走同一条路径：清除 runtime（`window.__ZHIN_API_TOKEN`）、`localStorage`、`sessionStorage` 中的 Token 并派发 `zhin:auth-required`。请求发出后 API Base 或 Token 已被替换的迟到 401 会被忽略。

辅助：`resolveApiUrl`。

Client 在连接 `/api/events` 前先补拉 `/api/events/history`，再携带最新游标进入 SSE；Host 会原子重放 HTTP 与订阅之间产生的事件。游标只在 Inbox 持久化成功后推进，重复的 history/live 投递按 `(runtimeId, eventId)` 幂等写入 IndexedDB。`gap` 不会被吞掉，页面可订阅恢复缺口并改走领域 HTTP 全量投影。

## Console 实例所有权

每个 Remote Console mount 创建一个 `ConsoleClient`。插件注册、React hooks 和卸载必须使用同一个实例，多个 mount 之间不会共享路由、工具、运行时环境或连接状态：

```ts
import React from "react";
import { createConsoleClient } from "@zhin.js/client";

const client = createConsoleClient();
const hostApi = client.createPluginRegisterHostApi(React);
await loadConsoleEntries({ hostApi });
```

## 低级 API

- `fetchConsoleEntries(options?)` — 仅拉 JSON，不 import
- `registerConsolePluginsFromEntries(entries, hostApi, ...)` — 已知 entries 列表时注册
- `getRegisterFn(mod)` — 从动态模块解析 `register` 导出
- `ConsoleTransport.sendRequest(message, { timeoutMs })` — 单次调用覆盖超时；`installPlugin` / `updatePlugin` / `uninstallPlugin`（网关依赖事务 `gateway.packages.install|update|uninstall`，ADR 0054 §4）默认使用 `packageOperationTimeout`（300 s，可在构造时配置），其余 RPC 使用 `requestTimeout`（10 s）

重复调用 `loadConsoleEntries`（传入同一个 `hostApi` 对象）会对比上一次的结果：已消失的 entry 注册的路由与工具会被移除（需要宿主 API 提供 `removeRoute` / `removeTool`，`createPluginRegisterHostApi` 已提供），未显式指定 `id` 的工具使用 `<entryId>:<name>` 形式的稳定 id，不会在重载时重复。

## 构建

```bash
pnpm --filter @zhin.js/client build
```

## 相关文档

- [Remote Console 使用说明](../../../docs/console/index.md)
- [Console 栈概览](../README.md)
- [@zhin.js/host-http（Console/HTTP Host 传输）](../../host/http/README.md)
