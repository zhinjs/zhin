# @zhin.js/satori

## 0.2.4

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation

## 0.2.3

### Patch Changes

- c212bf7: fix: 适配器优化

## 0.2.2

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 0.2.1

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐

## 0.2.0

### Major Changes

- 改为直接依赖官方 `satori`，通过 `html-react-parser` 提供 `htmlToSvg`；移除旧版自研布局/渲染源码。
- 保留 `fonts/` 与字体工具函数；导出 `satori`（官方）与 `htmlToSvg`。

## 0.1.0

### Minor Changes

- 404feeb: feat: add built-in font utilities API

  Exposes new font utility types and functions from @zhin.js/satori package:

  - BuiltinFont interface for type-safe font definitions
  - Font getter functions (getRobotoRegular, getRobotoBold, getNotoSans\*, etc.)
  - Note: These functions throw errors in this build as no fonts are bundled

## 0.0.2

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
