# ADR 0051: Node 原生 TypeScript 开发 Runtime

## 状态

Accepted；适用于 Next Plugin 本地启动与 HMR。

## 背景

Next Plugin 以 TypeScript 源码作为开发事实源，但默认安装不能携带 Vite、tsx、chokidar、TypeScript compiler 或 native/wasm transform。Node 已提供轻量 type stripping；它不读取 tsconfig，不支持 TSX，也不会执行 `node_modules` 中的 TS。

## 决策

1. `NativeDevelopmentModuleRuntime` 使用 Node ESM/type stripping 直接加载本地 `.ts`，不编译、不生成缓存产物。
2. Node 22.18+ 直接启动；22.6–22.17 由 CLI 以 `--experimental-strip-types` 重启自身；更低版本只能运行预编译生产 ESM。
3. 直接 capability 通过 file URL generation query 穿透 ESM cache，实现 Slot HMR。
4. 普通 support module 无法安全清除完整 importer closure，必须升级为 process restart；CLI drain Root 后以退出码 75 交给 supervisor。
5. watcher 使用一个 recursive `fs.watch`；句柄配额耗尽时退化为低频 mtime polling，不引入第三方 watcher。
6. npm Feature/Plugin manifest 必须指向预编译 JS。Page/Layout TSX 继续走 Client Build artifact；服务端 TSX 需要预编译。

## 后果

- 开发启动零新增 transform 依赖，生产闭包不含 TypeScript。
- 原生 TS 文件的相对 import 必须写 `.ts` 扩展，并使用可擦除语法和 `import type`。
- capability 文件可局部更新；support module 更新成本更高但行为确定，不会出现成功提示后仍执行旧依赖。
- Plugin package 的本地 TS entry 与发布 JS entry 仍需在后续 publish manifest artifact transaction 中统一表达。
