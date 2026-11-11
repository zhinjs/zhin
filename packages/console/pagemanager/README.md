# @zhin.js/pagemanager

Remote Console **Node 侧运行时与页面外壳**：`ConsoleRuntime`（snapshot-coherent 页面/布局目录）、`renderPageShell` / `renderConsoleIndex`（独立页面 HTML 外壳与页面索引）以及按需静态客户端构建器 `TypeScriptClientBuilder`。页面与布局契约在零依赖的 `@zhin.js/console-contract`，wire 协议在 `@zhin.js/console-protocol`，浏览器 SDK 在 `@zhin.js/client`。

## 分层

```
@zhin.js/console-protocol  →  @zhin.js/pagemanager  →  @zhin.js/client  →  zhin-console（独立仓库）
```

领域术语与关系图见 **[CONTEXT.md](./CONTEXT.md)**。

## 安装

Monorepo 内 workspace 依赖；对外发布时：

```bash
pnpm add @zhin.js/pagemanager
```

## 主要导出

| 子路径 / 导出 | 用途 |
|--------------|------|
| `ConsoleRuntime`、`consoleRuntimeToken`、`ConsoleCatalog`、`buildNavigation`（`@zhin.js/pagemanager/plugin-runtime`） | Snapshot-coherent 页面与布局目录、路由匹配、权限过滤与导航树 |
| `renderPageShell` / `renderConsoleIndex` / `BASE_STYLE` / `PAGE_SHELL_CDN_VERSIONS`（`@zhin.js/pagemanager/shell`，根入口同样导出前三个） | 单页 HTML 外壳（含 importmap 与页面模块挂载脚本）与页面索引页 |
| `TypeScriptClientBuilder`、`ManifestClientModuleLoader`、`ClientBuildModuleRuntime`（`@zhin.js/pagemanager/client-build`） | 纯 `.ts` Blueprint 零打包提取 + 重交互 `.tsx` 静态 bundle 构建；生产环境按 `pages.manifest.json` 加载 |
| `rewriteBareImportsForBrowser`、`getOrBuildCanonicalEsmBundle` 等（根入口 / `@zhin.js/pagemanager/node`） | 浏览器 ESM 裸导入改写与 Host 共享依赖（Canonical ESM） |

`renderPageShell` 的 importmap 版本统一来自 `PAGE_SHELL_CDN_VERSIONS`（React 与工作区 `react` 范围一致，react-router 不低于仓库安全下限）。

## Plugin Runtime

`@zhin.js/pagemanager/plugin-runtime` 提供 snapshot-coherent 的 `ConsoleRuntime`。一次
`runView()` 在完整回调期间持有同一 generation lease，route guard、权限过滤、Navigation
树和 Layout fallback chain 都从同一个 Page/Layout projection 读取；回调结束后 catalog
失效，避免浏览器模块 URL 跨 generation 逃逸。

该子路径不引入 React、Router 或客户端编译器。Page 与 Layout 的约定式发现分别由
`@zhin.js/page`、`@zhin.js/layout` 提供，wire types 来自零依赖
`@zhin.js/console-contract`。

## Client Build

`@zhin.js/pagemanager/client-build` 是可选的 TypeScript AST/build adapter。它静态提取
`definePage()` 的 JSON-like metadata，生成 content-hash ESM 与
`pages.manifest.json`，生产 loader 不记录构建机绝对路径。

TypeScript 是 optional peer，不进入默认 PageManager 或 Plugin Runtime 的生产闭包。
导入该子路径或构造 builder 不会加载编译器；没有客户端 Page/Layout 的纯 JavaScript
CLI 项目无需安装 TypeScript。实际解析 Page/Layout 元数据的构建 workspace 才需要
显式安装兼容版本的 `typescript`，缺失时会返回明确的 optional peer 安装错误。

## 插件编写页面

插件在约定目录 `pages/<name>/index.ts`（或 `index.tsx`）中导出 `meta = definePage({...})` 与默认导出（`definePageBlueprint` 蓝图或组件），无需命令式注册；`pages/nav/index.tsx`、`pages/footer/index.tsx` 为布局。详见 [Console 页面与布局](../../../docs/authoring/console-pages.md)。

## 构建

```bash
pnpm --filter @zhin.js/pagemanager build
```

## 相关文档

- [Console 页面与布局](../../../docs/authoring/console-pages.md)
- [@zhin.js/console-protocol](../protocol/README.md)
- [@zhin.js/client](../client/README.md)
- [@zhin.js/host-http（Console/HTTP Host 传输）](../../host/http/README.md)
