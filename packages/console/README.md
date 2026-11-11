# packages/console/

Zhin **Remote Console 栈**（与 `packages/im`、`packages/host` 并列）。Host 侧注册扩展入口与 API；浏览器 UI 在独立仓库 **[zhin-console](https://github.com/zhinjs/console)** 维护。

## 分层

```
@zhin.js/console-protocol   wire 协议（RPC 名、事件信封、SSE 帧）
@zhin.js/console-contract   零依赖 Page/Layout 契约（definePage、definePageBlueprint、route）
        ↓
@zhin.js/page / @zhin.js/layout   约定式 Feature provider（发现 pages/<name>/index.ts|tsx）
        ↓
@zhin.js/pagemanager        Node：ConsoleRuntime、页面外壳、客户端构建
        ↓
@zhin.js/client             浏览器 SDK：拉 entries、注册路由/工具、REST + SSE transport
        ↓
zhin-console（独立仓库）    壳层 UI、登录、内置页；依赖 @zhin.js/client 连接 Host
```

`@zhin.js/contract` 是 `@zhin.js/client` 与 zhin-console 共用的浏览器侧类型与常量（`PluginRegisterHostApi`、`ConsoleClientEntry` 等）。

| 目录 | npm 包 | 职责 |
|------|--------|------|
| [protocol](./protocol/) | `@zhin.js/console-protocol` | Console RPC / 事件 wire 协议 |
| [contract](./contract/) | `@zhin.js/contract` | 浏览器侧共享类型与常量（`PluginRegisterHostApi`、`ConsoleClientEntry`） |
| [plugin-contract](./plugin-contract/) | `@zhin.js/console-contract` | 零依赖 Page/Layout、route 与 Navigation 契约 |
| [page](./page/) | `@zhin.js/page` | `pages/*/index.ts|tsx` 约定式 Feature provider |
| [layout](./layout/) | `@zhin.js/layout` | `pages/nav/index.tsx` / `pages/footer/index.tsx` Layout Feature provider |
| [pagemanager](./pagemanager/) | `@zhin.js/pagemanager` | 服务端 `ConsoleRuntime`、页面外壳（`renderPageShell` / `renderConsoleIndex`）与客户端构建 |
| [client](./client/) | `@zhin.js/client` | Remote Console 客户端 SDK（无 UI） |

Console Host（PageManager 与管理面 REST）由 `@zhin.js/cli` 作为 composition root 基于 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，无需安装任何 Host 插件。

## Remote Console 快速路径

1. 启动应用（Console/HTTP Host 由 `@zhin.js/cli` 自动装配，无需安装插件）。
2. 打开 **https://console.zhin.dev**（或本地 `zhin-console/` 开发服）。
3. 登录页填写 API Base 与 Bearer Token。

详见 **[docs/console/index.md](../../docs/console/index.md)**。

## 插件扩展

页面按约定目录发现，不做命令式注册：在插件包内新增 `pages/<name>/index.ts`（或 `index.tsx`），导出 `meta = definePage({...})` 与默认导出即可。

```ts
// pages/status/index.ts
import { definePage, definePageBlueprint } from '@zhin.js/console-contract';

export const meta = definePage({ title: 'Status', icon: 'Activity', order: 20 });

export default definePageBlueprint({
  title: { zh: '状态', en: 'Status' },
  sections: [],
});
```

- `pages/index/index.tsx` 映射到插件路径本身，其余页面映射为 `/p-<name>`；route 由目录推导，`definePage` 不能覆盖。
- `pages/nav/index.tsx` 与 `pages/footer/index.tsx` 是布局（`@zhin.js/layout`）。
- Remote UI 经 `GET /entries` 拉取页面入口，由 `@zhin.js/client` 的 `loadConsoleEntries` 动态 `import` 并挂载。

完整写法见 [Console 页面与布局](../../docs/authoring/console-pages.md)；领域术语见 [pagemanager/CONTEXT.md](./pagemanager/CONTEXT.md)。
