# Bridge v1 脚手架提示（Q2）

本目录为 **模板片段**，不是可 `pnpm create` 的独立包：复制思路到你的 bot 仓库即可。

## 你需要自备

- **Node**：与 zhin 仓库 `engines` 一致，自行安装依赖（`pnpm` / `npm`）。
- **Python**（若跑 NoneBot 胶水）：≥ 3.9，`uv` 或 `pip` + venv；zhin **不会**替你下载解释器或 NoneBot wheel。

## 文件说明

| 文件 | 用途 |
|------|------|
| [`bridge-glue-snippet.yml`](./bridge-glue-snippet.yml) | 仅 **注释 + 占位形状** 的 YAML 片段；对应 `bridge-supervisor` README 中计划的 `bridge_glue.instances`（**无**真实 token 或路径）。 |

## 进一步阅读

- 主文档：仓库内 [`docs/bridge/index.md`](../../docs/bridge/index.md)（文档站侧栏「Bridge v1」入口）
- 各包 README：`packages/bridge-*`
