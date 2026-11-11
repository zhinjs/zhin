# @zhin.js/cli

zhin.js 的命令行入口：启动/管理 bot、插件开发、配置向导与诊断。

> 完整的命令参考见文档站 [CLI 参考](https://zhin.dev/cli/)（仓内源文件：`docs/cli/index.md`）。
> 本 README 只保留速览。运行入口统一为 `zhin runtime start`；`zhin start` 是它的别名（参数原样转发）。旧的 `zhin restart` 与 `--port` / `--bun` 选项已下线。

## 安装

```bash
pnpm add -g @zhin.js/cli   # 或 npm i -g @zhin.js/cli
```

从零新建项目不需要先装 CLI：`pnpm create zhin-app`（独立的 create-zhin-app 包）。

## 命令速览

```bash
zhin runtime start        # 启动 bot（dev 热重载 / --mode production / --daemon）
zhin stop                 # 停止 daemon 实例
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

命令分五组：运行（`runtime` / `stop`）、插件开发（`new` / `build` / `pub` / `install` / `uninstall` / `search` / `info` / `packages`）、配置与诊断（`setup` / `onboard` / `config` / `doctor` / `migrate`）、运行中实例（`send` / `watch` / `schedule` / `agent`）、系统服务（`service install` / `service uninstall`）。每组的具体参数见 [docs/cli/index.md](../../docs/cli/index.md) 与 `zhin <command> --help`。

## 进程模型与退出码

- `zhin runtime start` 的父进程是监管进程（`@zhin.js/gateway/supervisor`），经 IPC 控制通道拉起实例：实例就绪发 `ready`，需要整进程重启时发 `restart-request`（Console 重启、依赖变化等），监管进程回以 `shutdown` 后重新拉起；不再使用退出码重启。daemon 模式下崩溃按风暴保护（每分钟 10 次、间隔 3 秒）重启，日志写 `.zhin/logs/instance.log` 并按大小轮转。
- 热重载语义见 [docs/cli/runtime.md](../../docs/cli/runtime.md)。

## 开发

本包不依赖 `zhin.js` 与 IM 层（ADR 0054 §0）：`zhin runtime start` 按项目根解析 `zhin.js/instance`（实例装配根）启动实例；Console 账号与权限、终端、项目配置与依赖事务来自 `@zhin.js/gateway`。仓库内改动后：

```bash
pnpm --filter @zhin.js/cli build
pnpm --filter @zhin.js/cli test
```

详见 [docs/contributing/development.md](../../docs/contributing/development.md)。
