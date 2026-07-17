# @zhin.js/next-console

Page/Layout manifest 的 snapshot-coherent domain runtime。它提供 route guard、权限过滤、Plugin Navigation tree、Layout fallback chain 和页面删除后的 fallback route，不包含 React、Router 或 HTTP server。

## Runtime

```ts
const runtime = new ConsoleRuntime();
runtime.attach(root.controller.snapshots);

await runtime.runView(
  { permissions: ['status:read'], roles: [] },
  async (catalog) => {
    const match = catalog.match('/admin/p-status');
    const navigation = catalog.navigation();
    const navLayouts = catalog.layouts(owner, 'nav');
  },
);
```

一次 `runView()` 持有一个 generation lease。Page route、Navigation、Layout module 与权限判断来自同一 snapshot；回调结束后 catalog 失效，防止 module URL 跨代逃逸。

## Route Guard

`match()` 区分 `found`、`forbidden` 和 `missing`。`hideInNav` 只影响 Navigation，不能绕过直接访问检查。页面使用的服务端 API 仍需独立鉴权。

## Navigation

- Root Page 是顶层 leaf，Root 自身不生成 group。
- child Plugin 生成 group；没有可见后代的空 group 被裁剪。
- label/icon/order 来自 Plugin/Page metadata。
- Navigation 是 Page catalog 的只读视图，不是 registry。

## Layout

`layouts(owner, slot)` 返回最近 owner 到 Root 的 override chain。客户端 Shell 应把每个 renderer 放进独立 Error Boundary，失败时尝试下一个 manifest，最终回退到 Shell 内置 renderer。

## Dependencies

本包没有 UI framework 或 bundler 依赖。React、Vue、Router 和 Client Module compiler 都应由可选 Console adapter 提供。
