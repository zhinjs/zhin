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
| `@zhin.js/client/ui` | 插件页 UI 套件（见下文“插件页 UI 套件”） |
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

## 插件页 UI 套件

`@zhin.js/client/ui` 是给插件 Console 页面用的小套件：与 Console 共用同一套主题变量（亮暗色、字号、圆角、焦点环自动跟随），**不依赖 Tailwind**（远程页面不会被 Console 的 Tailwind 扫描），所有样式是 `zk-` 前缀的自带类。

```tsx
import { Badge, Button, ConfirmButton, ErrorState, LoadingState, Notice, PluginPage, Section, StaleNotice, pluginUiStyles, usePluginRpc, resolvePluginId, useLocale } from '@zhin.js/client/ui';

export default function Page() {
  const { t } = useLocale();
  const status = usePluginRpc<{ items: string[] }>('root/my-plugin', 'status', undefined, { pollMs: 6000 });
  return (
    <PluginPage>
      <style>{pluginUiStyles}</style>
      {status.state === 'loading' && <LoadingState />}
      {status.state === 'error' && <ErrorState message="读取状态失败，请稍后重试。" details={status.error?.message} onRetry={status.refresh} />}
      {status.state === 'stale' && <StaleNotice lastSuccessAt={status.lastSuccessAt} />}
      {status.data && <Section title={t('账号')}>…</Section>}
    </PluginPage>
  );
}
```

| 导出 | 说明 |
|------|------|
| `pluginUiStyles` | 唯一的样式字符串，用 `<style>` 注入 |
| `PluginPage` / `PageHeader` / `Section` | 页面容器、页头、分节 |
| `Button` | `primary` / `secondary` / `ghost` / `danger`；`size` 为 `default` / `sm` / `icon`；`busy` 在按钮内显示转圈；手机上点击目标 ≥ 44px |
| `Badge` | `neutral` / `success` / `warning` / `danger` / `info`；状态必须用文字表达，不能只靠颜色 |
| `Notice` | `info` / `success` / `warning` / `danger`，可选关闭按钮；错误不应自动消失 |
| `EmptyState` / `LoadingState` / `ErrorState` | 空、加载、失败（说明 + 重试 + 默认折叠的技术详情） |
| `StaleNotice` | 刷新失败但仍展示旧数据时的“数据可能已过期，上次成功 hh:mm” |
| `ConfirmButton` | 行内确认，替代 `window.confirm`；用具体动作做确认文案（“删除账号”而不是“确定”）；取消或 Esc 后焦点回到触发按钮 |
| `Field` | 标签 + 说明 + 错误，自动接好 `aria-describedby` |
| `usePluginRpc(pluginId, method, params?, { pollMs?, pauseWhenHidden? })` | 返回 `state`（`loading` / `empty` / `ready` / `error` / `stale`）、`data`、`error`、`lastSuccessAt`、`refresh()`、`mutate()`；失败时保留上次成功数据，并丢弃过期响应 |
| `useRpcResource(key, load, options)` | `usePluginRpc` 的通用形态，可用于 `consoleRpc` 等其他读取 |
| `useLocale(dictionary?)` | `{ locale, t }`，取代各页面重复的 `detectLocale` + `text` |
| `resolvePluginId({ adapter } \| { source }, fallback?)` | 从 `/console/api/pages` 解析页面所属 PluginId |

`adapterConsoleStyles` 仍然导出（sandbox 页在用），内容是套件样式加一小段通用兼容样式；旧版 `ac-*` 评论审批样式已删除。

## 评论审批页

「AI 起草 → 人工审批 → 发送」类的评论回复适配器（Bilibili、掘金…）用 `createCommentReviewPage(spec)` 生成整页：账号区、登录状态、草稿卡片（修改 / 发送 / 丢弃草稿，丢弃走行内确认）、可关闭的错误提示、刷新失败时的“数据可能已过期”。页面只依赖 `@zhin.js/client/ui` 套件，会先解析 PluginId，再读 `plugin.<pluginId>.status` 并调用 `edit` / `send` / `drop` 与你声明的登录动作。

```tsx
import { createCommentReviewPage, ReviewResourceList } from '@zhin.js/client';

export default createCommentReviewPage({
  adapter: 'juejin',                              // 解析 PluginId
  platform: { zh: '掘金', en: 'Juejin' },
  mark: '掘',
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
