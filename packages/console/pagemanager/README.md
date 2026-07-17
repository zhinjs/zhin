# @zhin.js/pagemanager

Remote Console **Node 侧运行时**：PageManager、EntryStore、`GET /entries`、esbuild 打包与 `/@dev` 开发资源路由。无 UI；契约在 `@zhin.js/contract`，浏览器 SDK 在 `@zhin.js/client`。

> **路径约定**：本包位于 `packages/console/pagemanager/`。源码在 `src/node/`，构建产物在 `lib/node/`。

## 分层

见 [Console 栈概览](../README.md)：

```
@zhin.js/contract  →  @zhin.js/pagemanager  →  @zhin.js/client  →  zhin-console（独立仓库）
```

领域术语与关系图见 **[CONTEXT.md](./CONTEXT.md)**。

## 安装

Monorepo 内 workspace 依赖；对外发布时：

```bash
pnpm add @zhin.js/pagemanager
```

## 主要导出

| 导出 | 用途 |
|------|------|
| `PageManager` | 控制台服务端运行时；拥有 EntryStore，注册 Console Entry |
| `mountConsoleRouter` | 挂载 entries 与静态/dev 资源路由 |
| `createInMemoryEntryStore` / `EntryStore` | Entry 目录 |
| `buildEntriesResponse` / `rewriteEntriesForClient` | 序列化 `GET /entries` 响应 |
| `attachConsoleClientHost` | 将 Console 路由挂到现有 Koa Host |
| `serverRuntimeEnv` | development / production 运行时标记 |

类型（`ConsoleServerOptions`、`PluginServerRegisterHostApi` 等）自 `./consoleServerOptions.js` 导出。

## Plugin Runtime

`@zhin.js/pagemanager/plugin-runtime` 提供 snapshot-coherent 的 `ConsoleRuntime`。一次
`runView()` 在完整回调期间持有同一 generation lease，route guard、权限过滤、Navigation
树和 Layout fallback chain 都从同一个 Page/Layout projection 读取；回调结束后 catalog
失效，避免浏览器模块 URL 跨 generation 逃逸。

该子路径不引入 React、Router 或客户端编译器。Page 与 Layout 的约定式发现分别由
`@zhin.js/page`、`@zhin.js/layout` 提供，wire types 来自零依赖
`@zhin.js/console-contract`。

## 插件注册 Entry

在插件 Node 侧通过 `web` 上下文获取 **PageManager 实例**（非静态全局）：

```typescript
useContext('web', (pageManager) => {
  pageManager.addEntry({
    id: 'my-plugin',
    name: 'My Plugin',
    dev: '/@dev/plugins/my-plugin/client/index.tsx',
    prod: '/@assets/my-plugin/client/index.js',
  });
});
```

浏览器侧由 `@zhin.js/client` 的 `loadConsoleEntries` 拉取并动态 `import`。

## 构建

```bash
pnpm --filter @zhin.js/pagemanager build
```

## 相关文档

- [Remote Console 使用说明](../../../docs/console-remote.md)
- [@zhin.js/contract](../contract/README.md)
- [@zhin.js/client](../client/README.md)
- [@zhin.js/host-api 管理面 API](../../host/api/README.md)
