# @zhin.js/client

Remote Console **浏览器 SDK**（entries 加载、路由/工具注册、带 Token 的 REST）。**不含 UI** — 壳层在独立仓库 [zhin-console](https://github.com/zhinjs/console)。

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

类型与 Entry 契约来自 `@zhin.js/contract`。

业务 UI 应使用 SDK 导出的协议常量和 Endpoint 类型，不要复制 RPC 字符串或 `EndpointInfo`。请求使用顶层 camelCase payload，Host 推送使用 `message.receive` / `request.receive` / `notice.receive` 和 canonical `adapter`、`endpointKey`、`channelId` 字段。

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
  assetOrigin: "http://127.0.0.1:8086",
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

401 时清除 Token 并派发 `zhin:auth-required`。

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

## 构建

```bash
pnpm --filter @zhin.js/client build
```

## 相关文档

- [Remote Console 使用说明](../../../docs/console-remote.md)
- [Console 栈概览](../README.md)
- [@zhin.js/host-http（Console/HTTP Host 传输）](../../host/http/README.md)
