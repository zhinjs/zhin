---
title: CLI 参考
---

# CLI 参考

Zhin.js 的命令行工具由 `@zhin.js/cli` 提供，可执行文件为 `zhin`。新建项目用 `pnpm create zhin-app`（独立的 `create-zhin-app` 包，不在本页范围）。

```bash
zhin --help        # 查看全部命令
```

## 命令总览

| 分组 | 命令 |
| --- | --- |
| 运行 | `runtime`、`stop` |
| 插件开发 | `new`、`build`、`pub`、`install` / `add`、`uninstall`、`search`、`info`、`packages` |
| 配置与诊断 | `setup`、`onboard`、`config`、`doctor`、`migrate` |
| 运行中实例 | `send`、`watch`、`schedule`、`agent` |
| 系统服务 | `service` |

## runtime：运行与管理项目

```bash
zhin runtime start [--mode production] [--no-watch] [--daemon]
zhin runtime init [package-name]
zhin runtime create <plugin|feature> <name> [package-name]
zhin runtime inspect
zhin runtime build
zhin runtime publish [--execute|--resume] [--tag latest]
zhin runtime migrate [extract|cutover|status] [--check|--write]
```

- `start` 是启动 bot 的入口，支持 dev 热重载、production、daemon 守护等模式，详解见 [zhin runtime start](./runtime.md)。
- `init` / `create` 脚手架约定式 Plugin Runtime 项目与插件/能力包。
- `inspect` 输出项目结构 JSON（插件清单、构建计划）。
- `build` / `publish` 按项目图构建、发布；`publish` 默认只打印计划，`--execute` 才执行（支持中断后 `--resume`）。
- `migrate` 生成并应用项目结构迁移计划：`--check` 只看计划，`--write` 原子写入，`status` 输出就绪报告。

项目里的惯例脚本（由脚手架生成）：

```json
{
  "scripts": {
    "dev": "zhin runtime start",
    "start": "zhin runtime start --mode production --no-watch"
  }
}
```

## stop：停止 bot

```bash
zhin stop
```

停止当前项目下由 daemon 模式启动的进程（读取 `.zhin.pid`）。没有运行中的进程时只提示、不报错。

## new：创建插件

```bash
zhin new [plugin-name] [--type normal|service|adapter] [--is-official] [--skip-install]
```

- 在 `plugins/<name>/` 下生成约定式插件包模板；插件名须匹配 `/^[a-z][a-z0-9-]*$/`。
- 不传参数时进入交互式问答（名称、类型）。

## build：构建插件

```bash
zhin build [plugin] [--clean] [--production] [--analyze]
```

- `plugin` 为相对 `plugins/` 的路径（如 `adapters/icqq`）；省略时在插件目录内构建当前包，或在 workspace 根批量构建 `plugins/*`。
- 按目录自动编译 `src/`（tsc）与 `client/`（esbuild）；`--clean` 先清理 `lib/` 与 `dist/`；`--production`（默认开）压缩 client 产物。

## pub：发布插件

```bash
zhin pub [plugin-name] [--tag latest] [--access public] [--registry <url>] [--dry-run] [--skip-build]
```

- 在含 `plugins/` 目录的项目根运行；不传名字时交互选择可发布的插件。
- `--dry-run` 只走流程不实际发布。

## install / add：安装插件

```bash
zhin install <插件名或 git 地址> [--no-enable] [--dry-run]
zhin add ...          # install 的别名
```

| 选项 | 说明 |
| --- | --- |
| `-S, --save` | 写入 `dependencies`（默认） |
| `-D, --save-dev` | 写入 `devDependencies` |
| `-g, --global` | 全局安装（不启用插件） |
| `--no-enable` | 只装依赖，不改配置 |
| `--dry-run` | 打印将执行的安装与配置改动，不写入 |

默认行为：pnpm 安装后自动把插件写入 `zhin.config.yml` 的 `plugins.<instanceKey>`，并挂进 `package.json` 的 `zhin.plugins` 清单。安装适配器后按提示运行 `zhin setup --adapters` 添加 Endpoint。

## uninstall：卸载

```bash
zhin uninstall plugin <name> [--remove-pkg]
zhin uninstall adapter <name> [--remove-pkg]
zhin uninstall service
```

`name` 可以是 npm 包名或 instanceKey；`--remove-pkg` 同时从 `package.json` 移除依赖。`uninstall service` 卸载系统服务。

## search / info：发现插件

```bash
zhin search [keyword] [-c utility|service|game|adapter|admin|ai] [-l 20] [--official]
zhin info <package>
```

搜索插件市场 / 查看单个插件详情。

## packages：技能/扩展包

```bash
zhin packages install <npm:pkg|git:url> [--local]
zhin packages remove <name> [--local]
zhin packages list [--local]
zhin packages update [source] [--local]
```

管理 zhin-package 技能/扩展包（ADR 0010）；`--local`（`-l`）安装到项目 `.zhin/packages/` 而非全局。

## setup：交互式配置向导

```bash
zhin setup                 # 完整向导
zhin setup --database      # 仅配置数据库
zhin setup --adapters      # 仅配置适配器（写 endpoints）
zhin setup --ai            # 仅配置 AI
zhin setup --bootstrap     # 仅生成引导文件（SOUL.md / TOOLS.md / AGENTS.md）
zhin setup --global        # 在 ~/.zhin 初始化全局实例
```

向导改动的正是 [`zhin.config.yml`](../configuration/index.md) 的对应段落，并把密钥写入 `.env`。

## onboard：项目引导

```bash
zhin onboard [--quick] [--flow quickstart|full]
```

在项目内复用现有配置 / 环境变量 / data，选择保持或重新配置。`--quick`（`-q`）只显示快速开始，不进入向导；`--flow` 默认 `full`，`quickstart` 少问。

## config：读写配置文件

```bash
zhin config list
zhin config get <key>            # 支持嵌套路径，如 ai.enabled
zhin config set <key> <value>    # value 支持 JSON
zhin config delete <key>
zhin config path                 # 显示配置文件路径
zhin config check [--fix] [--json] [--strict]
```

`config check` 校验配置文件并可自动修复可安全迁移的字段；`--strict` 把警告视为错误（适合 CI）。

## doctor：环境诊断

```bash
zhin doctor [--fix] [--upgrade-l4]
```

检查系统环境与项目配置；`--fix` 自动修复可修复项；`--upgrade-l4` 诊断 minimal → L4 升级路径（AI 栈 + optional peer）。

## migrate：项目升级

```bash
zhin migrate [--dry-run] [--no-install]
```

把老版本 Zhin 项目升级到最新（依赖、scripts、目录结构）。`--dry-run` 只打印计划；`--no-install` 跳过最后的 `pnpm install`。

## send：向运行中的 bot 发消息

```bash
zhin send <scene_id> [content...] [-s private|group|channel] [-a <adapter>] [-e <endpoint>]
```

- 经 HTTP API 向 daemon 运行中的实例投递消息（需启用 HTTP 服务）。
- `scene_id`：私聊为用户 ID，群聊为群号；不传 `content` 时从 stdin 读一行。
- `-a` 默认 `process`；`-e` 指定 Endpoint ID，缺省用该适配器下第一个在线 Endpoint。

## watch：监视运行实例

```bash
zhin watch [-i 3] [--once] [--json] [--no-clear]
```

轮询 Host API（stats / bots / assistant jobs）刷面板；`--once` 拉一次退出，`--json` 适合脚本。

## schedule：持久化调度任务

任务存于 `data/schedule-jobs.json`，修改后需重启应用生效。

```bash
zhin schedule list
zhin schedule add "0 0 9 * * *" --prompt "早上好，汇报今日日程" [--kind solar|lunar|workday|freeDay]
zhin schedule add --every 30m --prompt "检查一下 RSS"
zhin schedule add --at 2026-08-01T09:00:00Z --prompt "一次性提醒"
zhin schedule remove <id>
zhin schedule pause <id>
zhin schedule resume <id>
```

`add` 选项：`--prompt`（必填，到点发给 AI 的提示词）、`-l/--label`、`--kind`（默认 `solar`）、`--notify-channel im|silent|log`（默认 `silent`）、`--at`（单次 ISO8601）、`--every`（如 `30m`、`1h`、`1d`）。cron 与 `--at`/`--every` 三选一。

## agent：Agent 创作面诊断

```bash
zhin agent info [--json]
```

列出发现的 `agent/` 创作面（tools / skills 等）。需安装 AI 栈（`@zhin.js/agent` + `zod` + `ai`）。

## service：系统服务

```bash
zhin service install [--user]
zhin service uninstall [--user]
zhin service status [--user]
```

安装开机自启 / 守护服务；`--user` 在 Linux 下使用用户级 systemd。`status` 仅 Linux/macOS。

## 退出码速查

| 退出码 | 含义 |
| --- | --- |
| `51` | Console 请求重启（CLI daemon 会自动拉起新进程） |
| `75` | 运行时报 restartRequired（如 lockfile 变更），daemon 按风暴保护策略重启 |

进程模型与热重载语义见 [zhin runtime start 详解](./runtime.md)。
