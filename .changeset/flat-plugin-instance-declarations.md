---
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/config-file": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
"@zhin.js/testing": patch
---

将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。
