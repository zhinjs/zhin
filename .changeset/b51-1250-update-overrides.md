---
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
---

`zhin update` 同步 pnpm overrides 里 Zhin 包的版本锁（`update-overrides-not-synced`）。原来带 `pnpm.overrides` 锁住 Zhin 包的项目执行 `zhin update` 后，要么什么都没升级（override 把版本留在旧值），要么 `zhin update zhin.js@x.y.z` 装上新版 zhin.js、其依赖却被旧锁固定，`zhin doctor` 的「Zhin 包单实例」检查失败。现在更新涉及 Zhin 包（不带包名，或指定了 `zhin.js` / `@zhin.js/*`）时，网关在包管理器运行前去掉能同步的 Zhin 条目（`package.json#pnpm.overrides` 与 `pnpm-workspace.yaml#overrides`，按包名的键和单级 `>` 选择器），运行后按已安装版本写回（保留 `1.2.3` / `^` / `~` 写法与条目顺序）并重新安装一次；非 Zhin 条目与 `link:` 等本地接线不动，无法自动同步的写法打印要手改的文件、行号和键。改动在事务快照里，失败时一起回滚。`zhin update --dry-run` 按「Zhin 包」「其他依赖」分组（Zhin 包在前），并单独列出 overrides 会怎么改。

只在用 pnpm 安装的项目里同步（npm / yarn / bun 不读 pnpm overrides）。写回后的重装带 `--no-frozen-lockfile`，`CI=true` 时 pnpm 不再以 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` 拒绝（npm / yarn / bun 没有这个参数，子进程里去掉 `CI`）。`zhin update @zhin.js/x@版本` 而 override 会把它钉回 zhin.js 依赖的版本时，直接失败并回滚，提示改为升级 zhin.js 或要手改的文件与行；重装后还会核对请求的包实际装上的版本，不符同样失败回滚。`pnpm-workspace.yaml` 按文本原位改写，引号、注释、flow 序列与无关条目的格式保持不变，只有版本号变化。手改提示的行号定位到 `pnpm.overrides` 里的条目。`--dry-run` 对会被同步的 override 按写回后的值显示最终版本，单包升级会冲突时提前说明。
