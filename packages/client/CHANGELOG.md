# @zhin.js/client

## 1.0.7

### Patch Changes

- f9faa1d: fix: test release

## 1.0.6

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.5

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.4

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.1.0 (2024-10-22)

### Major Features

- ✨ **插件配置系统** - 基于 Schema 的自动化配置表单

  - 完整支持 15 种 Schema 数据类型
  - 智能 UI 组件自动选择
  - 支持任意深度的嵌套结构
  - 实时配置读取和保存

- 🏗️ **组件模块化重构**
  - PluginConfigForm 拆分为 8 个模块（17 个独立渲染器）
  - 职责单一，易于测试和扩展
  - 向后兼容，使用方式不变

### Improvements

- 🎨 表单布局优化

  - 使用 ScrollArea 控制高度
  - 使用 Accordion 折叠复杂字段
  - 统一组件尺寸（size="1"）
  - 智能分组（简单字段 vs 复杂字段）

- 📝 文档完善
  - 新增 `DEVELOPMENT.md` 开发文档
  - 更新 `README.md` 添加配置系统说明
  - 详细的 API 参考和最佳实践

### Bug Fixes

- 🐛 修复 Schema 格式兼容性问题（dict vs properties）
- 🐛 修复嵌套字段状态管理问题
- 🐛 修复 definitions 字段名称问题

## 1.0.3

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑
- b213bbc: fix: 更新 kook 报错

## 1.0.2

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.1

### Patch Changes

- 727963c: fix: 修复 sqlite 数据错误;优化 console 展示
