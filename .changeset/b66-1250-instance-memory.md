---
"@zhin.js/pagemanager": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
---

fix: 实例不再常驻 TypeScript 编译器与 CLI 命令树（#1250 第 66 批）

- `@zhin.js/pagemanager`：纯 Blueprint 页面改用已有的 esbuild `transform`（CommonJS、ES2022，与原 `ts.transpileModule` 选项对应）转译，不再在实例里加载 TypeScript；Page / Layout 静态元数据的解析移到短时 worker 线程，空闲 2 秒后结束 worker 并释放其中的 TypeScript（主线程加载过的 TypeScript 会被 V8 编译缓存留住，卸载模块也不释放）；worker 起不来时照旧在进程内解析。结果与报错不变。
- `@zhin.js/cli`：网关拉起的实例子进程（`zhin runtime start` + 实例子进程环境变量）不再加载 CLI 的全部命令模块，只加载启动实例所需的部分。
- `@zhin.js/scaffold-wizard`：`inquirer` 改为第一次提问时才加载；网关与实例只用到适配器列表、版本表等数据，不再连带加载交互提示库。
