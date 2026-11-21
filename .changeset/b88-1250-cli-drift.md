---
"@zhin.js/cli": patch
"create-zhin-app": patch
"@zhin.js/adapter": patch
"zhin.js": patch
"@zhin.js/database": patch
---

#1250 第 88 批：CLI 无终端时不再卡住、迁移脚本与脚手架一致、Console 新增账号不算配置漂移、CLI 输出不夹数据库日志。

- `@zhin.js/cli`：标准输入不是终端（管道、`< /dev/null`、CI）时，`zhin console user create` / `user passwd` 不带 `--password-stdin`、`zhin console init` 的交互向导（或只给 `--owner` 没给 `--password-stdin`）、`zhin console init --reset-store` 不带 `--yes` 不再进入交互提问一直等待，而是直接报错退出（退出码 1）并提示改用 `--password-stdin` / `--owner` / `--yes`。`zhin setup` 的交互步骤、`zhin onboard`、不带插件名的 `zhin install` 同样直接报错；`zhin setup --bootstrap` 遇到已存在的引导文件与 `--yes` 一样跳过，`zhin uninstall plugin` 不再询问是否删除本地插件目录（保留）。`ConsoleCliIo` 新增可选 `interactive()`。
- `@zhin.js/cli`：`zhin migrate` 不再给项目加 `scripts.daemon`，补齐的 scripts 与 `create-zhin-app` 新项目完全一致（`dev` / `start` / `stop` / `preview` / `build`，已有的不动）；`RECOMMENDED_START_SCRIPTS` 去掉 `daemon`，新增 `RECOMMENDED_PROJECT_SCRIPTS` / `LEGACY_PROJECT_SCRIPTS`，测试直接与脚手架的 `CREATE_BOT_SCRIPTS` 比对。
- `create-zhin-app`：新项目的 scripts 抽成 `src/scripts.ts` 的 `CREATE_BOT_SCRIPTS`（内容不变）。
- `@zhin.js/adapter`：在 Console 新增的账号（`Adapter.add`）记 `origin: 'console'`，替换账号时沿用，从配置导入时去掉。这样的账号不在配置文件里不算漂移：`configDrift()` 仍把它列为 `snapshot_only` 并带 `origin: 'console'`（可写回），启动日志的 `endpoint_config_drift` 警告不再列它；新增 `isEndpointConfigDivergence()`。账号元数据（`list()`）不含 `origin`。
- `zhin.js`：Console「需要你处理」的账号差异项（以及据此计数的 `zhin status` / `zhin doctor`）不再包含 Console 新增的账号；「已不在配置文件（仍按已保存账号运行）」改为「仅存在于已保存账号中（配置文件里没有；照常按已保存账号运行，不处理也不影响）」，英文同步。
- `@zhin.js/database`：`Database disconnected from dialect: …` 与 PostgreSQL / MySQL / MongoDB 的连接关闭日志降为 debug，`zhin doctor` 等 CLI 命令的输出里不再出现 `[INFO] [database] …` 行。
