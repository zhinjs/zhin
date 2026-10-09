# 贡献 @zhin.js/satori

本包是 [Zhin.js 仓库](https://github.com/zhinjs/zhin) 中的薄封装：核心渲染由官方 [vercel/satori](https://github.com/vercel/satori) 完成。

- **与本包封装相关**（`htmlToSvg`、内置字体路径、导出 API）：请在 Zhin 仓库提 Issue / PR。
- **渲染行为、布局、CSS 子集**：请查阅 [satori 文档与 Issues](https://github.com/vercel/satori)。

本地开发：`pnpm install` → `pnpm build`（在仓库根目录或 `packages/toolkit/satori` 下）。

公共接口只处理 HTML→SVG 与字体；JSX 和样式组件分别维护于 `packages/im/jsx`、`packages/toolkit/components`，不在本包新增其他 serializer。
