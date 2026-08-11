# @zhin.js/cli

zhin.js 的命令行入口：启动/管理 bot、插件开发、配置向导与诊断。

> 完整的命令参考见文档站 [CLI 参考](https://zhin.dev/cli/)（仓内源文件：`docs/cli/index.md`）。
> 本 README 只保留速览；历史上这里的 `zhin dev` / `zhin start` / `zhin restart`（含 `--port` / `--bun`）文档已随命令下线删除——运行入口统一为 `zhin runtime start`。

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
zhin install <pkg>        # 安装插件并写入 plugins.<instanceKey>
zhin setup                # 交互式配置向导（适配器 / AI / 数据库）
zhin config check [--fix] # 校验/修复 zhin.config.yml
zhin doctor               # 环境诊断
zhin send <scene_id> ...  # 向运行中的实例发消息
zhin --help               # 全部命令
```

命令分五组：运行（`runtime` / `stop`）、插件开发（`new` / `build` / `pub` / `install` / `uninstall` / `search` / `info` / `packages`）、配置与诊断（`setup` / `onboard` / `config` / `doctor` / `migrate`）、运行中实例（`send` / `watch` / `schedule` / `agent`）、系统服务（`service`）。每组的具体参数见 [docs/cli/index.md](../../docs/cli/index.md) 与 `zhin <command> --help`。

## 进程模型与退出码

- CLI daemon 监听退出码：`51` = Console 请求重启（自动拉起新进程）；`75` = 运行时报 restartRequired（按风暴保护策略重启）。
- 热重载语义见 [docs/cli/runtime.md](../../docs/cli/runtime.md)。

## 开发

本包同时是 Plugin Runtime 的 composition root（`zhin runtime start` 装配 IM / Agent / Console Host）。仓库内改动后：

```bash
pnpm --filter @zhin.js/cli build
pnpm --filter @zhin.js/cli test
```

详见 [docs/contributing/development.md](../../docs/contributing/development.md)。
