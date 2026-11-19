---
title: 运维：实例、依赖与终端
description: Console 侧栏「运维」分组：实例状态、起停与日志，依赖安装与回滚，数据库 / 配置 / 环境变量 / 定时任务 / 文件，以及终端的安全须知
---

# 运维：实例、依赖与终端

侧栏「运维」分组回答「宿主机怎么样」。实例页、依赖安装和终端由管理网关提供（[ADR 0054](../adr/0054-management-gateway.md)），**实例崩溃、停止或正在安装依赖时照常可用**；数据库、配置、定时任务等页面读的是实例或项目文件。默认只有 `owner` / `admin` 看得到这个分组（`operator` 只有 `ops.schedule.read`）。

| 页面 | 路由 | 读 | 写 |
| --- | --- | --- | --- |
| 实例（含项目依赖） | `/ops/instance` | `status.view`；依赖列表 `feature.view` | 起停 `ops.restart`；依赖 `plugin.manage` |
| 数据库 | `/ops/database` | `ops.database.read`（浏览、排序、筛选、表结构） | 记录 `ops.database.write`；SQL 控制台与表结构 `ops.database.schema` |
| 配置文件 | `/ops/config` | `ops.config.read` | `ops.config.write` |
| 环境变量 | `/ops/env` | `ops.env.read`（只看打码值） | `ops.env.write`；「显示」原文需要 `ops.env.read` + `ops.env.write` |
| 定时任务 | `/ops/schedules` | `ops.schedule.read` | `ops.schedule.write` |
| 项目文件 | `/ops/files` | `ops.files.read` | `ops.files.write` |
| 终端 | `/ops/terminal` | `ops.terminal`（仅 `owner`） | — |

插件的安装、更新与卸载在侧栏「插件」分组（「插件」`/plugins`、「插件市场」`/marketplace`、插件详情 `/plugins/:name`），需要 `plugin.manage`，执行时同样走下文的[依赖事务](#packages)。

## 实例 {#instance}

「实例」页是**运行状态的唯一详情页**：首页和机器人状态只给摘要，进程与实例的完整状态都在这里。实例离线时本页仍由网关提供；页面顶部出现「实例不可用」横幅时，点「查看实例」就到这里（见[实例离线怎么办](./index.md#instance-offline)）。

- **运行状态**：`stopped`、`starting`、`running`、`stopping`、`backoff`（崩溃后等待重启）、`crashed`（一分钟内重启超过 10 次，停在「已崩溃」等人处理）；附进程 PID、已运行时长、近一分钟重启次数、启动时间、运行代次（`generation`）、上次退出与实例 ID。依赖事务进行中时，实例由事务停启。
- **最近一次失败**：时间、退出码与「失败前的日志」。按日志找到原因（常见：依赖未安装、配置缺少必填项、环境变量为空），修复后点「启动」；依赖问题可在「项目依赖」里重新安装。
- **操作**：启动、停止、重启（`gateway.instance.start|stop|restart`，需要 `ops.restart`，先确认）。停止后机器人离线，直到再次启动；重启时机器人短暂离线，正在进行的对话可能中断。重启只影响实例，网关与 Console 不中断；实例回到 `running` 前，依赖实例的页面返回 `503 instance_unavailable`，由横幅倒计时并自动重试。
- **实例日志**：网关采集的实例标准输出与标准错误（`gateway.instance.logs`，需要 `status.view`），实例离线时也能看；可「只看错误输出」、暂停或跟随最新。完整日志在服务器的 `.zhin/logs/instance.log`。
- **项目依赖**：`package.json` 里声明的依赖、声明的版本与已安装版本。「安装依赖」可填多个包（`name@版本范围`，空格或逗号分隔），可勾选安装后在配置中启用插件；每行可「更新」「卸载」，也可「全部更新」。非白名单的包只有所有者能安装。
- **版本**：Zhin（`zhin.js`）、网关、Console 包与已安装的 `@zhin.js/*` 插件的当前版本与 npm 上的最新版本（`gateway.version.check`，需要 `status.view`）。由网关查询项目 npm 配置（`.npmrc`，镜像同样生效）指向的 registry，结果在内存里缓存约 6 小时，实例停止时也能看；离线或查询超时显示「无法检查新版本」，不会报错。新版本在 `package.json` 声明的范围内时，用「项目依赖」那一行的「更新」即可；超出范围（跨大版本、需要改版本范围或运行迁移）时 Console 只显示命令 `npx zhin migrate --dry-run`——框架升级只走 CLI 的 [`zhin migrate`](../cli/index.md#migrate)（[ADR 0062](../adr/0062-one-path-per-task.md)），Console 不改版本范围。
