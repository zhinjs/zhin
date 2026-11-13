---
title: 运维：实例、依赖与终端
description: Console 侧栏「运维」分组：实例状态、起停与日志，依赖安装与回滚，数据库 / 配置 / 环境变量 / 定时任务 / 文件，以及终端的安全须知
---

# 运维：实例、依赖与终端

侧栏「运维」分组回答「宿主机怎么样」。实例页、依赖安装和终端由管理网关提供（[ADR 0054](../adr/0054-management-gateway.md)），**实例崩溃、停止或正在安装依赖时照常可用**；数据库、配置、定时任务等页面读的是实例或项目文件。默认只有 `owner` / `admin` 看得到这个分组（`operator` 只有 `ops.schedule.read`）。

| 页面 | 路由 | 读 | 写 |
| --- | --- | --- | --- |
| 实例（含项目依赖） | `/ops/instance` | `status.view`；依赖列表 `feature.view` | 起停 `ops.restart`；依赖 `plugin.manage` |
| 数据库 | `/ops/database` | `ops.database.read`（含只读 SQL） | 记录 `ops.database.write`；写 SQL 与表结构 `ops.database.schema` |
| 配置文件 | `/ops/config` | `ops.config.read` | `ops.config.write` |
| 环境变量 | `/ops/env` | `ops.env.read` | `ops.env.write` |
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

同样的信息在命令行里是 `zhin status` 与 `zhin logs`，见 [zhin start](../cli/runtime.md#管理命令)。

### 依赖安装与回滚 {#packages}

下面这些入口安装、更新、卸载插件和依赖，都走网关的依赖事务（`gateway.packages.plan|install|uninstall|update`，需要 `plugin.manage`）：插件市场详情的「安装」、插件详情「版本与依赖」的「更新」「卸载」、实例页「项目依赖」，以及引导第 4 步。

1. 生成计划并校验白名单与配置修订号，备份 `package.json`、锁文件与配置；页面先展示计划，确认后才执行；
2. 停止实例；
3. 用项目的包管理器执行，输出实时推到 Console（事件流上的 `gateway.packages.progress`）；
4. 启动实例并等待就绪（默认 60 秒）；
5. 任何一步失败：恢复备份、重新安装、启动旧版本，并报告失败的阶段与日志尾部。

插件配置的 Schema 校验在实例启动之后才进行，校验失败按第 4 步失败处理并回滚。插件 Schema 里有没有默认值的必填字段时，安装结果显示「需要配置」，列出缺少的配置项与环境变量；按钮打开按 Schema 生成的配置表单，提交后网关写入插件声明并重启实例，失败回滚配置。

安装回执丢失（结果未知）时，页面只做只读核对，不会自动重放旧操作；见[操作回执](./index.md#receipts)。

## 数据库、配置、环境变量、定时任务、文件 {#ops-pages}

- **数据库**：浏览表、按条件查询、增删改行与 KV 存储。写操作直接作用于项目数据库，没有撤销。
- **配置文件**：按当前 YAML / JSON 格式查看与编辑 `zhin.config.yml`，保存带修订号，保存失败自动回滚。实例离线时由网关读写。某个插件的配置在它的全局配置页（`/features/global/:plugin`）用表单改，按层级的覆盖在对象页的「功能」页签。
- **环境变量**：`.env` 文件。可能含机密，所以 `viewer` 没有 `ops.env.read`。
- **定时任务**：打开时是「全部任务」总览，汇总每个任务的状态、下次运行、最近结果、目标与审批，可按状态筛选；创建、暂停和查看记录在各自的页签：「管理员任务」（`?tab=admin`，按用途创建管理员任务）、「定时提醒」（`?tab=schedule`，插件注册的任务与持久化任务）、「助手任务」（`?tab=assistant`）、「执行记录」（`?tab=history`）。
- **项目文件**：项目文件树与文本文件编辑；读写 `.env` 与配置文件仍需要对应的 `ops.env.*` / `ops.config.*` 权限。

## 终端 {#terminal}

终端在浏览器里打开宿主机 Shell，或跳到白名单里的 SSH 目标（[ADR 0051](../adr/0051-console-terminal.md)）。它运行在网关里，实例崩溃时也能用。

::: danger 终端等于宿主机 Shell
终端以运行网关的系统用户身份执行任意命令，能读写该用户能访问的一切文件（包括 `.env`、数据库、私钥）。**持有所有者凭据就等于持有这台机器的 Shell。** 只在确实需要时开启，所有者账号用强密码，不要签发带 `ops.terminal` 的长期 API 令牌。
:::

### 开启

默认关闭，关闭时终端路由不注册（返回 404）：

```yaml
console:
  terminal:
    enabled: true
    shell: /bin/bash        # 省略时：$SHELL，Windows 为 powershell.exe
    cwd: .                  # 相对项目根
    idleTimeout: 900        # 秒，无输入即断开
    maxSessions: 4          # 同时会话上限
    ssh:
      - name: build-box
        host: 10.0.0.12
        port: 22
        username: deploy
        privateKeyPath: ~/.ssh/id_ed25519     # 或 privateKeyEnv / passwordEnv（+ passphraseEnv）
        hostFingerprint: SHA256:…             # 强烈建议填写
```

- 本地 Shell 需要可选依赖 `node-pty`，SSH 需要 `ssh2`；缺失时对应目标显示「不可用」与安装提示。
- SSH 凭据只来自本地密钥文件或环境变量，从不经过浏览器，也不出现在任何接口响应里。浏览器只能按 `name` 选择目标。

### 固定 SSH 主机指纹 {#ssh-fingerprint}

填了 `hostFingerprint` 时，网关严格比对目标主机公钥，不一致就拒绝连接；**不填时接受任何主机公钥**，中间人可以冒充目标拿到你的会话。部署前在一台可信的机器上取指纹：

```bash
ssh-keyscan -t ed25519 10.0.0.12 2>/dev/null | ssh-keygen -lf -
# 256 SHA256:AbCd… 10.0.0.12 (ED25519)
```

把 `SHA256:…` 那一段原样填进 `hostFingerprint`。目标主机重装或换钥后要同步更新。

### 使用与权限

1. 侧栏「运维 → 终端」（`/ops/terminal`）列出目标（`GET {base}/console/terminal/targets`）。
2. 选择目标后，Console 申请一次性票据（`POST {base}/console/terminal/tickets`，30 秒有效、绑定当前用户），再用它打开 WebSocket `{base}/console/terminal?ticket=…`。长期令牌不会出现在 URL 里。
3. 每个标签页一个会话；断开即结束会话，不做后台保活。

- 需要 `ops.terminal`，内置角色里只有 `owner` 持有；可以来自用户会话或用户 API 令牌，初始化令牌不行。
- 空闲超时、用户被禁用或改密、配置关闭终端时，服务端发送 `exit` 后关闭连接并结束进程。
- 审计日志记录会话开始（用户、目标、IP）与结束（时长、退出码、原因），不记录输入输出。
