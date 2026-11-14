---
"@zhin.js/cli": patch
---

`zhin migrate` 不再把 zhin 依赖写成 dist-tag `latest`：按项目 npm 配置（含镜像）用 `npm view` 查询 registry，范围写成 `^x.y.z`，原来是精确版本的保持精确（`--include-pinned` 同样适用），已写成 `latest` 的旧项目也会被改正；dry-run 显示真实版本；查询失败时保留原值并提示；从不降级——现有范围的最低版本已高于 registry 最新版本时（预发布版如 `^6.0.0-beta.3`、镜像同步滞后、`--include-pinned` 下更高的精确版本）保留原值并提示一行；包名不是合法 npm 包名的依赖不会被查询（Windows 上 `npm` 经 shell 运行）。迁移同时把 `package.json#pnpm.overrides` 中的 `@zhin.js/*` 按目标 `zhin.js` 版本的 dependencies 对齐（依赖本身已是 registry 最新版本时也会同步过期的 overrides；不在其依赖中的跟随该包的 registry 版本；`workspace:` / `link:` / `file:` / `$ref` 与选择器键保持不变），避免升级后 overrides 钉住旧版本导致包重复（#1250）。
