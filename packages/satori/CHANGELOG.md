# @zhin.js/satori

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
