---
"@zhin.js/client": patch
---

新增 `@zhin.js/client/ui` 插件页 UI 套件（Button/Badge/Notice/状态组件/ConfirmButton/Field、`usePluginRpc`、`useLocale`、`resolvePluginId` 与基于 Console 主题变量的样式），并用它重写通用适配器页：加载/失败/过期状态分离，原生 `confirm` 改为行内确认，按操作独立的忙碌状态，修复数据未到达时误显示“配置里还没有账号”的问题。
