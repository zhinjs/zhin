# CLI 命令参考

Zhin.js 命令行工具完整说明。Stable 上手只需 `dev` / `start` / `stop`；其余命令见下表，细节以 [`@zhin.js/cli` README](https://github.com/zhinjs/zhin/tree/main/basic/cli) 为准。

## 开发与运维

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin runtime start` | 启动（开发模式，watch 热重载）；`--no-watch` 生产、`--once` 单次 |
| `zhin runtime start --daemon` | 后台守护（写 `.zhin.pid`，崩溃自动拉起；`--log-file` 指定日志） |
| `zhin stop`    | 停止后台运行的机器人                                              |

> `zhin dev` / `zhin start`（legacy Feature registry 路径）已移除；旧项目请先按 [Plugin Runtime 原位迁移](../architecture/target-implementation/in-place-migration.md) 迁移。
| `zhin build`   | 构建插件，支持 `--clean`、`--production`、`--analyze`             |

### 全局实例（`~/.zhin`）

安装 CLI 后可在**任意目录**启动机器人，数据与配置集中在 `~/.zhin`：

1. 首次配置：`zhin setup --global`（写入 `zhin.config.yml`、`.env`、`data/` 等并安装依赖）
2. 启动：在项目根运行 `zhin runtime start --daemon`（`~/.zhin` 全局实例的自动回退随 legacy 路径一并移除，`zhin stop` 仍兼容 `.zhin.pid`）
3. 停止：`zhin stop`（同样解析 `~/.zhin` 上的 PID）

当前工作目录已是 Zhin 项目时，仍**优先使用本地项目**；skills / tools / agents / packages 的 `~/.zhin` 路径与项目内路径并存（发现链第二优先级）。

## 插件管理

| 命令           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `zhin new`     | 创建插件模板（normal/service/adapter），支持 `--type`             |
| `zhin install` | 安装并启用插件（npm 或 git），支持 `--dry-run`、`--no-enable`、`-S/--save`、`-D/--save-dev`、`-g` |
| `zhin add`     | `install` 的别名                                                  |
| `zhin pub`     | 发布插件到 npm，支持 `--tag`、`--dry-run`、`--access`             |
| `zhin search`  | 搜索 npm 上的 Zhin 插件，支持 `-c/--category`、`--official`       |
| `zhin info`    | 查看某个插件的详细信息                                            |

`zhin install @scope/plugin` 默认会写入本地 `zhin.config.yml` / `zhin.config.yaml` / `zhin.config.json` 的 `plugins` 数组。只想预览时用 `--dry-run`；只安装依赖不改配置时用 `--no-enable`。详见 [安装插件](/guide/plugin-install)。

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
