---
"@zhin.js/pagemanager": minor
"zhin.js": patch
---

Console 共享模块版本核对（ADR 0063 D3）：`@zhin.js/console-ui` 与 React 一样由 Console 提供单例，插件页面打包时不再打进去（`@zhin.js/console-ui/cn` 并入根导入，`styles.css` / `tokens.css` 的导入变为空模块）。页面的 `/esm/@zhin.js~console-ui.mjs` 地址带上插件 `peerDependencies` 中的范围、插件包名和用到的具名导出；代理模块拿 Console 在 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__` 登记的版本比对：主版本不兼容时明确报错，版本偏低时在控制台告警并记录到 `__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__`（同时派发 `zhin:console-shared-module-issue` 事件），缺少的具名导出按名字报出、调用时抛错，不再静默给出 `undefined`。`zhin.js` 的 `/esm/*` 把查询参数交给 pagemanager。
