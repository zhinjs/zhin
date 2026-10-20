# @zhin.js/contract

Remote Console 与 PageManager 的**共享契约**：Console Entry 形状、`PluginRegisterHostApi`、`ConsoleClientEntry`、`ConsoleEntriesResponse`、路径常量等。无运行时逻辑，供 `@zhin.js/pagemanager`、`@zhin.js/client` 与插件 `client/` 共用。

领域术语与关系图见 **[../pagemanager/CONTEXT.md](../pagemanager/CONTEXT.md)**。

```bash
pnpm --filter @zhin.js/contract build
```
