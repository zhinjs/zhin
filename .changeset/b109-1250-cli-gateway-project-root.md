---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
"zhin.js": patch
---

**项目根检查、`zhin update` 未声明的包、会话迁移坏行**（#1250）。

- `zhin start`（后台与 `--foreground`）、`zhin runtime start`、`zhin restart` 先确认当前目录是项目根：带 `package.json` 且有 `zhin.config.*`（当前目录也认 `config.*`）或 `package.json` 依赖 `zhin.js` 的目录；pnpm 工作区成员归属工作区根；上级目录里零散的 `config.json` 或两个配置文件不会抢走下面的项目，也不会让命令抛异常。在非项目目录提示用 `npm create zhin-app` 新建项目（只有配置文件时提示补 `package.json`），在项目子目录（如 `plugins/x/`）给出项目根路径与带原参数、路径加引号的重跑命令，项目根有多个配置文件时提示只保留一个，都以退出码 1 结束，不启动网关、不监听端口、不写 `.zhin/`。
- `zhin console init` / `console user …` / `console migrate` 从当前目录向上找到项目根，在子目录运行也操作项目根的 `.zhin/gateway.db`，并在标准错误输出打印实际使用的路径；找不到项目时提示并以退出码 1 结束，不再在当前目录新建孤立的 `gateway.db`。
- `zhin doctor` 在非项目目录第一条就报「Zhin 项目」错误并建议 `npm create zhin-app`（子目录给出项目根），只检查 Node 与 pnpm（`--upgrade-l4` 也一样）、以退出码 1 结束，不再建议 `pnpm init`；`--fix` 此时不写文件，诊断 gateway.db 也不再建出空的 `.zhin/`（`resolveProjectDatabaseConfig` 新增 `{ createDirectory: false }` 只读选项）。
- `zhin update <包名>`（不带版本）对根项目和工作区成员都没声明的包报错「不是本项目的依赖；安装请用 zhin install <包名>」并以退出码 1 结束，在拿到依赖事务锁之后、停止实例之前检查（锁内读清单，不与另一事务的修改交错）；工作区成员按 `pnpm-workspace.yaml` 的 glob 逐段展开查找（`packages/**` 不限深度，不进入 glob 之外的目录）。以前会报「✓ update 完成」却什么都没改。
- 启动迁移 `migrateConversationColumns` 遇到解析不了的 `event_json`（`invalid_event_json`），或解析出来不是有效会话事件（类型未知或缺失、缺地址或引用，`invalid_event`）时跳过该行并记 warn（表名、行 id 与原因，不含内容；逐行只报前 20 条，其余只计入汇总），其余行照常回填、索引照常创建，结束时汇总跳过的行数；坏行保持原样（`event_json` 不动、`query_version` 仍为空），不会丢数据，下次启动会再次提示。以前一行坏 JSON 就让实例这一代激活失败。
- 读取端同样跳过坏行：`DatabaseConversationEventStore` 的 `listBetween` / `listMessages` / `getMessage` / 事件去重与 Console 聊天记录接口遇到解析不了或不是有效事件的行时跳过（每行只报一次，每个 store 最多报 20 行，之后一条「已抑制」提示；报告只含行 id 与原因），分页会越过坏行补满一页，`hasMore` 仍然准确；以前这类行会让该会话的历史读取失败（Console 返回 503）。新增导出 `readStoredConversationEvent` / `isConversationEvent`（`@zhin.js/im-contract`），构造参数新增可选的 `{ onInvalidRow }`。
- `@zhin.js/gateway/supervisor` 的 `runSupervisedInstance` 标为 `@deprecated`：`zhin start` 早已改用 `@zhin.js/gateway/server` 的 `runGateway`，保留导出只为兼容外部调用，并列入 Public API 清单的 Deprecated 表；补充退出码与 `.zhin.pid` 的行为测试。
