# @zhin.js/cli

zhin.js 的命令行入口：启动/管理 bot、插件开发、配置向导与诊断。

> 完整的命令参考见文档站 [CLI 参考](https://zhin.js.org/cli/)（仓内源文件：`docs/cli/index.md`）。
> 本 README 只保留速览。运行入口是 `zhin start`：启动管理网关（`@zhin.js/gateway`），由网关拉起并监管 Zhin 实例（ADR 0054）。默认后台运行，`--foreground` 前台运行（开发、systemd、容器、PM2）。从单进程版本升级见[升级到管理网关](../../docs/migrations/management-gateway.md)。

## 安装

```bash
pnpm add -g @zhin.js/cli   # 或 npm i -g @zhin.js/cli
```

从零新建项目不需要先装 CLI：`pnpm create zhin-app`（独立的 create-zhin-app 包），脚手架会把 `@zhin.js/cli` 写进项目。`zhin start` 依赖 CLI 与它带来的 `@zhin.js/gateway`，开发与生产运行都需要，生产安装不要用 `--prod` 把它剔除。

## 命令速览

```bash
zhin start               # 后台启动网关与实例（--watch source config；--mode production）
zhin start --foreground --mode production --no-watch   # systemd / Docker / PM2 用前台
zhin status [--json]      # 网关与实例状态（未运行时退出码 3）
zhin logs [-f] [-n N]     # 实例日志
zhin restart [--gateway]  # 重启实例（--gateway 连网关一起）
zhin stop                 # 停止实例与网关
zhin update [pkg...]      # 更新依赖（网关运行时：停实例 → 安装 → 启实例，失败回滚）
zhin console init         # 初始化：数据库 + 第一个所有者（之后 http.token 失效）
zhin console user …       # 用户管理与救援（create / passwd / disable / enable / list）；网关运行时经网关，否则直接打开数据库
zhin service install      # 安装开机自启的系统服务（前台网关）
zhin new <name>           # 创建约定式插件
zhin install <pkg>        # 安装插件并写入 plugins.<instanceKey>（别名 zhin add）
zhin setup                # 交互式配置向导（适配器 / AI / 数据库）
zhin config check [--fix] # 校验/修复 zhin.config.yml
zhin config set <key> <value> # 经运行中 Host 校验、保存并按需生效；--offline 显式离线
zhin doctor               # 环境诊断
zhin send <scene_id> ...  # 向运行中的实例发消息（多适配器时加 -a <adapter>）
zhin schedule list|add|remove|pause|resume  # 管理运行中实例的持久化调度任务
zhin --help               # 全部命令
```

命令分五组：运行（`start` / `stop` / `restart` / `status` / `logs` / `console`）、插件开发（`new` / `build` / `pub` / `install` / `uninstall` / `update` / `search` / `info` / `packages`）、配置与诊断（`setup` / `onboard` / `config` / `doctor` / `migrate`）、运行中实例（`send` / `watch` / `schedule` / `agent`）、系统服务（`service install` / `service uninstall` / `service status`）。每组的具体参数见 [docs/cli/index.md](../../docs/cli/index.md) 与 `zhin <command> --help`。

## 进程模型与退出码

- `zhin start` 启动常驻的管理网关：网关监听 `http.port`、负责 Console 登录与权限、终端、依赖事务，并经 IPC 控制通道拉起实例。实例就绪发 `ready`，需要整进程重启时发 `restart-request`（Console 重启、依赖变化等），网关回以 `shutdown` 后重新拉起；不再使用退出码重启。崩溃按风暴保护（每分钟 10 次、间隔 3 秒）重启，超限停在 `crashed`，网关继续运行。实例日志写 `.zhin/logs/instance.log` 并按大小轮转，后台网关自身输出写 `.zhin/logs/gateway.log`。
- `zhin stop / restart / status / logs` 经本地控制套接字 `.zhin/gateway.sock`（`0600`）请求网关，须以启动网关的同一用户运行；`zhin install / uninstall / update` 在网关运行时经网关执行（停实例 → 安装 → 启实例，失败回滚）。
- 前台网关正常结束退出码 `0`，Ctrl+C 为 `130`；`zhin start --once` 返回实例的退出码；`zhin status` 在网关未运行时返回 `3`。
- 热重载语义见 [docs/cli/runtime.md](../../docs/cli/runtime.md)。

## 开发

本包不依赖 `zhin.js` 与 IM 层（ADR 0054 §0）：`zhin start` 拉起网关，网关按项目根解析 `zhin.js/instance`（实例装配根）启动实例；Console 账号与权限、终端、项目配置与依赖事务来自 `@zhin.js/gateway`。仓库内改动后：

```bash
pnpm --filter @zhin.js/cli build
pnpm vitest run basic/cli        # 本包没有 test 脚本，从仓库根运行测试
```

详见 [docs/contributing/development.md](../../docs/contributing/development.md)。
