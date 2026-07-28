---
"@zhin.js/adapter": minor
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-napcat": minor
"@zhin.js/adapter-onebot11": minor
"@zhin.js/adapter-onebot12": minor
"@zhin.js/adapter-milky": minor
"@zhin.js/adapter-slack": minor
"@zhin.js/adapter-telegram": minor
---

通用 endpoint 管理命令套件：`@zhin.js/adapter` 新增 `createEndpointCommands(spec, defineCommand)`——`<adapter> endpoint list / add <name> key=value... / remove <name>` 三件套，含 kv 解析、`.env` 凭据派生（`<ADAPTER>_<NAME>_<FIELD>`）、yaml 写回保留注释、master 权限门禁（通用 `isEndpointOperator`）、自定义 bindFlow 钩子。QQ 迁移至套件（行为与扫码绑定流程不变）；napcat / onebot11 / onebot12 / milky / slack / telegram 接入（字段对齐各自 schema，features 补 @zhin.js/command）。
