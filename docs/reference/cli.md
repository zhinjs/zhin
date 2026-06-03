# CLI 命令参考

Zhin.js 命令行工具完整说明。Stable 上手只需 `dev` / `start` / `stop`；其余命令见下表，细节以 [`@zhin.js/cli` README](https://github.com/zhinjs/zhin/tree/main/basic/cli) 为准。

## 开发与运维

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin dev`     | 开发模式启动（热重载），支持 `-p/--port`、`--verbose`、`--bun`    |
| `zhin start`   | 生产模式启动，支持 `-d/--daemon`、`--log-file`、`--bun`           |
| `zhin restart` | 重启后台运行的机器人                                              |
| `zhin stop`    | 停止后台运行的机器人                                              |
| `zhin build`   | 构建插件，支持 `--clean`、`--production`、`--analyze`             |

## 插件管理

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin new`     | 创建插件模板（normal/service/adapter），支持 `--type`             |
| `zhin install` | 安装插件（npm 或 git），支持 `-S/--save`、`-D/--save-dev`、`-g`  |
| `zhin add`     | `install` 的别名                                                  |
| `zhin pub`     | 发布插件到 npm，支持 `--tag`、`--dry-run`、`--access`             |
| `zhin search`  | 搜索 npm 上的 Zhin 插件，支持 `-c/--category`、`--official`       |
| `zhin info`    | 查看某个插件的详细信息                                            |

## 配置与诊断

| 命令                    | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `zhin setup`            | 交互式配置向导（数据库、适配器、AI 等）                    |
| `zhin config`           | 管理配置文件（子命令：`list`/`get`/`set`/`delete`/`path`） |
| `zhin doctor`           | 检查系统环境和项目配置，支持 `--fix` 自动修复              |
| `zhin onboard`          | 引导与配置向导：项目内保持/重新配置/重置，复用现有配置与 data；非项目内可创建新项目或查看快速开始 |
| `zhin install-service`  | 注册为系统服务（systemd/launchd/NSSM），支持 `--user`      |
| `zhin uninstall-service`| 卸载系统服务                                               |

## 相关文档

- [快速开始 — 安装与启动](/getting-started/) — Stable 5 分钟路径
- [配置文件](/essentials/configuration) — `zhin.config` 字段说明
- [仓库 CLI 包 README](https://github.com/zhinjs/zhin/tree/main/basic/cli) — 各命令选项与示例
