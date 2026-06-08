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

### 全局实例（`~/.zhin`）

安装 CLI 后可在**任意目录**启动机器人，数据与配置集中在 `~/.zhin`：

1. 首次配置：`zhin setup --global`（写入 `zhin.config.yml`、`.env`、`data/` 等并安装依赖）
2. 启动：`zhin start` 或 `zhin dev`（当前目录无 Zhin 项目时自动使用 `~/.zhin`；首次 `start` 也会自动初始化）
3. 停止：`zhin stop`（同样解析 `~/.zhin` 上的 PID）

当前工作目录已是 Zhin 项目时，仍**优先使用本地项目**；skills / tools / agents / packages 的 `~/.zhin` 路径与项目内路径并存（发现链第二优先级）。

## 插件管理

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin new`     | 创建插件模板（normal/service/adapter），支持 `--type`             |
| `zhin install` | 安装插件（npm 或 git），支持 `-S/--save`、`-D/--save-dev`、`-g`  |
| `zhin add`     | `install` 的别名                                                  |
| `zhin pub`     | 发布插件到 npm，支持 `--tag`、`--dry-run`、`--access`             |
| `zhin search`  | 搜索 npm 上的 Zhin 插件，支持 `-c/--category`、`--official`       |
| `zhin info`    | 查看某个插件的详细信息                                            |

## zhin-package（ADR 0010）

| 命令 | 说明 |
| ---- | ---- |
| `zhin packages install` | 安装 zhin-package（`npm:` / `git:`；`-l` 项目本地） |
| `zhin packages list` | 列出已安装包 |
| `zhin packages remove` | 移除包 |
| `zhin packages update` | 更新包 |

## 配置与诊断

| 命令                    | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `zhin setup`            | 交互式配置向导（数据库、适配器、AI 等）；`--global` 配置 `~/.zhin` |
| `zhin config`           | 管理配置文件（子命令：`list`/`get`/`set`/`delete`/`path`） |
| `zhin doctor`           | 检查系统环境和项目配置，支持 `--fix` 自动修复              |
| `zhin onboard`          | 引导与配置向导：项目内保持/重新配置/重置，复用现有配置与 data；非项目内可创建新项目或查看快速开始 |
| `zhin install-service`  | 注册为系统服务（systemd/launchd/NSSM），支持 `--user`      |
| `zhin uninstall-service`| 卸载系统服务                                               |

## 相关文档

- [快速开始 — 安装与启动](/getting-started/) — Stable 5 分钟路径
- [配置文件](/essentials/configuration) — `zhin.config` 字段说明
- [仓库 CLI 包 README](https://github.com/zhinjs/zhin/tree/main/basic/cli) — 各命令选项与示例
