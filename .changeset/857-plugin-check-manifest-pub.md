---
"@zhin.js/cli": patch
---

`zhin plugin check` 新增三项检查：用 Runtime 同一解析器校验 `zhin` 清单（protocol / engine / runtime / features / plugins，engine 需被当前 Runtime 满足，features 引用的包必须已声明依赖）；`peerDependencies` 策略与范围（需声明 `zhin.js`，禁止 `latest` / `*` / `file:`，本地安装版本不在范围时警告）；借用插件 `node_modules` 对打包后的 `zhin.entry` 做 import 冒烟测试。`zhin pub` 发布前自动运行 `zhin plugin check`，有错误时停止发布，可用 `--skip-check` 跳过。
