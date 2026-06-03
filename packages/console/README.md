# packages/console/

Zhin **Remote Console 栈**（与 `packages/im`、`packages/host` 并列）。Host 侧注册扩展入口与 API；浏览器 UI 在独立仓库 **[zhin-console](https://github.com/zhinjs/console)** 维护。

## 分层

```
@zhin.js/contract          共享类型与常量（Console Entry、Register Host API）
        ↓
@zhin.js/pagemanager       Node：PageManager、EntryStore、/@dev 打包与 GET /entries
        ↓
@zhin.js/client            浏览器 SDK：拉 entries、注册路由/工具、apiFetch
        ↓
zhin-console（独立仓库）    壳层 UI、登录、内置页；依赖 @zhin.js/client 连接 Host
```

| 目录 | npm 包 | 职责 |
|------|--------|------|
| [contract](./contract/) | `@zhin.js/contract` | Console Entry、`PluginRegisterHostApi` 等契约 |
| [pagemanager](./pagemanager/) | `@zhin.js/pagemanager` | 服务端 PageManager、entries 路由与 esbuild 管线 |
| [client](./client/) | `@zhin.js/client` | Remote Console 客户端 SDK（无 UI） |

`@zhin.js/host-api` 在 Host 上挂载 PageManager 与管理面 REST；传输由 `@zhin.js/host-router` 提供。

## Remote Console 快速路径

1. Host 启用 `@zhin.js/host-router` + `@zhin.js/host-api`。
2. 打开 **https://console.zhin.dev**（或本地 `zhin-console/` 开发服）。
3. 登录页填写 API Base 与 Bearer Token。

详见 **[docs/console-remote.md](../../docs/console-remote.md)**。本地 submodule 可选挂载在 monorepo 根 **`zhin-console/`**。

## 插件扩展

适配器或插件在 Node 侧通过 `useContext('web', (pageManager) => pageManager.addEntry(...))` 注册 **Console Entry**；Remote UI 经 `GET /entries` 拉取并由 `@zhin.js/client` 的 `loadConsoleEntries` 动态 `import` 与 `register(hostApi)`。

领域术语见 [pagemanager/CONTEXT.md](./pagemanager/CONTEXT.md)。
