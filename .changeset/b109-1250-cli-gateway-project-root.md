---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
"@zhin.js/core": patch
---

**项目根检查、`zhin update` 未声明的包、会话迁移坏行**（#1250）。

- `zhin start`（后台与 `--foreground`）、`zhin runtime start`、`zhin restart` 先确认当前目录是项目根（有 `zhin.config.*` 或依赖 `zhin.js` 的 `package.json`）：在非项目目录提示用 `npm create zhin-app` 新建项目，在项目子目录（如 `plugins/x/`）给出项目根路径，都以退出码 1 结束，不启动网关、不监听端口、不写 `.zhin/`。
- `zhin console init` / `console user …` / `console migrate` 从当前目录向上找到项目根，在子目录运行也操作项目根的 `.zhin/gateway.db`，并在标准错误输出打印实际使用的路径；找不到项目时提示并以退出码 1 结束，不再在当前目录新建孤立的 `gateway.db`。
- `zhin doctor` 在非项目目录第一条就报「Zhin 项目」错误并建议 `npm create zhin-app`（子目录给出项目根），只检查 Node 与 pnpm、以退出码 1 结束，不再建议 `pnpm init`；`--fix` 此时不写文件，诊断 gateway.db 也不再建出空的 `.zhin/`（`resolveProjectDatabaseConfig` 新增 `{ createDirectory: false }` 只读选项）。
- `zhin update <包名>`（不带版本）对根项目和工作区成员都没声明的包报错「不是本项目的依赖；安装请用 zhin install <包名>」并以退出码 1 结束，在停止实例之前就拒绝；以前会报「✓ update 完成」却什么都没改。
- 启动迁移 `migrateConversationColumns` 遇到解析不了的 `event_json`（或不是会话事件）时跳过该行并记一条 warn（表名、行 id 与原因，不含内容），其余行照常回填、索引照常创建，结束时汇总跳过的行数；坏行保持原样（`event_json` 不动、`query_version` 仍为空），不会丢数据，下次启动会再次提示。以前一行坏 JSON 就让实例这一代激活失败。
- `@zhin.js/gateway/supervisor` 的 `runSupervisedInstance` 标为 `@deprecated`：`zhin start` 早已改用 `@zhin.js/gateway/server` 的 `runGateway`，保留导出只为兼容外部调用；补充退出码与 `.zhin.pid` 的行为测试。
