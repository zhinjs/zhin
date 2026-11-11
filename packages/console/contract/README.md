# @zhin.js/contract

Remote Console **浏览器侧共享类型与常量**，供 `@zhin.js/client`、`@zhin.js/pagemanager` 与 zhin-console 共用。除常量外无运行时逻辑。

| 导出 | 说明 |
|------|------|
| `PluginRegisterHostApi`、`ConsolePluginRegister` | 入口模块 `register(api)` 收到的宿主 API：`React`、`addRoute`、`addTool`，以及可选的 `removeRoute` / `removeTool`（供入口重载时移除已消失入口的注册） |
| `PluginAddRouteInput`、`PluginAddToolInput` | `addRoute` / `addTool` 的入参 |
| `ConsoleClientEntry`、`ConsoleEntriesResponse`、`ConsoleEntry` | `GET /entries` 的返回形状 |
| `DEFAULT_CONSOLE_BASE_PATH`、`CONSOLE_HOST_REACT_NAMESPACE_KEY`、`CONSOLE_SHARED_MODULES_KEY` | 路径与宿主共享模块的全局键 |
| `SIDE_EVENT_PUSH`、`SIDE_EVENT_RPC`、`INBOX_RPC`、`ENDPOINT_RPC`、`SIDE_EVENT_NAMES` | 兼容性再导出；wire 协议的唯一来源是 `@zhin.js/console-protocol` |

页面元数据（`definePage`、`definePageBlueprint`）不在本包，请从 `@zhin.js/console-contract`（或 `@zhin.js/page` / `zhin.js/page`）导入。

`react` 是可选 peer：仅类型声明引用 `ReactNode`。

领域术语与关系图见 **[../pagemanager/CONTEXT.md](../pagemanager/CONTEXT.md)**。

```bash
pnpm --filter @zhin.js/contract build
```
