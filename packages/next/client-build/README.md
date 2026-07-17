# @zhin.js/next-client-build

Page/Layout 的可选 TypeScript AST 与 artifact manifest adapter。它是开发/构建工具，不进入默认 Runtime、IM 或 Console 生产依赖闭包，也不依赖 Vite、React、Router、CSS compiler 或 native/wasm 包。

## Development Adapter

```ts
const client = new TypeScriptClientBuilder({
  projectRoot: process.cwd(),
  outDir: 'dist/client',
  publicBase: '/assets/zhin',
});
const modules = new ClientBuildModuleRuntime(serverModules, client);
```

`ClientBuildModuleRuntime` 只把 `loadClientModule()` 交给 client builder，其余 server import、reverse importer、watch 和 close authority 原样委托给既有 `ModuleRuntime`。

## Static Metadata

Page 必须默认导出组件，可选导出：

```tsx
export const meta = definePage({
  title: 'Status',
  order: 10,
  requiredPermissions: ['status:read'],
});
```

metadata 只接受 JSON-like literal。变量引用、函数调用、spread、computed key、shorthand 和 template expression 都带文件/行/列失败。构建器不会执行 Page 模块来猜值。

Layout 只校验 default export，不读取 metadata。TS/TSX 使用 TypeScript `transpileModule()` 输出最小 ESM；裸模块 import 由 Host import map 或上层静态打包步骤解析。

## Production Manifest

`build(entries)` 原子写入 content-hashed chunks 和 `pages.manifest.json`。manifest source 使用 project-root 相对 POSIX 路径，不泄漏构建机目录；生产 lookup 只使用 owner/Feature/localName identity。生产 Host 使用 `ManifestClientModuleLoader.fromFile()` 读取 artifact，不在启动时编译 npm package。

## Dependency Boundary

TypeScript 是本工具包的 peer dependency。它只存在于选择安装 client build tooling 的 workspace；`@zhin.js/next-console` 的 production size gate 不包含本包。

## Validation

```bash
pnpm --filter @zhin.js/next-client-build test
pnpm --filter @zhin.js/next-client-build build
```
