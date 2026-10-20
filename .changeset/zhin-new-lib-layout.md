---
"@zhin.js/cli": patch
---

`zhin new` 生成的插件改为按发布包目录规范构建：

- `src/` 是库代码，编译到 `lib/`（`.js` + `.d.ts`），`main`、`types`、`exports` 都指向 `lib/`。
- `plugin.ts` 和约定目录在打包时（`prepack`）由自带的 `scripts/build-runtime-entries.mjs` 编译成同目录 `.js`，其中对 `src/` 的导入改写为 `lib/`；`postpack` 清除这些生成文件。
- `files` 改为白名单，不再发布 `.ts` 源码、测试和配置。

已生成的插件不受影响。如果想迁移，可以用新版 `zhin new` 生成一个同类型的插件，对照它的 `package.json`（`main`、`types`、`exports`、`files`、`scripts`）、`tsconfig.build.json` 和 `scripts/build-runtime-entries.mjs` 修改。

`zhin new` plugins now build `src/` into `lib/` with `.d.ts`, generate runtime-entry JavaScript at pack time, and whitelist only built files in `files`.
