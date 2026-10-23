# @zhin.js/jsx

## 1.1.5

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/im-contract@1.1.6

## 1.1.4

### Patch Changes

- Updated dependencies [fbfefb7]
  - @zhin.js/im-contract@1.1.5

## 1.1.3

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/im-contract@1.1.4

## 1.1.2

### Patch Changes

- 5ab6307: 修正 JSX 的默认语义为消息排版：内置小写标签无需导入并提供属性类型，标签与属性映射为 Segment；只有显式 html / Html 子树序列化为 HTML。支持注册组件标签、原生 share 与平台 card，以及 Button onClick 回跳与返回值自动回复；同步脚手架、示例和文档。

  运行实例统一分配递增、不重复的按钮降级编号，会话交错发送时允许跳号，回调有效期为一小时，发送确认前的点击可正常执行；等待文字输入不会吞掉 JSX 按钮事件。修复 Card 原生 key 载荷、带 MIME 参数的图片 data URI、注册组件递归深度和媒体/HTML 类型约束。原有裸 HTML 布局需要显式包裹 `<html>` / `<Html>`。

## 1.1.1

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.
