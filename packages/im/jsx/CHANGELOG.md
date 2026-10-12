# @zhin.js/jsx

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
