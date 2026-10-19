---
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/cli": patch
"@zhin.js/config-file": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-link-poster": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/process-monitor": patch
"@zhin.js/runtime": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/service-typesafe": patch
"@zhin.js/testing": patch
"create-zhin-app": patch
---

将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。
