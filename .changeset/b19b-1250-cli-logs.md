---
"@zhin.js/cli": minor
---

日志、升级预览与包列表（zhinjs/zhin#1250 第 19b 批）：

- `zhin logs` 新增 `--level`（该级别及以上）、`--since` / `--until`（`10m`、`1h`、`09:00`、`2026-11-15 09:00` 或带时区的 ISO 时间）、`--grep`（不区分大小写）和 `--name`（行首 `[来源]` 段，前缀匹配）。带过滤条件时依次搜索实例日志文件及其轮转文件，不受 1000 行缓冲限制，`-n` 表示匹配的行数（最多 100000）；`-f` 只输出匹配的新行；堆栈等续行跟随所属日志。日志行没有插件字段，也不是结构化格式，因此没有 `--plugin` 和 `--json`。
- `zhin update --dry-run`：按根项目和每个 pnpm 工作区成员列出「当前 → 目标」版本与范围，最新版本超出范围时说明；不写文件，也不停止或重启实例。
- `zhin packages list` 分组列出项目依赖（适配器 / 插件 / Zhin 框架与功能包 / 其他依赖 / 未安装）与技能包，新增 `--json`；不再在装了几十个插件时显示「无已安装 zhin-package」。`zhin packages install <npm 包>`、`packages search`、`packages info` 行为不变，但提示已弃用，改用 `zhin install` / `search` / `info`（ADR 0062 第 11 项）。
- `zhin doctor`：HTTP 端口被占用时经 `/pub/health`（不带凭据）判断占用者是不是 Zhin 网关，是另一个项目时写出项目目录与 pid；项目根目录里有旧版脚手架的服务文件（`.service`、`.plist`、`install-service.ps1`、`*-task.xml`、`ecosystem.config.*`）时提示可以删除，改用 `zhin service install`（只提示，不删除）。
