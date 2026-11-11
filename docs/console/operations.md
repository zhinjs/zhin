---
title: 运维：实例、依赖与终端
description: Console「运维」区：实例状态、起停与日志，依赖安装与回滚，数据库 / 配置 / 环境变量 / 定时任务 / 文件，以及终端的安全须知
---

# 运维：实例、依赖与终端

「运维」区回答「宿主机怎么样」。实例页、依赖安装和终端由管理网关提供（[ADR 0054](../adr/0054-management-gateway.md)），**实例崩溃、停止或正在安装依赖时照常可用**；数据库、配置、定时任务等页面读的是实例或项目文件。默认只有 `owner` / `admin` 看得到这个区（`operator` 只有 `ops.schedule.read`）。

| 页面 | 读 | 写 |
| --- | --- | --- |
| 实例 | `status.view` | `ops.restart` |
| 依赖 / 插件安装 | `feature.view` | `plugin.manage` |
| 数据库 | `ops.database.read` | `ops.database.write` |
| 配置文件 | `ops.config.read` | `ops.config.write` |
| 环境变量 | `ops.env.read` | `ops.env.write` |
| 定时任务 | `ops.schedule.read` | `ops.schedule.write` |
| 项目文件 | `ops.files.read` | `ops.files.write` |
| 终端 | `ops.terminal`（仅 `owner`） | — |

## 实例 {#instance}

显示网关监管的 Zhin 实例：

- **状态**：`stopped`、`starting`、`running`、`stopping`、`backoff`（崩溃后等待重启）、`crashed`（一分钟内崩溃超过 10 次，停下等人处理）；附 pid、启动时间、`generation`、最近退出码与最近一次失败的日志尾部。
- **操作**：启动、停止、重启（`gateway.instance.start|stop|restart`，需要 `ops.restart`）。重启只影响实例，网关与 Console 不中断；实例回到 `running` 前，依赖实例的页面返回 `503 instance_unavailable` 并提示稍后重试。
- **日志**：最近的实例输出（`gateway.instance.logs`，需要 `status.view`），来自网关的内存缓冲；完整日志在服务器的 `.zhin/logs/instance.log`。

同样的信息在命令行里是 `zhin status` 与 `zhin logs`，见 [zhin start](../cli/runtime.md#管理命令)。

### 依赖安装与回滚 {#packages}

在插件市场、引导流程里安装、更新、卸载插件和依赖，都走网关的依赖事务（`gateway.packages.plan|install|uninstall|update`，需要 `plugin.manage`）：

1. 生成计划并校验白名单与配置修订号，备份 `package.json`、锁文件与配置；
2. 停止实例；
3. 用项目的包管理器执行，输出实时推到 Console（事件流上的 `gateway.packages.progress`）；
4. 启动实例并等待就绪（默认 60 秒）；
5. 任何一步失败：恢复备份、重新安装、启动旧版本，并报告失败的阶段与日志尾部。

插件配置的 Schema 校验在实例启动之后才进行，校验失败按第 4 步失败处理并回滚。

## 数据库、配置、环境变量、定时任务、文件 {#ops-pages}

- **数据库**：浏览表、按条件查询、增删改行与 KV 存储。写操作直接作用于项目数据库，没有撤销。
- **配置文件**：按当前 YAML / JSON 格式查看与编辑 `zhin.config.yml`，保存带修订号，保存失败自动回滚。实例离线时由网关读写。
- **环境变量**：`.env` 文件。可能含机密，所以 `viewer` 没有 `ops.env.read`。
- **定时任务**：插件注册的任务与持久化任务的列表、暂停、恢复、增删。
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

1. 「运维 → 终端」列出目标（`GET {base}/console/terminal/targets`）。
2. 选择目标后，Console 申请一次性票据（`POST {base}/console/terminal/tickets`，30 秒有效、绑定当前用户），再用它打开 WebSocket `{base}/console/terminal?ticket=…`。长期令牌不会出现在 URL 里。
3. 每个标签页一个会话；断开即结束会话，不做后台保活。

- 需要 `ops.terminal`，内置角色里只有 `owner` 持有；可以来自用户会话或用户 API 令牌，初始化令牌不行。
- 空闲超时、用户被禁用或改密、配置关闭终端时，服务端发送 `exit` 后关闭连接并结束进程。
- 审计日志记录会话开始（用户、目标、IP）与结束（时长、退出码、原因），不记录输入输出。
