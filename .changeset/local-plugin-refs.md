---
"@zhin.js/runtime": minor
---

`zhin.plugins[].package` 支持 `./` 相对路径：子插件除 npm 包依赖外，可引用 monorepo 本地插件目录（相对声明方包根，禁止 `..` 越界，可嵌套挂本地子插件），无需发布 npm、无需写入 dependencies；workspace 扫描器不再拒绝 `plugins/<x>/plugins/` 嵌套目录。配合已有的「插件即 Root」能力，任意插件 + 一个 `zhin.config.yml` 即可独立启动。
