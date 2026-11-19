---
"@zhin.js/console-protocol": minor
"@zhin.js/gateway": minor
---

网关新增只读版本检查 RPC `gateway.version.check`（zhinjs/console#64 version-update），供 Console 显示当前版本与「有新版本」提示。

- 报告 `zhin.js`、`@zhin.js/gateway`、`@zhin.js/console-*` 与已安装的 `@zhin.js/*` 插件（`package.json#zhin.type: "plugin"`）：每行 `name` / `range` / `installed` / `latest` / `wanted`（声明范围内的最高版本）/ `latestInRange` / `updateAvailable` / `needsMigrate`，外加 `gateway`（运行中的网关版本）、`checkedAt`、`registryReachable`。网关不是项目直接依赖时也单列一行（`range: null`）。
- 权限 `status.view`（与实例状态相同），已登记到 `GATEWAY_RPC_PERMISSIONS` / `CONSOLE_RPC_PERMISSIONS`。由网关自己回答，实例停止时也可用。
- 在项目根目录执行 `npm view <包> dist-tags versions --json`，沿用项目的 npm 配置（`.npmrc`、镜像）；结果在内存缓存约 6 小时，失败的查询 10 分钟后重试，单次超时 5 秒。先探测一个包，registry 不可达时其余包不再逐个等超时。离线、超时都得到 `latest: null` 与 `registryReachable: false`，从不报错；没有新增配置开关。
- 只报告不升级：超出声明范围的新版本标为 `needsMigrate`，Console 只提示 `npx zhin migrate --dry-run`（新导出常量 `GATEWAY_VERSION_MIGRATE_COMMAND`），框架升级仍只走 `zhin migrate`（ADR 0062）。
- `@zhin.js/console-protocol` 新增 `GATEWAY_VERSION_RPC`、类型 `GatewayVersionReport` / `GatewayVersionPackage`。`@zhin.js/gateway` 新增公开导出 `GatewayVersionChecker`、`classifyPackageVersion()`、`isVersionCheckedPackage()`、`parseNpmViewVersions()`、`npmViewRegistryFetcher`（/packages），`GatewayPackageService` 新增 `inventory()`（不做授权的依赖清单，供已自行授权的网关服务使用）；网关新增依赖 `semver`。
- 文档：Console「运维」页（中英文）补充「版本」说明，CLI 文档的 `migrate` 小节加锚点 `#migrate`。
