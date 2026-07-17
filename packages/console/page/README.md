# @zhin.js/page

标准 Page Feature provider。它把插件或项目根的平面 `pages/*.ts|tsx` 发现为 owner-bound Page manifest，并从 Plugin path 确定性生成 route。

## Convention

- `pages/status.tsx` -> localName `status`。
- Root route 为 `/p-status`；`root/a/b` 的 route 为 `/a/b/p-status`。
- 首版不递归，不支持 `index`、`[param]` 或 route metadata override。
- `$nav.tsx`、`$footer.tsx` 以及其他 `$` 文件不属于 Page。

## Client Boundary

Page TS/TSX 是浏览器模块，provider 从不调用 `loadModule()`。Discovery 必须由 `ModuleRuntime.loadClientModule()` 提供已经静态提取的 `{ module, hash, metadata }` artifact；缺少 adapter 会明确失败。

生产 adapter 应读取预构建 `pages.manifest.json` 与 chunks。开发 adapter 可使用 TypeScript AST transform，并为 module URL 提供 HMR。编译器不是本包依赖。

## Projection

`PageIndex` 是 generation-scoped immutable projection，提供 `list()`、`ownedBy()` 和 `route()`。Page source、route record、导航 leaf 都使用同一个 Capability identity。

## HMR

单个 Page 文件变化只替换对应 slot，再原子发布新 `PageIndex`。编译失败时 generation 不提交，旧页面继续有效；服务端 Plugin setup 不重跑。
