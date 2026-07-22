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
| `createPluginRegisterHostApi` | 由壳层的 `React` / `addRoute` / `addTool` 构造 `PluginRegisterHostApi` |
| `apiFetch` | 相对 Host API Base 的 `fetch`，自动附加 `Authorization: Bearer` |
| `getApiBase` / `getToken` | 读取登录页写入 `localStorage` 的 API Base 与 Token |
| `app` | 路由与工具注册单例（`addRoute`、`addTool` 等） |
| `configureConsole` / `getRuntimeEnv` | 运行时环境（development / production） |
| `createRegistryStore` / `useRegistry` | 可选 registry store |
| `ENDPOINT_RPC` / `INBOX_RPC` / `SIDE_EVENT_RPC` / `SIDE_EVENT_PUSH` | `@zhin.js/console-protocol` 的规范 RPC 与推送名称 |
| `normalizeConsolePushType` / `normalizeConsolePushMessage` | 在 SDK 边界兼容旧 `endpoint:*` 推送并输出规范事件与 payload |

类型与 Entry 契约来自 `@zhin.js/contract`。

业务 UI 应使用 SDK 导出的协议常量，不要硬编码旧 `endpoint:list`、`endpoint:sendMessage` 等名称。SDK 会把旧 Host 推送别名归一化为 `message.receive` / `request.receive` / `notice.receive`，并统一 `endpointId`、`channelId` 字段。

## 启动：加载插件 Console Entry

Remote Console 壳层在登录后调用：

```tsx
import React from "react";
import {
  app,
  createPluginRegisterHostApi,
  loadConsoleEntries,
} from "@zhin.js/client";

const hostApi = createPluginRegisterHostApi({
  React,
  addRoute: app.addRoute.bind(app),
  addTool: app.addTool.bind(app),
});

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

辅助：`resolveApiUrl`、`resolveWebSocketUrl`（SSE `/api/events` 等）。

## `createPluginRegisterHostApi`

将壳层已有的 React 与路由/工具注册函数适配为契约中的 `PluginRegisterHostApi`（含 `addPage` 别名 → `addRoute`）：

```ts
import { createPluginRegisterHostApi } from "@zhin.js/client";

const hostApi = createPluginRegisterHostApi({ React, addRoute, addTool });
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
- [@zhin.js/host-api 管理面 API](../../host/api/README.md)
