---
'@zhin.js/cli': patch
'@zhin.js/console-protocol': patch
---

新增当前运行代内的管理员任务 REST 读写接口，使用插件自己的持久化 CAS 与幂等回执，并严格校验完整投递目标、权限与生命周期。
