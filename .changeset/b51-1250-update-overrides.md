---
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

`zhin update` 同步 pnpm overrides 里 Zhin 包的版本锁（`update-overrides-not-synced`）。原来带 `pnpm.overrides` 锁住 Zhin 包的项目执行 `zhin update` 后，要么什么都没升级（override 把版本留在旧值），要么 `zhin update zhin.js@x.y.z` 装上新版 zhin.js、其依赖却被旧锁固定，`zhin doctor` 的「Zhin 包单实例」检查失败。现在更新涉及 Zhin 包（不带包名，或指定了 `zhin.js` / `@zhin.js/*`）时，网关在包管理器运行前去掉能同步的 Zhin 条目（`package.json#pnpm.overrides` 与 `pnpm-workspace.yaml#overrides`，按包名的键和单级 `>` 选择器），运行后按已安装版本写回（保留 `1.2.3` / `^` / `~` 写法与条目顺序）并重新安装一次；非 Zhin 条目与 `link:` 等本地接线不动，无法自动同步的写法打印要手改的文件、行号和键。改动在事务快照里，失败时一起回滚。`zhin update --dry-run` 按「Zhin 包」「其他依赖」分组（Zhin 包在前），并单独列出 overrides 会怎么改。
