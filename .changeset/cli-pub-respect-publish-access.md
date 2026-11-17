---
"@zhin.js/cli": patch
---

`zhin pub` 不再强制传 `--access public`：未指定 `--access` 时沿用包的 `publishConfig.access`（包没有声明时仍为 `public`），写了 `"publishConfig": { "access": "restricted" }` 的 scoped 私有包不会被意外公开发布。发布确认会显示访问级别，非法取值直接拒绝。文档：插件完整交付新增「私有插件包」一节。
