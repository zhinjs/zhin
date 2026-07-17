# @zhin.js/next-feature-layout

Console Shell Layout slot 的标准 Feature provider。Layout 与 Page 共用 `pages/`，但只发现两个保留文件：`$nav.tsx` 和 `$footer.tsx`。

## Semantics

- `$nav.tsx` -> slot `nav`。
- `$footer.tsx` -> slot `footer`。
- slot 按当前 route owner 向最近祖先继承。
- `LayoutIndex.chain()` 返回从最近 override 到 Root override 的完整回退链，供 Shell Error Boundary 逐级回退。

Layout renderer 只控制 Shell 分配的 semantic region，不拥有 Router、权限模型、Navigation tree 或 Content Outlet。

## Client Boundary

Layout TSX 不在 Node 运行。Client Module adapter 提供 `{ module, hash }` artifact；本包不依赖 React、bundler 或编译器。

## HMR

slot 文件变化只替换该 Layout Capability。当前 route 和 Page state 由 Console Shell 保留；新 renderer 失败时 Shell 可沿 `chain()` 回退到祖先或内置 renderer。
