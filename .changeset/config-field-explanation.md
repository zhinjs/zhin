---
"@zhin.js/cli": patch
"@zhin.js/runtime": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
---

为已保存的插件配置提供只读字段来源与当前代一致性解释。复用同一次文件/运行代观察，仅返回有界 metadata；敏感字段、环境引用和不能证明的来源保持隐藏或未知。配置解释要求完整权限，不开放给 demo，也不执行应用或发送操作。
